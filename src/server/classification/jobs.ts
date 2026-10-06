import 'server-only';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '@/server/db';
import {classificationInputs,prepareClassification,digest} from './inputs';
import {CLASSIFICATION_VERSION,CLASSIFICATION_LEASE_MS,CLASSIFICATION_MAX_VIDEO_BYTES,classificationResultSchema,type ClassificationResult} from '@/lib/classification/contract';
import {loadWorkerMedia,type MediaSigner,type WorkerMedia} from '@/server/places/worker-media';
import {foldForSearch,tagSlug} from '@/lib/import/normalize';
import {lockPostWrites} from '@/server/post-deletions';
import {setAuditAction} from '@/server/audit-log';
type Lease={jobId:string;leaseToken:string};
type Dependencies={signMedia?:MediaSigner};
export async function enqueueClassification(ownerId:string,postId:string,tx:Prisma.TransactionClient){
 const {inputHash}=await classificationInputs(ownerId,postId,tx);
 await setAuditAction(tx,'classification.enqueue');
 await tx.postClassificationJob.createMany({data:[{ownerId,postId,sourcePostId:postId,inputHash,analysisVersion:CLASSIFICATION_VERSION}],skipDuplicates:true});
}
async function cancel(tx:Prisma.TransactionClient,id:string,ownerId:string,code:string){
 await tx.postClassificationJob.updateMany({where:{id,ownerId,status:{in:['PENDING','PROCESSING']}},data:{status:'CANCELLED',errorCode:code,completedAt:new Date(),leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,nextAttemptAt:null}});
}
export async function claimClassification(ownerId:string,deps:Dependencies={}){
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`classification:${ownerId}`},0))::text`;
  const now=new Date();
  if(await tx.postClassificationJob.findFirst({where:{ownerId,status:'PROCESSING',leaseExpiresAt:{gt:now}}}))return null;
  await tx.postClassificationJob.updateMany({where:{ownerId,attemptCount:{gte:3},OR:[{status:'PENDING'},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},data:{status:'FAILED',errorCode:'ATTEMPTS_EXHAUSTED',completedAt:now,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null}});
  for(let scan=0;scan<100;scan++){
   const job=await tx.postClassificationJob.findFirst({where:{ownerId,analysisVersion:CLASSIFICATION_VERSION,attemptCount:{lt:3},OR:[{status:'PENDING',OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}]});
   if(!job)return null;
   if(!job.postId){await cancel(tx,job.id,ownerId,'POST_DELETED');continue;}
   await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${job.postId} FOR UPDATE`;
   let prepared:Awaited<ReturnType<typeof prepareClassification>>;
   try{prepared=await prepareClassification(ownerId,job.postId,deps.signMedia,tx);if(prepared.input.input_hash!==job.inputHash)throw Error('CLASSIFICATION_INPUT_STALE');}
   catch(error){const code=error instanceof Error?error.message:'';if(!['POST_NOT_FOUND','CLASSIFICATION_INPUT_STALE','PLACES_MEDIA_UNAVAILABLE'].includes(code))throw error;
    if(code==='PLACES_MEDIA_UNAVAILABLE')await tx.postClassificationJob.update({where:{id:job.id},data:{status:'FAILED',errorCode:'MEDIA_UNAVAILABLE',completedAt:now}});else await cancel(tx,job.id,ownerId,code);continue;}
   const leaseToken=randomUUID();await setAuditAction(tx,'classification.claim');
   await tx.postClassificationJob.update({where:{id:job.id},data:{status:'PROCESSING',attemptCount:{increment:1},leaseOwner:leaseToken,leaseExpiresAt:new Date(Date.now()+CLASSIFICATION_LEASE_MS),heartbeatAt:new Date(),startedAt:job.startedAt??now,nextAttemptAt:null,errorCode:null}});
   return {jobId:job.id,leaseToken,heartbeatIntervalMs:30_000,...prepared};
  }
  return null;
 },{timeout:30_000});
}
export async function heartbeatClassification(ownerId:string,lease:Lease){
 const now=new Date();const u=await prisma.postClassificationJob.updateMany({where:{id:lease.jobId,ownerId,status:'PROCESSING',leaseOwner:lease.leaseToken,leaseExpiresAt:{gt:now}},data:{leaseExpiresAt:new Date(now.getTime()+CLASSIFICATION_LEASE_MS),heartbeatAt:now}});
 if(u.count!==1)throw Error('CLASSIFICATION_LEASE_LOST');return {ok:true};
}
function coverage(result:ClassificationResult,media:WorkerMedia[]){
 if(result.media.length!==media.length||new Set(result.media.map(m=>m.mediaId)).size!==media.length)throw Error('CLASSIFICATION_MEDIA_INCOMPLETE');
 for(const m of media){const c=result.media.find(c=>c.mediaId===m.id);if(!c||c.kind!==m.kind||(m.kind==='IMAGE'&&(c.durationMs!==null||c.frameCount!==1||c.audio!=='not_applicable'))||(m.kind==='VIDEO'&&(c.durationMs===null||c.audio==='not_applicable')))throw Error('CLASSIFICATION_MEDIA_INCOMPLETE');}
}
export async function completeClassification(ownerId:string,command:Lease&{result:unknown}){
 const result=classificationResultSchema.parse(command.result);const requestHash=digest(result),leaseHash=digest(command.leaseToken);
 const outcome=await prisma.$transaction(async tx=>{
  await lockPostWrites(tx,ownerId);
  const before=await tx.postClassificationJob.findFirst({where:{id:command.jobId,ownerId,analysisVersion:CLASSIFICATION_VERSION}});
  if(!before)return {error:'CLASSIFICATION_JOB_NOT_FOUND'};
  if(before.postId)await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${before.postId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM post_classification_jobs WHERE owner_id=${ownerId} AND id=${command.jobId} FOR UPDATE`;
  const job=await tx.postClassificationJob.findUniqueOrThrow({where:{id:command.jobId}});
  const saved=job.result as {completion?:{requestHash:string;leaseHash:string;receipt:{postId:string;status:string}}}|null;
  if(['SUCCEEDED','NEEDS_REVIEW'].includes(job.status)&&saved?.completion?.requestHash===requestHash&&saved.completion.leaseHash===leaseHash)return {receipt:saved.completion.receipt};
  if(job.status!=='PROCESSING'||job.leaseOwner!==command.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=new Date())return {error:'CLASSIFICATION_LEASE_LOST'};
  if(!job.postId){await cancel(tx,job.id,ownerId,'POST_DELETED');return {error:'CLASSIFICATION_INPUT_STALE'};}
  const state=await classificationInputs(ownerId,job.postId,tx);
  if(state.inputHash!==job.inputHash){await cancel(tx,job.id,ownerId,'CLASSIFICATION_INPUT_STALE');return {error:'CLASSIFICATION_INPUT_STALE'};}
  coverage(result,await loadWorkerMedia(ownerId,job.postId,async()=>'',tx,CLASSIFICATION_MAX_VIDEO_BYTES));
  await setAuditAction(tx,'classification.complete');
  if(result.status==='SUCCEEDED'){
   const resolved=[] as {id:string;name:string}[];
   for(const rawName of result.tags){const name=rawName.replace(/\s+/g,' ');resolved.push(await tx.tag.upsert({where:{ownerId_slug:{ownerId,slug:tagSlug(name)}},create:{ownerId,slug:tagSlug(name),name},update:{},select:{id:true,name:true}}));}
   await tx.postTag.deleteMany({where:{postId:job.postId,isManual:false}});
   await tx.postTag.createMany({data:resolved.map(t=>({postId:job.postId!,tagId:t.id,isManual:false})),skipDuplicates:true});
   const tags=await tx.postTag.findMany({where:{postId:job.postId},include:{tag:true}});
   const metadata=state.post.metadata&&typeof state.post.metadata==='object'&&!Array.isArray(state.post.metadata)?state.post.metadata:{};
   await tx.post.update({where:{id:job.postId},data:{mainTheme:result.mainTheme,searchText:foldForSearch([state.post.authorUsername,state.post.caption,result.mainTheme??'',...tags.map(t=>t.tag.name)].join(' ')),metadata:{...metadata,classification:{version:CLASSIFICATION_VERSION,jobId:job.id,model:result.model}} as Prisma.InputJsonValue}});
  }
  const receipt={postId:job.sourcePostId,status:result.status};
  await tx.postClassificationJob.update({where:{id:job.id},data:{status:result.status,completedAt:new Date(),leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,errorCode:null,result:{...result,completion:{requestHash,leaseHash,receipt}} as Prisma.InputJsonValue}});
  return {receipt};
 },{timeout:30_000});
 if(outcome.error)throw Error(outcome.error);return outcome.receipt!;
}
export async function failClassification(ownerId:string,lease:Lease&{code:string}){
 const job=await prisma.postClassificationJob.findFirst({where:{id:lease.jobId,ownerId}});const now=new Date();
 if(!job||job.status!=='PROCESSING'||job.leaseOwner!==lease.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=now)throw Error('CLASSIFICATION_LEASE_LOST');
 const retryable=['MEDIA_UNAVAILABLE','INFERENCE_FAILED','INFERENCE_BUSY','WORKER_STOPPING','WORKER_TIMEOUT'].includes(lease.code)&&job.attemptCount<3;
 const updated=await prisma.postClassificationJob.updateMany({where:{id:job.id,ownerId,status:'PROCESSING',leaseOwner:lease.leaseToken,leaseExpiresAt:{gt:now}},data:{status:retryable?'PENDING':'FAILED',errorCode:lease.code,nextAttemptAt:retryable?new Date(now.getTime()+(job.attemptCount===1?60_000:300_000)):null,completedAt:retryable?null:now,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null}});
 if(updated.count!==1)throw Error('CLASSIFICATION_LEASE_LOST');return {ok:true,retryable};
}
