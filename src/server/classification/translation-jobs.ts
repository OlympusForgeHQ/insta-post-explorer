import 'server-only';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {prisma} from '@/server/db';
import {setAuditAction} from '@/server/audit-log';
import {lockPostWrites} from '@/server/post-deletions';
import {CLASSIFICATION_LEASE_MS,CLASSIFICATION_VERSION} from '@/lib/classification/contract';
import {CAPTION_TRANSLATION_VERSION,translationOutputSchema,translationResultSchema,validateTranslationContent} from '@/lib/classification/translation';
import {captionSourceHash} from './translation-inputs';
import {digest} from './inputs';
type Lease={jobId:string;leaseToken:string};
const cleared={leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,nextAttemptAt:null};
export async function enqueueCaptionTranslation(ownerId:string,postId:string,tx:Prisma.TransactionClient){
 // Same post -> job order as completion. Never acquire the claim lock here.
 await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${postId} FOR UPDATE`;
 const post=await tx.post.findFirst({where:{id:postId,ownerId},select:{id:true,caption:true}});if(!post)return;
 const inputHash=captionSourceHash(ownerId,postId,post.caption);
 const where={ownerId_sourcePostId_analysisVersion:{ownerId,sourcePostId:postId,analysisVersion:CAPTION_TRANSLATION_VERSION}};
 const existing=await tx.postClassificationJob.findUnique({where});if(existing?.inputHash===inputHash)return;
 const [previous]=await tx.$queryRaw<Array<{action:string|null}>>`SELECT current_setting('ipe.audit_action',true) AS action`;
 await setAuditAction(tx,'caption_translation.enqueue');
 await tx.postClassificationJob.upsert({where,create:{ownerId,postId,sourcePostId:postId,analysisVersion:CAPTION_TRANSLATION_VERSION,inputHash},update:{inputHash,status:'PENDING',attemptCount:0,result:Prisma.DbNull,errorCode:null,startedAt:null,completedAt:null,...cleared}});
 await setAuditAction(tx,previous?.action??'');
}
async function cancel(tx:Prisma.TransactionClient,id:string,code:string){await setAuditAction(tx,'caption_translation.cancel');await tx.postClassificationJob.update({where:{id},data:{status:'CANCELLED',errorCode:code,completedAt:new Date(),...cleared}});}
export async function claimCaptionTranslation(ownerId:string){
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`classification:${ownerId}`},0))::text`;
  const now=new Date();
  if(await tx.postClassificationJob.findFirst({where:{ownerId,status:'PROCESSING',leaseExpiresAt:{gt:now}}}))return null;
  // Classification retains priority, including work admitted after its last poll.
  if(await tx.postClassificationJob.findFirst({where:{ownerId,analysisVersion:CLASSIFICATION_VERSION,attemptCount:{lt:3},OR:[{status:'PENDING',OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]}}))return null;
  await setAuditAction(tx,'caption_translation.expire');
  await tx.postClassificationJob.updateMany({where:{ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION,attemptCount:{gte:3},OR:[{status:'PENDING'},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},data:{status:'FAILED',errorCode:'ATTEMPTS_EXHAUSTED',completedAt:now,...cleared}});
  for(let scan=0;scan<100;scan++){
   const job=await tx.postClassificationJob.findFirst({where:{ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION,attemptCount:{lt:3},OR:[{status:'PENDING',OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}]});
   if(!job)return null;
   if(!job.postId){await cancel(tx,job.id,'POST_DELETED');continue;}
   await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${job.postId} FOR UPDATE`;
   const post=await tx.post.findFirst({where:{id:job.postId,ownerId},select:{id:true,caption:true}});
   if(!post){await cancel(tx,job.id,'POST_DELETED');continue;}
   // Re-read after locking the post: an import can have renewed this job.
   const fresh=await tx.postClassificationJob.findUniqueOrThrow({where:{id:job.id}});
   if(!['PENDING','PROCESSING'].includes(fresh.status))continue;
   const hash=captionSourceHash(ownerId,post.id,post.caption);
   if(hash!==fresh.inputHash){await enqueueCaptionTranslation(ownerId,post.id,tx);continue;}
   if(post.caption.length>100_000){await setAuditAction(tx,'caption_translation.reject_limit');await tx.postClassificationJob.update({where:{id:job.id},data:{status:'NEEDS_REVIEW',errorCode:'CAPTION_LIMIT',completedAt:now,...cleared}});continue;}
   const leaseToken=randomUUID();await setAuditAction(tx,'caption_translation.claim');
   await tx.postClassificationJob.update({where:{id:job.id},data:{status:'PROCESSING',attemptCount:{increment:1},leaseOwner:leaseToken,leaseExpiresAt:new Date(Date.now()+CLASSIFICATION_LEASE_MS),heartbeatAt:new Date(),startedAt:fresh.startedAt??now,nextAttemptAt:null,errorCode:null}});
   return {jobId:job.id,leaseToken,heartbeatIntervalMs:30_000,input:{post_id:post.id,input_hash:hash,caption:post.caption},outputSchema:z.toJSONSchema(translationOutputSchema)};
  }
  return null;
 },{timeout:30_000});
}
export async function completeCaptionTranslation(ownerId:string,command:Lease&{result:unknown}){
 const result=translationResultSchema.parse(command.result),requestHash=digest(result),leaseHash=digest(command.leaseToken);
 const outcome=await prisma.$transaction(async tx=>{
  await lockPostWrites(tx,ownerId);
  const before=await tx.postClassificationJob.findFirst({where:{id:command.jobId,ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION}});
  if(!before)return {error:'CLASSIFICATION_JOB_NOT_FOUND'};
  if(before.postId)await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${before.postId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM post_classification_jobs WHERE owner_id=${ownerId} AND id=${command.jobId} FOR UPDATE`;
  const job=await tx.postClassificationJob.findUniqueOrThrow({where:{id:command.jobId}});
  const saved=job.result as {completion?:{requestHash:string;leaseHash:string;receipt:unknown}}|null;
  if(['SUCCEEDED','NEEDS_REVIEW'].includes(job.status)&&saved?.completion?.requestHash===requestHash&&saved.completion.leaseHash===leaseHash)return {receipt:saved.completion.receipt};
  if(job.status!=='PROCESSING'||job.leaseOwner!==command.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=new Date())return {error:'CLASSIFICATION_LEASE_LOST'};
  const post=job.postId?await tx.post.findFirst({where:{id:job.postId,ownerId},select:{id:true,caption:true}}):null;
  if(!post){await cancel(tx,job.id,'POST_DELETED');return {error:'CLASSIFICATION_INPUT_STALE'};}
  if(captionSourceHash(ownerId,post.id,post.caption)!==job.inputHash){await enqueueCaptionTranslation(ownerId,post.id,tx);return {error:'CLASSIFICATION_INPUT_STALE'};}
  validateTranslationContent(post.caption,result);
  const status=result.decision==='NEEDS_REVIEW'?'NEEDS_REVIEW':'SUCCEEDED';const receipt={postId:post.id,status,decision:result.decision};
  await setAuditAction(tx,'caption_translation.complete');
  await tx.postClassificationJob.update({where:{id:job.id},data:{status,completedAt:new Date(),...cleared,errorCode:null,result:{...result,completion:{requestHash,leaseHash,receipt}} as Prisma.InputJsonValue}});
  return {receipt};
 },{timeout:30_000});
 if(outcome.error)throw Error(outcome.error);return outcome.receipt;
}
export async function failCaptionTranslation(ownerId:string,lease:Lease&{code:string}){
 return prisma.$transaction(async tx=>{
  const job=await tx.postClassificationJob.findFirst({where:{id:lease.jobId,ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION}}),now=new Date();
  if(!job||job.status!=='PROCESSING'||job.leaseOwner!==lease.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=now)throw Error('CLASSIFICATION_LEASE_LOST');
  const busy=lease.code==='INFERENCE_BUSY';
  const busyWindowOpen=!!job.startedAt&&now.getTime()-job.startedAt.getTime()<24*3600_000;
  const retryable=busy?busyWindowOpen:['INFERENCE_FAILED','INFERENCE_BUSY','WORKER_TIMEOUT','WORKER_STOPPING'].includes(lease.code)&&job.attemptCount<3;
  await setAuditAction(tx,'caption_translation.fail');
  const updated=await tx.postClassificationJob.updateMany({where:{id:job.id,ownerId,inputHash:job.inputHash,status:'PROCESSING',leaseOwner:lease.leaseToken,leaseExpiresAt:{gt:now}},data:{status:retryable?'PENDING':'FAILED',errorCode:lease.code,...cleared,...(busy&&retryable?{attemptCount:Math.max(0,job.attemptCount-1)}:{}),nextAttemptAt:retryable?new Date(now.getTime()+(busy?300_000:job.attemptCount===1?60_000:300_000)):null,completedAt:retryable?null:now}});
  if(updated.count!==1)throw Error('CLASSIFICATION_LEASE_LOST');return {ok:true,retryable};
 });
}

// Operator recovery is deliberately version-scoped, cutoff-bound and idempotent.
// A repeated invocation cannot pick up a new failure produced after this cutoff.
export async function recoverFailedCaptionTranslations(ownerId:string,failedBefore:Date){
 if(!Number.isFinite(failedBefore.getTime())||failedBefore>new Date())throw Error('INVALID_RECOVERY_CUTOFF');
 const candidates=await prisma.postClassificationJob.findMany({where:{ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION,status:'FAILED',completedAt:{lte:failedBefore},errorCode:{in:['INVALID_RESULT','INFERENCE_BUSY','INFERENCE_FAILED','WORKER_TIMEOUT','ATTEMPTS_EXHAUSTED']}},select:{id:true,postId:true},orderBy:{id:'asc'},take:5000});
 let requeued=0,skipped=0;
 for(const candidate of candidates){
  const changed=await prisma.$transaction(async tx=>{
   if(!candidate.postId)return false;
   await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${candidate.postId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM post_classification_jobs WHERE owner_id=${ownerId} AND id=${candidate.id} FOR UPDATE`;
   const job=await tx.postClassificationJob.findFirst({where:{id:candidate.id,ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION,status:'FAILED',completedAt:{lte:failedBefore},errorCode:{in:['INVALID_RESULT','INFERENCE_BUSY','INFERENCE_FAILED','WORKER_TIMEOUT','ATTEMPTS_EXHAUSTED']}}});
   const post=await tx.post.findFirst({where:{id:candidate.postId,ownerId},select:{id:true,caption:true}});
   if(!job||!post||job.postId!==post.id||job.inputHash!==captionSourceHash(ownerId,post.id,post.caption))return false;
   await setAuditAction(tx,'caption_translation.recover');
   await tx.postClassificationJob.update({where:{id:job.id},data:{status:'PENDING',attemptCount:0,errorCode:null,result:Prisma.DbNull,startedAt:null,completedAt:null,...cleared}});return true;
  });
  if(changed)requeued++;else skipped++;
 }
 return {requeued,skipped};
}

// Explicit review snapshots prevent broad or repeated reanalysis of uncertain posts.
export async function recoverReviewedCaptionTranslations(ownerId:string,targets:Array<{id:string;inputHash:string}>,reviewedBefore:Date){
 const selected=z.array(z.object({id:z.string().min(1),inputHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(5000).parse(targets);
 if(!Number.isFinite(reviewedBefore.getTime())||reviewedBefore>new Date()||new Set(selected.map(t=>t.id)).size!==selected.length)throw Error('INVALID_RECOVERY_SNAPSHOT');
 let requeued=0;
 for(const target of selected){
  const changed=await prisma.$transaction(async tx=>{
   const where={id:target.id,ownerId,analysisVersion:CAPTION_TRANSLATION_VERSION,inputHash:target.inputHash,status:'NEEDS_REVIEW' as const,completedAt:{lte:reviewedBefore}};
   const candidate=await tx.postClassificationJob.findFirst({where});if(!candidate?.postId)return false;
   await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${candidate.postId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM post_classification_jobs WHERE owner_id=${ownerId} AND id=${target.id} FOR UPDATE`;
   const job=await tx.postClassificationJob.findFirst({where});
   const post=await tx.post.findFirst({where:{id:candidate.postId,ownerId},select:{id:true,caption:true}});
   if(!job||!post||job.postId!==post.id||job.errorCode!==null||(job.result as {decision?:unknown}|null)?.decision!=='NEEDS_REVIEW'||captionSourceHash(ownerId,post.id,post.caption)!==target.inputHash)return false;
   await setAuditAction(tx,'caption_translation.recover_review');
   await tx.postClassificationJob.update({where:{id:job.id},data:{status:'PENDING',attemptCount:0,result:Prisma.DbNull,errorCode:null,startedAt:null,completedAt:null,...cleared}});
   return true;
  },{timeout:30_000});
  if(changed)requeued++;
 }
 return {requeued,skipped:selected.length-requeued};
}
