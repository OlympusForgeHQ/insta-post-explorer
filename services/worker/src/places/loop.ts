import {setTimeout as delay} from 'node:timers/promises';
import {runtimeFailureCodes} from './learning.js';

type Dependencies={
 checkRuntime?:(signal:AbortSignal)=>Promise<void>;
 runOnce:(signal:AbortSignal)=>Promise<{succeeded:number;failed:number;failureCodes?:string[];retryAfterMs?:number}>;
 cleanup:()=>Promise<unknown>;
 log?:(event:Record<string,unknown>)=>void;
};
export async function runPlacesLoop(deps:Dependencies,stop:AbortSignal){
 let ready=!deps.checkRuntime,failures=0;
 const cooldown=()=>Math.min(900_000,60_000*2**Math.min(failures++,4));
 while(!stop.aborted){
  let wait=15_000;
  if(!ready){
   try{await deps.checkRuntime!(stop);ready=true;deps.log?.({stage:'places_runtime_ready'});}
   catch(error){
    if(stop.aborted)break;
    const message=error instanceof Error?error.message:'';
    const code=runtimeFailureCodes.has(message)?message:'ASR_UNAVAILABLE';
    wait=cooldown();deps.log?.({stage:'places_runtime_unavailable',code,retryAfterMs:wait});
    await delay(wait,undefined,{signal:stop}).catch(()=>undefined);continue;
   }
  }
  if(stop.aborted)break;
  try{
   // Drain a claimed post on shutdown. The pipeline enforces its own deadline.
   const result=await deps.runOnce(new AbortController().signal);
   if(result.failureCodes?.some(code=>runtimeFailureCodes.has(code)))ready=!deps.checkRuntime;
   await deps.cleanup();
   if(result.succeeded&&!result.failed&&ready){failures=0;wait=0;}
   else wait=Math.max(result.failed||!ready?cooldown():15_000,Math.min(900_000,Math.max(0,result.retryAfterMs??0)));
  }catch{
   ready=!deps.checkRuntime;wait=cooldown();deps.log?.({stage:'places_poll_failed',retryAfterMs:wait});
  }
  if(!stop.aborted&&wait)await delay(wait,undefined,{signal:stop}).catch(()=>undefined);
 }
}
