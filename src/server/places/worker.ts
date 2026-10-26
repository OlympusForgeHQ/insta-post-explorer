import {deferredFailureCodes,repairableFailureCodes} from '../../../services/worker/src/places/learning';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
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
import {loadVerifiedResolutionMemory} from './resolution-memory';
import {PLACE_CONTEXT_RULES,RESOLUTION_POLICY_VERSION} from '@/lib/places/resolution';
import {foldForSearch} from '@/lib/import/normalize';
import {isSupportedRecovery} from '@/lib/places/recovery';
import {assertPostAllowsPlaceAnalysis, hasOwnerNoPlaceConfirmation, OWNER_NO_PLACE_REVIEW} from './post-exclusion';
import {automaticPlacesEnabled} from './automation';
import {loadPlacesLearning,placesJobMetadata,recordPlacesOutcome} from './learning';

import {assertCompletionAuthority,releaseCompletionAuthority,withoutCompletionInProgress,type CompletionInProgress,type CompletionAuthority} from './completion-ownership';

type Dependencies={resolver?:PlaceResolver;signMedia?:MediaSigner};
type Lease={jobId:string;leaseToken:string};
// Explicit fresh analysis of one completed review. This is separate from
// evidence-preserving recovery: the original payload and job are never reset.
export async function reprocessPlacesResult(ownerId:string,options:{postId:string;sourceJobId:string;inputHash:string;expectedCompletionHash:string;result:unknown;commit:boolean},deps:Dependencies={}) {
  const result=workerResultSchema.parse(options.result);
  const prepared=await preparePlacesPost(ownerId,options.postId,deps);
  if(prepared.input.input_hash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
  validateCoverage(result,prepared.media,prepared.input.caption);
  const sourceWhere={id:options.sourceJobId,ownerId,postId:options.postId,analysisVersion:PLACES_WORKER_VERSION,inputHash:options.inputHash};
  const checkSource=async(client:Prisma.TransactionClient=prisma)=>{
    const source=await client.placeAnalysisJob.findFirst({where:sourceWhere});
    if(!source)throw Error('PLACES_JOB_NOT_FOUND');
    const details=source.result as {completion?:{requestHash?:string}}|null;
    if(source.status!=='NEEDS_REVIEW'||details?.completion?.requestHash!==options.expectedCompletionHash)throw Error('PLACES_JOB_CONFLICT');
    if(await client.placeAnalysisJob.findFirst({where:{ownerId,postId:options.postId,status:'PROCESSING',leaseExpiresAt:{gt:new Date()}}}))throw Error('PLACES_JOB_CONFLICT');
    return source;
  };
  await checkSource();
  const requestHash=digest(result);
  const identity={ownerId,postId:options.postId,analysisVersion:'places-policy-reprocess-v1',
    inputHash:digest({sourceJobId:options.sourceJobId,sourceInputHash:options.inputHash,resolutionPolicy:RESOLUTION_POLICY_VERSION})};
  const priorReceipt=async(client:Prisma.TransactionClient=prisma)=>{
    const previous=await client.placeAnalysisJob.findFirst({where:identity});
    if(!previous)return null;
    const saved=previous.result as {reprocess?:{requestHash?:string;receipt?:AnalyzeRecordResult}}|null;
    if(saved?.reprocess?.requestHash!==requestHash||!saved.reprocess.receipt)throw Error('PLACES_JOB_CONFLICT');
    return saved.reprocess.receipt;
  };
  const prior=await priorReceipt();
  if(prior){
    const current=await inputs(ownerId,options.postId);
    if(current.inputHash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
    await checkSource();
    return prior;
  }
  const plans=await planAll(result.candidates,prepared.input.main_theme,deps.resolver??getConfiguredPlaceResolver({ownerId,postId:options.postId}),
    await loadVerifiedResolutionMemory(ownerId,result.candidates),{caption:prepared.input.caption,structuredLocation:prepared.input.instagram_location});
  if(!options.commit){
    const current=await inputs(ownerId,options.postId);
    if(current.inputHash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
    await checkSource();
    return {postId:options.postId,committed:false,plans};
  }
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${options.postId} AND owner_id=${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${options.sourceJobId} AND owner_id=${ownerId} FOR UPDATE`;
    const current=await inputs(ownerId,options.postId,tx);
    if(current.inputHash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
    await checkSource(tx);
    validateCoverage(result,await loadWorkerMedia(ownerId,options.postId,async()=>'',tx),current.post.caption);
    const cached=await priorReceipt(tx);
    if(cached)return cached;
    await setAuditAction(tx,'places.worker.policy_reprocess');
    const job=await tx.placeAnalysisJob.create({data:{...identity,sourceTheme:current.sourceTheme,depth:'DEEP',status:'PROCESSING',stage:'RESOLVING',attemptCount:1,maxAttempts:1}});
    const receipt=await persistMetadataAnalysis(tx,{ownerId,postId:options.postId,jobId:job.id,plans,preserveExisting:true});
    const saved=await tx.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id},select:{result:true}});
    const details=saved.result&&typeof saved.result==='object'&&!Array.isArray(saved.result)?saved.result:{};
    await tx.placeAnalysisJob.update({where:{id:job.id},data:{result:{...details,
      model:result.model,usage:result.usage,elapsedMs:result.elapsedMs,media:result.media,
      reprocess:{sourceJobId:options.sourceJobId,sourceInputHash:options.inputHash,expectedCompletionHash:options.expectedCompletionHash,requestHash,receipt},
    } as Prisma.InputJsonValue}});
    return receipt;
  },{timeout:30_000});
}
export async function recoverPlacesResult(ownerId:string,options:{postId:string;sourceJobId:string;inputHash:string;originalResult:unknown;sourceCandidateIndices:number[];result:unknown;commit:boolean},deps:Dependencies={}) {
  const result=workerResultSchema.parse(options.result);
  const original=workerResultSchema.parse(options.originalResult);
  const prepared=await preparePlacesPost(ownerId,options.postId,deps);
  if(prepared.input.input_hash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
  validateCoverage(result,prepared.media,prepared.input.caption);
  const source=await prisma.placeAnalysisJob.findFirst({where:{id:options.sourceJobId,ownerId,postId:options.postId,
    analysisVersion:PLACES_WORKER_VERSION,inputHash:options.inputHash,status:{in:['SUCCEEDED','NEEDS_REVIEW']}},
    include:{evidence:{where:{placeId:null,evidenceType:{not:'USER_CORRECTION'}}}}});
  if(!source)throw Error('PLACES_JOB_NOT_FOUND');
  const sourceResult=source.result as {unknownCandidates?:number;completion?:{requestHash?:string}}|null;
  if(sourceResult?.completion?.requestHash!==digest(original))throw Error('PLACES_EVIDENCE_INVALID');
  // Bind updates to the server-accepted original payload, including identity and
  // multiplicity. Shared excerpts must never collapse two original candidates.
  const evidenceKey=(type:string,excerpt:string,timestamp:number|null,mediaId:unknown)=>digest([type,excerpt,timestamp,mediaId??null]);
  const unknown=new Set<number>();
  original.candidates.forEach((candidate,index)=>{
    const normalized=foldForSearch(candidate.name??candidate.city??'')||null;
    if(candidate.evidence.every(e=>source.evidence.some(saved=>saved.normalizedValue===normalized&&saved.confidence===candidate.confidence&&
      evidenceKey(saved.evidenceType,saved.excerpt??'',saved.videoTimestampMs,saved.metadata&&typeof saved.metadata==='object'&&!Array.isArray(saved.metadata)?saved.metadata.mediaId:null)===
      evidenceKey(e.type,e.excerpt,e.videoTimestampMs??null,e.mediaId))))unknown.add(index);
  });
  if(!unknown.size||unknown.size!==sourceResult.unknownCandidates||options.sourceCandidateIndices.length!==result.candidates.length||
    options.sourceCandidateIndices.some(index=>!unknown.has(index))||[...unknown].some(index=>!options.sourceCandidateIndices.includes(index))||
    digest(result.media)!==digest(original.media))throw Error('PLACES_EVIDENCE_INVALID');
  result.candidates.forEach((candidate,index)=>{
    const before=original.candidates[options.sourceCandidateIndices[index]];
    if(digest(candidate.evidence)!==digest(before.evidence)||candidate.category!==before.category||!isSupportedRecovery(before,candidate))throw Error('PLACES_EVIDENCE_INVALID');
  });
  const recoveryVersion='places-contextual-recovery-v1';
  const requestHash=digest({resolutionPolicy:RESOLUTION_POLICY_VERSION,sourceJobId:source.id,sourceCandidateIndices:options.sourceCandidateIndices,result});
  const identity={ownerId,postId:options.postId,inputHash:requestHash,analysisVersion:recoveryVersion};
  const previous=await prisma.placeAnalysisJob.findFirst({where:identity});
  if(previous&&['SUCCEEDED','NEEDS_REVIEW'].includes(previous.status)){
    const saved=previous.result as {recoveryReceipt?:AnalyzeRecordResult}|null;
    if(saved?.recoveryReceipt){
      await assertPostAllowsPlaceAnalysis(ownerId,options.postId);
      return saved.recoveryReceipt;
    }
  }
  const recoveryWhere={ownerId,postId:options.postId,analysisVersion:recoveryVersion};
  const exhausted=(jobs:{result:Prisma.JsonValue}[])=>jobs.length>=4 || (jobs.length>=3&&jobs.some(job=>
    job.result&&typeof job.result==='object'&&!Array.isArray(job.result)&&job.result.resolutionPolicy===RESOLUTION_POLICY_VERSION));
  // One repair after a deployed policy change may follow three legacy attempts.
  // Same-policy retries cannot consume this extra slot or spend provider quota.
  if(exhausted(await prisma.placeAnalysisJob.findMany({where:recoveryWhere,select:{result:true}})))throw Error('PLACES_JOB_CONFLICT');
  const plans=await planAll(result.candidates,prepared.input.main_theme,deps.resolver??getConfiguredPlaceResolver({ownerId,postId:prepared.input.post_id}),await loadVerifiedResolutionMemory(ownerId,result.candidates),{caption:prepared.input.caption,structuredLocation:prepared.input.instagram_location});
  if(!options.commit){
    await assertPostAllowsPlaceAnalysis(ownerId,options.postId);
    return {postId:options.postId,committed:false,plans};
  }
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${options.postId} AND owner_id=${ownerId} FOR UPDATE`;
    const current=await inputs(ownerId,options.postId,tx);
    if(current.inputHash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
    if(await tx.placeAnalysisJob.findFirst({where:{ownerId,postId:options.postId,status:'PROCESSING',leaseExpiresAt:{gt:new Date()}}}))throw Error('PLACES_JOB_CONFLICT');
    const existing=await tx.placeAnalysisJob.findFirst({where:identity});
    if(existing){
      const saved=existing.result as {recoveryReceipt?:AnalyzeRecordResult}|null;
      if(saved?.recoveryReceipt)return saved.recoveryReceipt;
      throw Error('PLACES_JOB_CONFLICT');
    }
    if(exhausted(await tx.placeAnalysisJob.findMany({where:recoveryWhere,select:{result:true}})))throw Error('PLACES_JOB_CONFLICT');
    await setAuditAction(tx,'places.worker.contextual_recovery');
    const job=await tx.placeAnalysisJob.create({data:{...identity,sourceTheme:current.sourceTheme,depth:'METADATA_ONLY',status:'PROCESSING',stage:'RESOLVING',attemptCount:1,maxAttempts:1}});
    const receipt=await persistMetadataAnalysis(tx,{ownerId,postId:options.postId,jobId:job.id,plans,preserveExisting:true});
    const saved=await tx.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id},select:{result:true}});
    const details=saved.result&&typeof saved.result==='object'&&!Array.isArray(saved.result)?saved.result:{};
    await tx.placeAnalysisJob.update({where:{id:job.id},data:{result:{...details,sourceJobId:source.id,sourceCandidateIndices:options.sourceCandidateIndices,sourceInputHash:options.inputHash,recoveryReceipt:receipt} as Prisma.InputJsonValue}});
    return receipt;
  },{timeout:30_000});
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function inputs(ownerId:string,postId:string,client:Prisma.TransactionClient=prisma){
  const post=await loadAnalysisPostInputs(ownerId,postId,client);
  if(!post)throw Error('POST_NOT_FOUND');
  await assertPostAllowsPlaceAnalysis(ownerId,postId,client);
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
    media,categoryRules:PLACE_CLASSIFICATION_RULES+'\n'+PLACE_CONTEXT_RULES,outputSchema:z.toJSONSchema(workerCandidatesSchema)};
}
export async function enqueuePlacesPosts(ownerId:string,options:{postId?:string;cursor?:string}){
  const posts=await prisma.post.findMany({where:{ownerId,...(options.postId?{id:options.postId}:options.cursor?{id:{gt:options.cursor}}:{})},orderBy:{id:'asc'},take:100,select:{id:true,mainTheme:true}});
  if(options.postId&&posts.length===0)throw Error('POST_NOT_FOUND');
  let queued=0;
  for(const post of posts){
    if(!canonicalPlacesTheme(post.mainTheme)){if(options.postId)throw Error('POST_NOT_PLACES_ELIGIBLE');continue;}
    try{
      const created=await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM posts WHERE id=${post.id} AND owner_id=${ownerId} FOR UPDATE`;
        const state=await inputs(ownerId,post.id,tx);
        return tx.placeAnalysisJob.createMany({data:[{ownerId,postId:post.id,inputHash:state.inputHash,analysisVersion:PLACES_WORKER_VERSION,sourceTheme:state.sourceTheme,depth:'DEEP',maxAttempts:3}],skipDuplicates:true});
      });
      queued+=created.count;
    }catch(error){if(error instanceof Error&&['POST_NOT_FOUND','POST_NOT_PLACES_ELIGIBLE'].includes(error.message))continue;throw error;}
  }
  return {queued,nextCursor:!options.postId&&posts.length===100?posts.at(-1)!.id:null};
}
export async function claimPlacesJob(ownerId:string,options:{postId?:string;scope?:'automatic';learning?:boolean},deps:Dependencies={}){
  if(options.scope==='automatic'&&!automaticPlacesEnabled())return null;
  return prisma.$transaction(async tx=>{
    // Serialize admission for this owner, including concurrent API requests.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-worker:${ownerId}`},0))::text`;
    const now=new Date();
    // A provider cooldown is owner-scoped and survives consumer restarts.
    if(await tx.placeAnalysisJob.findFirst({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,result:{path:['infrastructure','providerBlockedUntil'],gt:now.toISOString()}},select:{id:true}}))return null;
    if(await tx.placeAnalysisJob.findFirst({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,status:'PROCESSING',leaseExpiresAt:{gt:now}}}))return null;
    for(let scan=0;scan<100;scan++){
      const job=await tx.placeAnalysisJob.findFirst({where:{ownerId,analysisVersion:PLACES_WORKER_VERSION,...(options.scope==='automatic'?{result:{path:['automation','source'],equals:'sync'}}:{}),...(options.postId?{postId:options.postId}:{}),OR:[{status:'PENDING',OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]},{status:'PROCESSING',leaseExpiresAt:{lte:now}}]},orderBy:[{priority:'desc'},{createdAt:'asc'},{id:'asc'}]});
      if(!job)return null;
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${job.postId} AND owner_id=${ownerId} FOR UPDATE`;
      // Re-read after the post lock: a review may have cancelled this candidate
      // while admission waited. Exhaustion also runs under post-before-job order.
      const currentJob=await tx.placeAnalysisJob.findFirst({where:{id:job.id,ownerId}});
      if(!currentJob||!['PENDING','PROCESSING'].includes(currentJob.status))continue;
      if(currentJob.status==='PROCESSING'&&(!currentJob.leaseExpiresAt||currentJob.leaseExpiresAt>now))continue;
      if(currentJob.status==='PENDING'&&currentJob.nextAttemptAt&&currentJob.nextAttemptAt>now)continue;
      if(await hasOwnerNoPlaceConfirmation(ownerId,job.postId,tx)){
        await tx.placeAnalysisJob.updateMany({where:{id:job.id,ownerId},data:{status:'CANCELLED',stage:'COMPLETE',errorCode:OWNER_NO_PLACE_REVIEW,errorMessage:null,completedAt:now,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,nextAttemptAt:null}});
        continue;
      }
      if(currentJob.attemptCount>=currentJob.maxAttempts){
        await tx.placeAnalysisJob.updateMany({where:{id:job.id,ownerId},data:{status:'FAILED',stage:'COMPLETE',errorCode:'ATTEMPTS_EXHAUSTED',completedAt:now,leaseOwner:null,leaseExpiresAt:null}});
        continue;
      }
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
      const learning=options.learning?await loadPlacesLearning(tx,ownerId,currentJob,prepared.input.caption,prepared.media):undefined;
      const leaseToken=randomUUID();
      await tx.placeAnalysisJob.update({where:{id:job.id},data:{result:{...withoutCompletionInProgress(currentJob.result),learningClaim:learning?{shape:learning.shape,context:learning.context}:null},status:'PROCESSING',stage:'EXTRACTING',leaseOwner:leaseToken,leaseExpiresAt:new Date(now.getTime()+PLACES_WORKER_LEASE_MS),heartbeatAt:now,claimedAt:now,startedAt:job.startedAt??now,attemptCount:{increment:1},nextAttemptAt:null,errorCode:null,errorMessage:null}});
      return {jobId:job.id,leaseToken,heartbeatIntervalMs:30_000,...prepared,...(learning?{learningContext:learning.context}:{})};
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

// Explicit recovery only: keep the original identity and attempt history, and
// never requeue successes, live claims, changed inputs or another owner's job.
export async function retryPlacesJob(ownerId:string,options:{jobId:string;postId:string;inputHash:string;repairInfrastructure?:boolean}){
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${options.postId} AND owner_id=${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${options.jobId} AND owner_id=${ownerId} FOR UPDATE`;
    const job=await tx.placeAnalysisJob.findFirst({where:{id:options.jobId,postId:options.postId,ownerId,analysisVersion:PLACES_WORKER_VERSION}});
    if(!job)throw Error('PLACES_JOB_NOT_FOUND');
    const current=await inputs(ownerId,options.postId,tx);
    if(current.inputHash!==options.inputHash||job.inputHash!==options.inputHash)throw Error('PLACES_INPUT_STALE');
    if(job.status!=='FAILED')return {requeued:false};
    const metadata=withoutCompletionInProgress(job.result),repair=options.repairInfrastructure===true;
    if(repair){
      if(!repairableFailureCodes.has(job.errorCode??'')||metadata.infrastructureRepair||job.maxAttempts>=6||job.attemptCount>=6)return {requeued:false};
    }else if(job.errorCode!=='INVALID_RESULT'||job.attemptCount>=job.maxAttempts)return {requeued:false};
    await setAuditAction(tx,repair?'places.worker.repair_infrastructure':'places.worker.retry');
    await tx.placeAnalysisJob.update({where:{id:job.id},data:{status:'PENDING',stage:'QUEUED',errorCode:null,errorMessage:null,
      result:metadata,...(repair?{maxAttempts:Math.min(6,job.maxAttempts+3),result:{...metadata,
        infrastructureRepair:{at:new Date().toISOString(),priorErrorCode:job.errorCode,attemptCount:job.attemptCount,maxAttempts:job.maxAttempts,infrastructure:metadata.infrastructure??null,learning:metadata.learning??null},infrastructure:{...placesJobMetadata(metadata.infrastructure??null),deferrals:0}}}:{}),
      nextAttemptAt:null,completedAt:null,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null}});
    return {requeued:true};
  },{timeout:30_000});
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
  const plans=await planAll(result.candidates,prepared.input.main_theme,deps.resolver??getConfiguredPlaceResolver({ownerId,postId:prepared.input.post_id}),await loadVerifiedResolutionMemory(ownerId,result.candidates),{caption:prepared.input.caption,structuredLocation:prepared.input.instagram_location});
  await assertPostAllowsPlaceAnalysis(ownerId,options.postId);
  return {postId:options.postId,committed:false,plans};
}
function completedReceipt(job:Awaited<ReturnType<typeof loadLease>>,requestHash:string,leaseHash:string):AnalyzeRecordResult|null{
  if(!['SUCCEEDED','NEEDS_REVIEW'].includes(job.status))return null;
  const saved=job.result as {completion?:{requestHash:string;leaseHash:string;receipt:AnalyzeRecordResult}}|null;
  if(saved?.completion?.requestHash===requestHash&&saved.completion.leaseHash===leaseHash)return saved.completion.receipt;
  throw Error('PLACES_LEASE_LOST');
}
async function awaitCompletionReceipt(ownerId:string,postId:string,authority:CompletionAuthority,requestHash:string,leaseHash:string):Promise<AnalyzeRecordResult>{
  // Stay below the consumer's 240 s transport deadline. Both a wall-clock bound
  // and a poll-count bound apply; no follower can become a second producer.
  const deadline=Date.now()+230_000;
  for(let poll=0;poll<230&&Date.now()<deadline;poll++){
    const job=await prisma.placeAnalysisJob.findFirst({where:{id:authority.jobId,ownerId,postId,analysisVersion:PLACES_WORKER_VERSION}});
    if(!job)throw Error('PLACES_JOB_NOT_FOUND');
    await assertPostAllowsPlaceAnalysis(ownerId,postId);
    const receipt=completedReceipt(job,requestHash,leaseHash);
    if(receipt)return receipt;
    const marker=placesJobMetadata(job.result).completionInProgress as CompletionInProgress|undefined;
    if(job.status!=='PROCESSING'||job.leaseOwner!==authority.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=new Date())throw Error('PLACES_LEASE_LOST');
    if(!marker)throw Error('PLACES_COMPLETION_PENDING');
    if(marker.leaseHash!==leaseHash)throw Error('PLACES_LEASE_LOST');
    if(marker.requestHash!==requestHash)throw Error('PLACES_JOB_CONFLICT');
    if(marker.token!==authority.completionToken)throw Error('PLACES_COMPLETION_PENDING');
    await delay(Math.max(0,Math.min(1000,deadline-Date.now())));
  }
  throw Error('PLACES_COMPLETION_PENDING');
}
export async function completePlacesJob(ownerId:string,options:Lease&{result:unknown},deps:Dependencies={}):Promise<AnalyzeRecordResult>{
  const result=workerResultSchema.parse(options.result),requestHash=digest(result),leaseHash=digest(options.leaseToken);
  const existing=await prisma.placeAnalysisJob.findFirst({where:{id:options.jobId,ownerId,analysisVersion:PLACES_WORKER_VERSION}});
  if(!existing)throw Error('PLACES_JOB_NOT_FOUND');
  await assertPostAllowsPlaceAnalysis(ownerId,existing.postId);
  const replay=completedReceipt(existing,requestHash,leaseHash);
  if(replay)return replay;
  if(existing.status!=='PROCESSING'||existing.leaseOwner!==options.leaseToken||!existing.leaseExpiresAt||existing.leaseExpiresAt<=new Date())throw Error('PLACES_LEASE_LOST');
  const prepared=await preparePlacesPost(ownerId,existing.postId,deps);
  if(prepared.input.input_hash!==existing.inputHash)throw Error('PLACES_INPUT_STALE');
  validateCoverage(result,prepared.media,prepared.input.caption);
  const admission=await prisma.$transaction(async tx=>{
    // Keep the existing post-before-job order. All provider work is outside TX.
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${existing.postId} AND owner_id=${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${existing.id} AND owner_id=${ownerId} FOR UPDATE`;
    await assertPostAllowsPlaceAnalysis(ownerId,existing.postId,tx);
    const locked=await tx.placeAnalysisJob.findFirst({where:{id:existing.id,ownerId}});
    if(!locked)throw Error('PLACES_JOB_NOT_FOUND');
    const receipt=completedReceipt(locked,requestHash,leaseHash);
    if(receipt)return {kind:'receipt' as const,receipt};
    const job=await loadLease(ownerId,options,tx);
    const current=await inputs(ownerId,job.postId,tx);
    if(current.inputHash!==job.inputHash)throw Error('PLACES_INPUT_STALE');
    validateCoverage(result,await loadWorkerMedia(ownerId,job.postId,async()=>'',tx),current.post.caption);
    const marker=placesJobMetadata(job.result).completionInProgress as CompletionInProgress|undefined;
    if(marker){
      if(marker.leaseHash!==leaseHash||!marker.token)throw Error('PLACES_LEASE_LOST');
      if(marker.requestHash!==requestHash)throw Error('PLACES_JOB_CONFLICT');
      return {kind:'follower' as const,job,authority:{jobId:job.id,leaseToken:options.leaseToken,completionToken:marker.token}};
    }
    const completionToken=randomUUID();
    await setAuditAction(tx,'places.worker.completion_admit');
    await tx.placeAnalysisJob.update({where:{id:job.id},data:{stage:'RESOLVING',result:{...placesJobMetadata(job.result),
      completionInProgress:{requestHash,leaseHash,token:completionToken}}}});
    return {kind:'owner' as const,job,authority:{jobId:job.id,leaseToken:options.leaseToken,completionToken}};
  },{timeout:30_000});
  if(admission.kind==='receipt')return admission.receipt;
  const {job,authority}=admission;
  if(admission.kind==='follower')return awaitCompletionReceipt(ownerId,job.postId,authority,requestHash,leaseHash);
  try{
    const guard=()=>assertCompletionAuthority(ownerId,job.postId,authority);
    const resolver=deps.resolver??getConfiguredPlaceResolver({ownerId,postId:job.postId,completionAuthority:authority});
    const plans=await planAll(result.candidates,prepared.input.main_theme,resolver,
      await loadVerifiedResolutionMemory(ownerId,result.candidates),{caption:prepared.input.caption,structuredLocation:prepared.input.instagram_location},guard);
    return await prisma.$transaction(async tx=>{
      // A concurrent admin delete/update wins before this gate or waits until the
      // entire domain transaction has committed. The computation token is fenced.
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${job.postId} AND owner_id=${ownerId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${job.id} AND owner_id=${ownerId} FOR UPDATE`;
      await assertPostAllowsPlaceAnalysis(ownerId,job.postId,tx);
      await assertCompletionAuthority(ownerId,job.postId,authority,tx);
      const locked=await loadLease(ownerId,options,tx);
      const current=await inputs(ownerId,job.postId,tx);
      if(current.inputHash!==job.inputHash)throw Error('PLACES_INPUT_STALE');
      const currentMedia=await loadWorkerMedia(ownerId,job.postId,async()=>'',tx);
      validateCoverage(result,currentMedia,current.post.caption);
      await setAuditAction(tx,'places.worker.complete');
      const receipt=await persistMetadataAnalysis(tx,{ownerId,postId:job.postId,jobId:job.id,plans});
      const saved=await tx.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id},select:{result:true}});
      const decisions=placesJobMetadata(saved.result);
      await tx.placeAnalysisJob.update({where:{id:job.id},data:{leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,result:{...recordPlacesOutcome({...withoutCompletionInProgress(locked.result),...decisions},{attempt:locked.attemptCount,status:receipt.status==='SUCCEEDED'?'SUCCEEDED':'NEEDS_REVIEW'}),...receipt,model:result.model,usage:result.usage,elapsedMs:result.elapsedMs,media:result.media,completion:{requestHash,leaseHash,receipt}} as Prisma.InputJsonValue}});
      return receipt;
    },{timeout:30_000});
  }catch(error){
    // A lost response after commit is harmless: terminal receipts cannot be
    // released. If cleanup itself fails, normal lease/reclaim still fences it.
    await releaseCompletionAuthority(ownerId,job.postId,authority).catch(()=>undefined);
    throw error;
  }
}
export async function failPlacesJob(ownerId:string,options:Lease&{code:string;retryAfterMs?:number}){
  return prisma.$transaction(async tx=>{
    // Serialize provider cooldown admission with claims, then fence the live lease.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-worker:${ownerId}`},0))::text`;
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${options.jobId} AND owner_id=${ownerId} FOR UPDATE`;
    const job=await loadLease(ownerId,options,tx),now=new Date();
    const metadata=withoutCompletionInProgress(job.result);
    const adaptive=Boolean(metadata.learningClaim)||(metadata.automation as {source?:string}|undefined)?.source==='sync';
    const infrastructure=deferredFailureCodes.has(options.code);
    const prior=metadata.infrastructure as {deferrals?:unknown}|undefined;
    const count=typeof prior?.deferrals==='number'&&Number.isInteger(prior.deferrals)&&prior.deferrals>=0?prior.deferrals:0;
    const deferrals=Math.min(7,count+1),deferred=infrastructure&&deferrals<=6;
    const retryable=deferred||(!infrastructure&&(['MEDIA_UNAVAILABLE','MEDIA_DOWNLOAD_FAILED','ASR_FAILED','INFERENCE_FAILED','WORKER_STOPPING','WORKER_TIMEOUT'].includes(options.code)||(adaptive&&['INVALID_RESULT','PLACES_EVIDENCE_INVALID'].includes(options.code)))&&job.attemptCount<job.maxAttempts);
    const providerDelay=options.code==='INFERENCE_BUSY'&&Number.isFinite(options.retryAfterMs)?Math.max(0,Math.min(900_000,options.retryAfterMs!)):0;
    const waitMs=Math.max(providerDelay,infrastructure?Math.min(900_000,60_000*2**Math.min(deferrals-1,4)):job.attemptCount===1?60_000:300_000);
    // Environment/provider deferrals do not teach extraction rules or replace
    // an earlier outcome for the refunded attempt. Their budget stays durable.
    const result=infrastructure?{...metadata,infrastructure:{deferrals,lastCode:options.code,lastAt:now.toISOString(),...(providerDelay?{providerBlockedUntil:new Date(now.getTime()+providerDelay).toISOString()}:{})}}:recordPlacesOutcome(metadata,{attempt:job.attemptCount,status:'FAILED',code:options.code});
    await setAuditAction(tx,'places.worker.fail');
    const updated=await tx.placeAnalysisJob.updateMany({where:{id:job.id,ownerId,status:'PROCESSING',leaseOwner:options.leaseToken,leaseExpiresAt:{gt:now}},data:{status:retryable?'PENDING':'FAILED',stage:retryable?'QUEUED':'COMPLETE',errorCode:options.code,errorMessage:null,leaseOwner:null,leaseExpiresAt:null,heartbeatAt:null,
      ...(deferred?{attemptCount:Math.max(0,job.attemptCount-1)}:{}),nextAttemptAt:retryable?new Date(now.getTime()+waitMs):null,completedAt:retryable?null:now,result}});
    if(updated.count!==1)throw Error('PLACES_LEASE_LOST');
    return {ok:true,retryable};
  });
}
