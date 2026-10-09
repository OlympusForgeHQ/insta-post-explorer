import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {learningContextSchema,LearningTracker} from './learning.js';
import type {ClassificationApi} from './api.js';
import {CAPTION_TRANSLATION_TIMEOUT_MS,translationResultSchema,type TranslationResult} from './translation-contract.js';
const claimSchema=z.object({learningContext:learningContextSchema.optional(),jobId:z.string().min(1),leaseToken:z.string().uuid(),input:z.object({post_id:z.string().min(1),input_hash:z.string().min(1),caption:z.string().max(100_000)})});
type Deps={learningEnabled?:boolean;api:ClassificationApi;analyze:(caption:string,signal:AbortSignal,tracker?:LearningTracker)=>Promise<TranslationResult>;log?:(event:Record<string,unknown>)=>void};
export async function runCaptionTranslationOnce(deps:Deps,stop:AbortSignal){
 const raw=await deps.api.call({action:'claim',...(deps.learningEnabled?{learning:true}:{})},stop);if(raw===null)return {status:'idle'};
 const claim=claimSchema.parse(raw),lease={jobId:claim.jobId,leaseToken:claim.leaseToken};
 const tracker=claim.learningContext?new LearningTracker(claim.learningContext):undefined;
 const heartbeatStop=new AbortController(),lost=new AbortController();let finishing=false;
 const signal=AbortSignal.any([stop,lost.signal,AbortSignal.timeout(CAPTION_TRANSLATION_TIMEOUT_MS)]);
 const heartbeat=(async()=>{try{while(true){await delay(30_000,undefined,{signal:heartbeatStop.signal});await deps.api.call({action:'heartbeat',...lease},AbortSignal.any([heartbeatStop.signal,signal]));}}catch{if(!heartbeatStop.signal.aborted&&!finishing)lost.abort();}})();
 try{
  deps.log?.({stage:'caption_translation_started',jobId:claim.jobId,postId:claim.input.post_id});
  const result=translationResultSchema.parse(await deps.analyze(claim.input.caption,signal,tracker));signal.throwIfAborted();
  await deps.api.call({action:'heartbeat',...lease},signal);finishing=true;heartbeatStop.abort();await heartbeat;
  await deps.api.call({action:'complete',...lease,result,...(tracker?{learning:tracker.report(result.elapsedMs,result.usage)}:{})},signal);
  deps.log?.({stage:'caption_translation_completed',jobId:claim.jobId,postId:claim.input.post_id,decision:result.decision,languages:result.sourceLanguages,usage:result.usage,elapsedMs:result.elapsedMs});
  return {status:result.decision==='NEEDS_REVIEW'?'NEEDS_REVIEW':'SUCCEEDED'};
 }catch(error){
  const message=error instanceof Error?error.message:'';const stale=lost.signal.aborted||['CLASSIFICATION_INPUT_STALE','CLASSIFICATION_LEASE_LOST','NOT_FOUND'].includes(message);
  const code=signal.aborted?'WORKER_TIMEOUT':['INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT','CAPTION_LIMIT'].includes(message)?message:message==='API_UNAVAILABLE'?'INFERENCE_FAILED':'INVALID_RESULT';
  tracker?.observe({stage:'learning_failure',code});
  if(!stale)await deps.api.call({action:'fail',...lease,code,...(tracker?{learning:tracker.report()}:{})},AbortSignal.timeout(15_000)).catch(()=>undefined);
  deps.log?.({stage:'caption_translation_failed',jobId:claim.jobId,code:stale?'CLASSIFICATION_LEASE_LOST':code});return {status:stale?'CANCELLED':'FAILED'};
 }finally{finishing=true;heartbeatStop.abort();await heartbeat;}
}
