import { setTimeout as delay } from 'node:timers/promises';
import type { TempWorkdirManager } from '../runtime/temp-workdir.js';
import { preparedSchema, type PlacesApi, type PreparedPost } from './api.js';

export type PipelineResult={candidates:Record<string,unknown>[];media:unknown[];model:string;usage:{inputTokens:number;outputTokens:number};elapsedMs:number};
type Options={limit:number;commit:boolean;postId?:string;signal:AbortSignal};
type Dependencies={api:PlacesApi;workdirs:TempWorkdirManager;analyze:(prepared:PreparedPost,dir:string,signal:AbortSignal)=>Promise<PipelineResult>;log?:(event:Record<string,unknown>)=>void};
const failureCodes=new Set(['MEDIA_UNAVAILABLE','MEDIA_LIMIT','INFERENCE_FAILED','INVALID_RESULT','WORKER_STOPPING','WORKER_TIMEOUT']);
export async function runPlacesPipeline(options:Options,deps:Dependencies){
  if(!Number.isInteger(options.limit)||options.limit<1||options.limit>50||(!options.commit&&!options.postId))throw Error('PLACES_OPTIONS_INVALID');
  const summary={succeeded:0,failed:0,receipts:[] as unknown[]};
  for(let index=0;index<options.limit;index++){
    options.signal.throwIfAborted();
    const raw=await deps.api.call({action:options.commit?'claim':'prepare',...(options.postId?{postId:options.postId}:{})},options.signal);
    if(raw===null)break;
    const prepared=preparedSchema.parse(raw);
    if(options.commit&&(!prepared.jobId||!prepared.leaseToken))throw Error('INVALID_RESULT');
    const lease={jobId:prepared.jobId,leaseToken:prepared.leaseToken};
    const dir=await deps.workdirs.create(prepared.jobId??'preview');
    const heartbeatStop=new AbortController(),lostLease=new AbortController();
    const signal=AbortSignal.any([options.signal,lostLease.signal,AbortSignal.timeout(1_200_000)]);
    let finishing=false;
    const heartbeat=options.commit?(async()=>{
      try{
        while(true){
          await delay(prepared.heartbeatIntervalMs??30_000,undefined,{signal:heartbeatStop.signal});
          await deps.api.call({action:'heartbeat',...lease},AbortSignal.any([heartbeatStop.signal,signal]));
        }
      }catch{if(!heartbeatStop.signal.aborted&&!finishing)lostLease.abort();}
    })():Promise.resolve();
    try{
      deps.log?.({postId:prepared.input.post_id,stage:'started'});
      const result=await deps.analyze(prepared,dir,signal);
      signal.throwIfAborted();
      // Renew before stopping heartbeats. Completion is bounded below the lease
      // duration and may be replayed safely after a lost HTTP response.
      if(options.commit)await deps.api.call({action:'heartbeat',...lease},signal);
      finishing=true;heartbeatStop.abort();await heartbeat;
      const receipt=await deps.api.call(options.commit?{action:'complete',...lease,result}:{action:'preview',postId:prepared.input.post_id,inputHash:prepared.input.input_hash,result},signal);
      summary.receipts.push(receipt);summary.succeeded++;
      deps.log?.({postId:prepared.input.post_id,stage:options.commit?'completed':'previewed',usage:result.usage,elapsedMs:result.elapsedMs});
    }catch(error){
      summary.failed++;
      const code=options.signal.aborted?'WORKER_STOPPING':signal.aborted?'WORKER_TIMEOUT':error instanceof Error&&error.message==='API_UNAVAILABLE'?'INFERENCE_FAILED':error instanceof Error&&failureCodes.has(error.message)?error.message:'INVALID_RESULT';
      if(options.commit)await deps.api.call({action:'fail',...lease,code},AbortSignal.timeout(15_000)).catch(()=>undefined);
      deps.log?.({postId:prepared.input.post_id,stage:'failed',code});
    }finally{
      finishing=true;heartbeatStop.abort();await heartbeat;await deps.workdirs.remove(dir);
    }
    if(!options.commit||options.postId||options.signal.aborted)break;
  }
  return summary;
}
