import 'server-only';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {prisma} from '@/server/db';
import {parseOwnerId} from '@/server/owner';
import {lockPostWrites} from '@/server/post-deletions';
import {setAuditAction} from '@/server/audit-log';
import {foldForSearch,tagSlug} from '@/lib/import/normalize';
import {classificationOutputSchema} from '@/lib/classification/contract';
import {translationOutputSchema,validateTranslationContent} from '@/lib/classification/translation';
import {classificationInputs} from './inputs';
import {captionSourceHash} from './translation-inputs';
import {captionShape,selectExamples,learningContextSchema,type LearningDomain} from '../../../services/worker/src/classification/learning';

const include={media:{orderBy:{id:'asc' as const}},postTags:{include:{tag:true}}};
type Source=Prisma.PostGetPayload<{include:typeof include}>;
type Tx=Prisma.TransactionClient;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sourceHash(post:Source,domain:LearningDomain){
 return domain==='translation'?captionSourceHash(post.ownerId,post.id,post.caption):digest({ownerId:post.ownerId,id:post.id,caption:post.caption,author:post.authorUsername,media:post.media.map(m=>({id:m.id,type:m.type,position:m.position,objectKey:m.objectKey,versionTag:m.versionTag,mimeType:m.mimeType,byteSize:String(m.byteSize)}))});
}
async function source(tx:Tx,ownerId:string,postId:string,lock=false){
 if(lock){await lockPostWrites(tx,ownerId);await tx.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${postId} FOR UPDATE`;}
 const post=await tx.post.findFirst({where:{ownerId,id:postId},include});if(!post)throw new Error('NOT_FOUND');return post;
}
async function save(tx:Tx,post:Source,domain:LearningDomain,kind:string,payload:Prisma.InputJsonValue,provenance:string,retainedSourceHash?:string){
 const data={sourceHash:retainedSourceHash??sourceHash(post,domain),payload,provenance,enabled:true,reviewedAt:new Date()};
 await tx.workerLearningExample.upsert({where:{ownerId_postId_domain_kind:{ownerId:post.ownerId,postId:post.id,domain,kind}},create:{ownerId:post.ownerId,postId:post.id,domain,kind,...data},update:data});
}
const tagPayload=z.object({tags:z.array(z.string()).max(20),avoidTags:z.array(z.string()).max(20)}).strict();
export async function recordTagFeedback(tx:Tx,ownerId:string,postId:string,tag:string,operation:'add'|'remove'){
 const post=await source(tx,ownerId,postId);const previous=await tx.workerLearningExample.findUnique({where:{ownerId_postId_domain_kind:{ownerId,postId,domain:'classification',kind:'tags'}}});
 const parsed=tagPayload.safeParse(previous?.payload);const payload=parsed.success?parsed.data:{tags:[],avoidTags:[]};
 payload.tags=payload.tags.filter(t=>tagSlug(t)!==tagSlug(tag));payload.avoidTags=payload.avoidTags.filter(t=>tagSlug(t)!==tagSlug(tag));
 payload[operation==='add'?'tags':'avoidTags'].push(tag);payload.tags=payload.tags.slice(-20);payload.avoidTags=payload.avoidTags.slice(-20);
 const removedTags=(previous?.removedTags??[]).filter(t=>t!==tagSlug(tag));if(operation==='remove')removedTags.push(tagSlug(tag));
 await setAuditAction(tx,'learning.manual_tag_'+operation);await save(tx,post,'classification','tags',payload,'MANUAL_TAG_EDIT',previous?.sourceHash); // A new edit cannot validate older evidence against changed media/caption.
 await tx.workerLearningExample.updateMany({where:{ownerId,postId,domain:'classification',kind:'tags'},data:{removedTags}});
 // Tag edits supersede the older full example, while its source category remains protected.
 await tx.workerLearningExample.updateMany({where:{ownerId,postId,domain:'classification',kind:'classification'},data:{enabled:false}});
}
export const learningReviewSchema=z.discriminatedUnion('domain',[
 z.object({domain:z.literal('classification'),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),mainTheme:z.string(),tags:z.array(z.string()).min(3).max(5)}).strict(),
 z.object({domain:z.literal('translation'),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['TRANSLATED','UNCHANGED']),sourceLanguages:z.array(z.string()),translatedCaption:z.string().nullable()}).strict(),
]);
export async function getLearningReview(ownerId:string,postId:string){
 ownerId=parseOwnerId(ownerId);const post=await source(prisma,ownerId,postId);
 return {classificationSourceHash:sourceHash(post,'classification'),translationSourceHash:sourceHash(post,'translation'),examples:await prisma.workerLearningExample.findMany({where:{ownerId,postId},select:{id:true,domain:true,kind:true,provenance:true,enabled:true,reviewedAt:true}})};
}
export async function reviewWorkerLearning(ownerId:string,postId:string,value:unknown){
 ownerId=parseOwnerId(ownerId);const input=learningReviewSchema.parse(value);
 return prisma.$transaction(async tx=>{
  const post=await source(tx,ownerId,postId,true);if(sourceHash(post,input.domain)!==input.sourceHash)throw new Error('LEARNING_SOURCE_STALE');
  await setAuditAction(tx,'learning.manual_review');
  if(input.domain==='classification'){
   const result=classificationOutputSchema.parse({status:'SUCCEEDED',mainTheme:input.mainTheme,tags:input.tags,reason:'Manual review'});if(result.status!=='SUCCEEDED')throw new Error('INVALID_RESULT');
   await tx.postTag.deleteMany({where:{postId,isManual:false}});
   for(const name of result.tags){const tag=await tx.tag.upsert({where:{ownerId_slug:{ownerId,slug:tagSlug(name)}},create:{ownerId,name,slug:tagSlug(name)},update:{}});await tx.postTag.upsert({where:{postId_tagId:{postId,tagId:tag.id}},create:{postId,tagId:tag.id,isManual:true},update:{isManual:true}});}
   const tags=await tx.postTag.findMany({where:{postId},include:{tag:true}});
   await tx.post.update({where:{id:postId},data:{mainTheme:result.mainTheme,searchText:foldForSearch([post.authorUsername,post.caption,result.mainTheme,...tags.map(t=>t.tag.name)].join(' '))}});
   const previousTags=await tx.workerLearningExample.findUnique({where:{ownerId_postId_domain_kind:{ownerId,postId,domain:'classification',kind:'tags'}}});
   if(previousTags){const parsedTags=tagPayload.safeParse(previousTags.payload);const priorPayload=parsedTags.success?parsedTags.data:{tags:[],avoidTags:[]};await tx.workerLearningExample.update({where:{id:previousTags.id},data:{enabled:false,payload:{tags:result.tags,avoidTags:priorPayload.avoidTags.filter(t=>!result.tags.some(name=>tagSlug(name)===tagSlug(t)))},removedTags:previousTags.removedTags.filter(t=>!result.tags.some(name=>tagSlug(name)===t))}});}
   await save(tx,post,input.domain,'classification',{mainTheme:result.mainTheme,tags:result.tags},'MANUAL_REVIEW');
  }else{
   const result=translationOutputSchema.parse({decision:input.decision,sourceLanguages:input.sourceLanguages,translatedCaption:input.translatedCaption,reason:'Manual review'});validateTranslationContent(post.caption,result);
   await save(tx,post,input.domain,'translation',result,'MANUAL_REVIEW');
  }
 },{timeout:20_000});
}
export async function revokeWorkerLearning(ownerId:string,postId:string,domain:LearningDomain){
 ownerId=parseOwnerId(ownerId);return prisma.$transaction(async tx=>{await source(tx,ownerId,postId,true);await setAuditAction(tx,'learning.revoke');await tx.workerLearningExample.updateMany({where:{ownerId,postId,domain},data:{enabled:false}});});
}
export async function loadLearningContext(tx:Tx,ownerId:string,postId:string,domain:LearningDomain){
 const target=await source(tx,ownerId,postId);const shape=captionShape(target.caption);
 const rows=await tx.workerLearningExample.findMany({where:{ownerId,domain,enabled:true,postId:{not:postId}},orderBy:[{reviewedAt:'desc'},{id:'asc'}],take:200,include:{post:{include}}});
 const catalog=new Set((await tx.tag.findMany({where:{ownerId},select:{name:true}})).map(t=>tagSlug(t.name)));
 const candidates=rows.flatMap(row=>{
  if(row.sourceHash!==sourceHash(row.post,domain))return [];
  const p=row.payload as Record<string,unknown>;
  if((row.kind==='tags'||row.kind==='classification')&&(!Array.isArray(p.tags)||p.tags.some(t=>typeof t!=='string'||!catalog.has(tagSlug(t)))))return [];
  if(row.kind==='classification'&&!classificationOutputSchema.safeParse({...p,status:'SUCCEEDED',reason:'Manual review'}).success)return [];
  if(row.kind==='translation'&&(row.post.caption.length>1200||!translationOutputSchema.safeParse(p).success))return [];
  const payload={...p};delete payload.reason;return [{id:row.id,source:row.post.caption.slice(0,1200),kind:row.kind,...payload}];
 });
 const observations=await tx.workerLearningObservation.findMany({where:{ownerId,domain,shape,createdAt:{gte:new Date(Date.now()-30*86400_000)}},orderBy:{createdAt:'desc'},take:50,select:{signals:true,errorFamily:true}});
 const count=(family:string)=>observations.filter(o=>o.errorFamily===family||o.signals.includes(family)).length;
 const strategy=domain==='translation'&&count('SOURCE_FIDELITY')>=2?'preserve_source':count('FORMAT')>=2?'format_guidance':'standard';
 return learningContextSchema.parse({version:1,domain,shape,strategy,examples:selectExamples(target.caption,candidates)});
}
export async function manualClassificationGuards(tx:Tx,ownerId:string,postId:string){
 const rows=await tx.workerLearningExample.findMany({where:{ownerId,postId,domain:'classification'}});
 const review=rows.find(r=>r.kind==='classification'),tags=rows.find(r=>r.kind==='tags');
 const correction=review?classificationOutputSchema.safeParse({...review.payload as object,status:'SUCCEEDED',reason:'Manual review'}):undefined;
 return {mainTheme:correction?.success&&correction.data.status==='SUCCEEDED'?correction.data.mainTheme:undefined,avoidTags:tags?.removedTags??[]};
}

import {learningReportSchema,failureFamily,type LearningReport} from '../../../services/worker/src/classification/learning';
// Called only inside the successful lease-fenced completion/failure transaction.
export async function recordLearningObservation(tx:Tx,ownerId:string,jobId:string,postId:string|null,leaseToken:string,domain:LearningDomain,outcome:'SUCCEEDED'|'NEEDS_REVIEW'|'FAILED'|'RETRY',value?:LearningReport,code?:string){
 if(!value||!postId)return;
 const report=learningReportSchema.parse(value);const post=await tx.post.findFirst({where:{ownerId,id:postId},include});if(!post)return;
 if(code){const job=await tx.postClassificationJob.findFirst({where:{ownerId,id:jobId},select:{inputHash:true}});const current=domain==='translation'?captionSourceHash(ownerId,postId,post.caption):(await classificationInputs(ownerId,postId,tx)).inputHash;if(job?.inputHash!==current)return;}
 const examples=await tx.workerLearningExample.findMany({where:{id:{in:report.exampleIds},ownerId,domain,postId:{not:postId}},select:{id:true}});
 // A correction can be revoked/deleted while work is in flight; retain only surviving own references.
 const exampleIds=examples.map(e=>e.id);const signals=[...new Set([...report.signals,...(outcome==='NEEDS_REVIEW'?['CONTEXT']:[]),...(code?[failureFamily(code)]:[])])];
 await tx.workerLearningObservation.createMany({data:[{ownerId,jobId,leaseHash:digest(leaseToken),domain,shape:captionShape(post.caption),strategy:report.strategy,outcome,errorFamily:code?failureFamily(code):outcome==='NEEDS_REVIEW'?'CONTEXT':null,signals,exampleIds,elapsedMs:report.elapsedMs,inputTokens:report.inputTokens,outputTokens:report.outputTokens}],skipDuplicates:true});
}
