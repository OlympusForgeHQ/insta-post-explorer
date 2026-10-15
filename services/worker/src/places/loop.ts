import {setTimeout as delay} from 'node:timers/promises';

type Dependencies={
 runOnce:(signal:AbortSignal)=>Promise<{succeeded:number;failed:number}>;
 cleanup:()=>Promise<unknown>;
 log?:(event:Record<string,unknown>)=>void;
};
export async function runPlacesLoop(deps:Dependencies,stop:AbortSignal){
 while(!stop.aborted){
  let wait=15_000;
  try{
   // Drain a claimed post on shutdown. The pipeline enforces its own deadline.
   const result=await deps.runOnce(new AbortController().signal);
   await deps.cleanup();
   wait=result.failed?60_000:result.succeeded?0:15_000;
  }catch{
   deps.log?.({stage:'places_poll_failed'});wait=60_000;
  }
  if(!stop.aborted&&wait)await delay(wait,undefined,{signal:stop}).catch(()=>undefined);
 }
}
