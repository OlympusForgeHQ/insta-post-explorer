import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { canonicalPlacesTheme } from '@/lib/places/eligibility';
import { PLACE_CLASSIFICATION_RULES } from '@/lib/places/categories';
import { PLACES_WORKER_LEASE_MS, PLACES_WORKER_VERSION, workerCandidatesSchema, workerResultSchema, type WorkerResult } from '@/lib/places/worker-contract';
import { loadAnalysisPostInputs } from '@/server/places/repository';
import { computePlacesInputHash } from '@/server/places/hash';
import { planAll, persistMetadataAnalysis, type AnalyzeRecordResult } from '@/server/places/analysis';
import { getConfiguredPlaceResolver } from '@/server/places/resolvers';
import type { PlaceResolver } from '@/server/places/resolvers/types';
import { loadWorkerMedia, type MediaSigner, type WorkerMedia } from '@/server/places/worker-media';
import { setAuditAction } from '@/server/audit-log';

type Dependencies={resolver?:PlaceResolver;signMedia?:MediaSigner};
type Lease={jobId:string;leaseToken:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function inputs(ownerId:string,postId:string,client:Prisma.TransactionClient=prisma){
  const post=await loadAnalysisPostInputs(ownerId,postId,client);
  if(!post)throw Error('POST_NOT_FOUND');
  const sourceTheme=canonicalPlacesTheme(post.mainTheme);
  if(!sourceTheme)throw Error('POST_NOT_PLACES_ELIGIBLE');
  const inputHash=computePlacesInputHash({...post,postId:post.id,sourceTheme,analysisVersion:PLACES_WORKER_VERSION});
  return {post,sourceTheme,inputHash};
}
export async function preparePlacesPost(ownerId:string,postId:string,deps:Dependencies={},client:Prisma.TransactionClient=prisma){
  const {post,sourceTheme,inputHash}=await inputs(ownerId,postId,client);
  const media=await loadWorkerMedia(ownerId,postId,deps.signMedia,client);
  return {input:{post_id:post.id,input_hash:inputHash,analysis_version:PLACES_WORKER_VERSION,main_theme:sourceTheme,
    caption:post.caption,author_username:post.authorUsername,internal_tags:post.internalTags,instagram_location:post.structuredLocation},
    media,categoryRules:PLACE_CLASSIFICATION_RULES,outputSchema:z.toJSONSchema(workerCandidatesSchema)};
}
export async function enqueuePlacesPosts(ownerId:string,options:{postId?:string;cursor?:string}){
  const posts=await prisma.post.findMany({where:{ownerId,...(options.postId?{id:options.postId}:options.cursor?{id:{gt:options.cursor}}:{})},orderBy:{id:'asc'},take:100,select:{id:true,mainTheme:true}});
  if(options.postId&&posts.length===0)throw Error('POST_NOT_FOUND');
  let queued=0;
  for(const post of posts){
    if(!canonicalPlacesTheme(post.mainTheme)){if(options.postId)throw Error('POST_NOT_PLACES_ELIGIBLE');continue;}
    try{
      const state=await inputs(ownerId,post.id);
      const created=await prisma.placeAnalysisJob.createMany({data:[{ownerId,postId:post.id,inputHash:state.inputHash,analysisVersion:PLACES_WORKER_VERSION,sourceTheme:state.sourceTheme,depth:'DEEP',maxAttempts:3}],skipDuplicates:true});
      queued+=created.count;
    }catch(error){if(error instanceof Error&&['POST_NOT_FOUND','POST_NOT_PLACES_ELIGIBLE'].includes(error.message))continue;throw error;}
  }
  return {queued,nextCursor:!options.postId&&posts.length===100?posts.at(-1)!.id:null};
}
export async function claimPlacesJob(ownerId:string,options:{postId?:string},deps:Dependencies={}){
  return prisma.$transaction(async tx=>{
    // Serialize admission for this owner, including concurrent API requests.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-worker:${ownerId}`},0))::text`;
    const now=new Date();
    if(await tx.placeAnalysisJob.findFirst({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,status:'PROCESSING',leaseExpiresAt:{gt:now}}}))return null;
    await tx.placeAnalysisJob.updateMany({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,attemptCount:{gte:3},OR:[{status:'PENDING'},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},data:{status:'FAILED',stage:'COMPLETE',errorCode:'ATTEMPTS_EXHAUSTED',completedAt:now,leaseOwner:null,leaseExpiresAt:null}});
    for(let scan=0;scan<100;scan++){
      const job=await tx.placeAnalysisJob.findFirst({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,...(options.postId?{postId:options.postId}:{}),attemptCount:{lt:3},OR:[{status:'PENDING',OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},orderBy:[{priority:'desc'},{createdAt:'asc'},{id:'asc'}]});
      if(!job)return null;
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${job.postId} AND owner_id=${ownerId} FOR UPDATE`;
      let prepared:Awaited<ReturnType<typeof preparePlacesPost>>;
      try{
        prepared=await preparePlacesPost(ownerId,job.postId,deps,tx);
        if(prepared.input.input_hash!==job.inputHash)throw Error('PLACES_INPUT_STALE');
      }catch(error){
        const code=error instanceof Error?error.message:'';
        if(!['POST_NOT_FOUND','POST_NOT_PLACES_ELIGIBLE','PLACES_INPUT_STALE','PLACES_MEDIA_UNAVAILABLE'].includes(code))throw error;
        await tx.placeAnalysisJob.updateMany({where:{id:job.id,ownerId},data:{status:code==='PLACES_MEDIA_UNAVAILABLE'?'FAILED':'CANCELLED',stage:'COMPLETE',errorCode:code,completedAt:now,leaseOwner:null,leaseExpiresAt:null}});
        continue;
      }
      const leaseToken=randomUUID();
      await tx.placeAnalysisJob.update({where:{id:job.id},data:{status:'PROCESSING',stage:'EXTRACTING',leaseOwner:leaseToken,leaseExpiresAt:new Date(now.getTime()+PLACES_WORKER_LEASE_MS),heartbeatAt:now,claimedAt:now,startedAt:job.startedAt??now,attemptCount:{increment:1},nextAttemptAt:null,errorCode:null,errorMessage:null}});
      return {jobId:job.id,leaseToken,heartbeatIntervalMs:30_000,...prepared};
    }
    return null;
  },{timeout:30_000});
}
export async function heartbeatPlacesJob(ownerId:string,lease:Lease){
  const now=new Date();
  const updated=await prisma.placeAnalysisJob.updateMany({where:{id:lease.jobId,ownerId,analysisVersion:PLACES_WORKER_VERSION,status:'PROCESSING',leaseOwner:lease.leaseToken,leaseExpiresAt:{gt:now}},data:{heartbeatAt:now,leaseExpiresAt:new Date(now.getTime()+PLACES_WORKER_LEASE_MS)}});
  if(updated.count!==1)throw Error('PLACES_LEASE_LOST');
  return {ok:true};
}
async function loadLease(ownerId:string,lease:Lease,client:Prisma.TransactionClient=prisma){
  const job=await client.placeAnalysisJob.findFirst({where:{id:lease.jobId,ownerId,analysisVersion:PLACES_WORKER_VERSION}});
  if(!job)throw Error('PLACES_JOB_NOT_FOUND');
  if(job.status!=='PROCESSING'||job.leaseOwner!==lease.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=new Date())throw Error('PLACES_LEASE_LOST');
  return job;
}
function validateCoverage(result:WorkerResult,media:WorkerMedia[],caption:string){
  if(result.media.length!==media.length||new Set(result.media.map(m=>m.mediaId)).size!==media.length)throw Error('PLACES_MEDIA_INCOMPLETE');
  for(const source of media){
    const coverage=result.media.find(m=>m.mediaId===source.id);
    if(!coverage||coverage.kind!==source.kind||
      (source.kind==='IMAGE'&&(coverage.durationMs!==null||coverage.frameCount!==1||coverage.audio!=='not_applicable'))||
      (source.kind==='VIDEO'&&(coverage.durationMs===null||coverage.audio==='not_applicable')))throw Error('PLACES_MEDIA_INCOMPLETE');
  }
  for(const candidate of result.candidates)for(const evidence of candidate.evidence){
    if(evidence.type==='CAPTION'&&!caption.includes(evidence.excerpt))throw Error('PLACES_EVIDENCE_INVALID');
    if(['AUDIO_TRANSCRIPT','VIDEO_OCR','VISUAL_LANDMARK'].includes(evidence.type)){
      const coverage=result.media.find(m=>m.mediaId===evidence.mediaId);
      if(!coverage||evidence.videoTimestampMs===undefined||evidence.videoTimestampMs>(coverage.durationMs??0)||
        (evidence.type==='AUDIO_TRANSCRIPT'&&coverage.audio!=='transcribed'))throw Error('PLACES_EVIDENCE_INVALID');
    }
  }
}
export async function previewPlacesResult(ownerId:string,options:{postId:string;inputHash:string;result:unknown},deps:Dependencies={}){
  const result=workerResultSchema.parse(options.result);
  const prepared=await preparePlacesPost(ownerId,options.postId,deps);
  if(prepared.input.input_hash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
  validateCoverage(result,prepared.media,prepared.input.caption);
  const plans=await planAll(result.candidates,prepared.input.main_theme,deps.resolver??getConfiguredPlaceResolver());
  return {postId:options.postId,committed:false,plans};
}
export async function completePlacesJob(ownerId:string,options:Lease&{result:unknown},deps:Dependencies={}):Promise<AnalyzeRecordResult>{
  const result=workerResultSchema.parse(options.result),requestHash=digest(result),leaseHash=digest(options.leaseToken);
  const existing=await prisma.placeAnalysisJob.findFirst({where:{id:options.jobId,ownerId,analysisVersion:PLACES_WORKER_VERSION}});
  if(existing&&['SUCCEEDED','NEEDS_REVIEW'].includes(existing.status)){
    const saved=existing.result as {completion?:{requestHash:string;leaseHash:string;receipt:AnalyzeRecordResult}}|null;
    if(saved?.completion?.requestHash===requestHash&&saved.completion.leaseHash===leaseHash)return saved.completion.receipt;
    throw Error('PLACES_LEASE_LOST');
  }
  if(!existing)throw Error('PLACES_JOB_NOT_FOUND');
  if(existing.status!=='PROCESSING'||existing.leaseOwner!==options.leaseToken||!existing.leaseExpiresAt||existing.leaseExpiresAt<=new Date())throw Error('PLACES_LEASE_LOST');
  const job=existing;
  const prepared=await preparePlacesPost(ownerId,job.postId,deps);
  if(prepared.input.input_hash!==job.inputHash)throw Error('PLACES_INPUT_STALE');
  validateCoverage(result,prepared.media,prepared.input.caption);
  const plans=await planAll(result.candidates,prepared.input.main_theme,deps.resolver??getConfiguredPlaceResolver());
  return prisma.$transaction(async tx=>{
    // Same post lock as admission; a concurrent admin delete/update wins before
    // this gate or waits until the entire domain transaction has committed.
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${job.postId} AND owner_id=${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${job.id} AND owner_id=${ownerId} FOR UPDATE`;
    const locked=await tx.placeAnalysisJob.findFirst({where:{id:job.id,ownerId}});
    if(locked&&['SUCCEEDED','NEEDS_REVIEW'].includes(locked.status)){
      const saved=locked.result as {completion?:{requestHash:string;leaseHash:string;receipt:AnalyzeRecordResult}}|null;
      if(saved?.completion?.requestHash===requestHash&&saved.completion.leaseHash===leaseHash)return saved.completion.receipt;
      throw Error('PLACES_LEASE_LOST');
    }
    await loadLease(ownerId,options,tx);
    const current=await inputs(ownerId,job.postId,tx);
    if(current.inputHash!==job.inputHash)throw Error('PLACES_INPUT_STALE');
    const currentMedia=await loadWorkerMedia(ownerId,job.postId,async()=>'',tx);
    validateCoverage(result,currentMedia,current.post.caption);
    await setAuditAction(tx,'places.worker.complete');
    const receipt=await persistMetadataAnalysis(tx,{ownerId,postId:job.postId,jobId:job.id,plans});
    await tx.placeAnalysisJob.update({where:{id:job.id},data:{leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,result:{...receipt,model:result.model,usage:result.usage,elapsedMs:result.elapsedMs,media:result.media,completion:{requestHash,leaseHash,receipt}} as Prisma.InputJsonValue}});
    return receipt;
  },{timeout:30_000});
}
export async function failPlacesJob(ownerId:string,options:Lease&{code:string}){
  const job=await loadLease(ownerId,options),now=new Date();
  const retryable=['MEDIA_UNAVAILABLE','INFERENCE_FAILED','WORKER_STOPPING','WORKER_TIMEOUT'].includes(options.code)&&job.attemptCount<3;
  const updated=await prisma.placeAnalysisJob.updateMany({where:{id:job.id,ownerId,status:'PROCESSING',leaseOwner:options.leaseToken,leaseExpiresAt:{gt:now}},data:{status:retryable?'PENDING':'FAILED',stage:retryable?'QUEUED':'COMPLETE',errorCode:options.code,errorMessage:null,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,nextAttemptAt:retryable?new Date(now.getTime()+60_000*job.attemptCount):null,completedAt:retryable?null:now}});
  if(updated.count!==1)throw Error('PLACES_LEASE_LOST');
  return {ok:true,retryable};
}
