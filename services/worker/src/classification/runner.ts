import {setTimeout as delay} from 'node:timers/promises';
import type {TempWorkdirManager} from '../runtime/temp-workdir.js';
import {classificationClaimSchema,type ClassificationApi,type ClassificationClaim} from './api.js';
export type ClassificationAnalysis={status:'SUCCEEDED'|'NEEDS_REVIEW';mainTheme:string|null;tags:string[];reason:string;media:unknown[];model:string;usage:{inputTokens:number;outputTokens:number};elapsedMs:number};
export type ClassificationDependencies={api:ClassificationApi;workdirs:TempWorkdirManager;analyze:(claim:ClassificationClaim,dir:string,signal:AbortSignal)=>Promise<ClassificationAnalysis>;log?:(event:Record<string,unknown>)=>void};
export async function runClassificationOnce(deps:ClassificationDependencies,stop:AbortSignal){
 const raw=await deps.api.call({action:'claim'},stop);if(raw===null)return {status:'idle'};
 const claim=classificationClaimSchema.parse(raw),lease={jobId:claim.jobId,leaseToken:claim.leaseToken};let dir:string|undefined;let finishing=false;
 const heartbeatStop=new AbortController(),lost=new AbortController();const signal=AbortSignal.any([stop,lost.signal,AbortSignal.timeout(1_200_000)]);
 const heartbeat=(async()=>{try{while(true){await delay(30_000,undefined,{signal:heartbeatStop.signal});await deps.api.call({action:'heartbeat',...lease},AbortSignal.any([heartbeatStop.signal,signal]));}}catch{if(!heartbeatStop.signal.aborted&&!finishing)lost.abort();}})();
 try{
  dir=await deps.workdirs.create(claim.jobId);deps.log?.({stage:'classification_started',postId:claim.input.post_id,jobId:claim.jobId});
  const result=await deps.analyze(claim,dir,signal);signal.throwIfAborted();
  await deps.api.call({action:'heartbeat',...lease},signal);finishing=true;heartbeatStop.abort();await heartbeat;
  await deps.api.call({action:'complete',...lease,result},signal);
  deps.log?.({stage:'classification_completed',jobId:claim.jobId,postId:claim.input.post_id,status:result.status,usage:result.usage,elapsedMs:result.elapsedMs});
  return {status:result.status};
 }catch(error){
  const message=error instanceof Error?error.message:'';const cancelled=lost.signal.aborted||['CLASSIFICATION_INPUT_STALE','CLASSIFICATION_LEASE_LOST','NOT_FOUND'].includes(message);
  const code=stop.aborted?'WORKER_STOPPING':signal.aborted?'WORKER_TIMEOUT':['MEDIA_UNAVAILABLE','MEDIA_LIMIT','INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT'].includes(message)?message:message==='API_UNAVAILABLE'?'INFERENCE_FAILED':'INVALID_RESULT';
  if(!cancelled)await deps.api.call({action:'fail',...lease,code},AbortSignal.timeout(15_000)).catch(()=>undefined);
  deps.log?.({stage:'classification_failed',jobId:claim.jobId,postId:claim.input.post_id,code:cancelled?'CLASSIFICATION_LEASE_LOST':code});return {status:cancelled?'CANCELLED':'FAILED'};
 }finally{finishing=true;heartbeatStop.abort();await heartbeat;if(dir)await deps.workdirs.remove(dir);}
}
