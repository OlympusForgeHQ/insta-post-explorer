import {setTimeout as delay} from 'node:timers/promises';

type Dependencies={
 runOnce:(signal:AbortSignal)=>Promise<{status:string}>;
 cleanup:()=>Promise<unknown>;
 log?:(event:Record<string,unknown>)=>void;
};

export async function runClassificationLoop(deps:Dependencies,stop:AbortSignal){
 while(!stop.aborted){
  let wait=15_000;
  try{
   const result=await deps.runOnce(stop);
   await deps.cleanup();
   if(result.status==='SUCCEEDED')wait=0;
  }catch{
   if(!stop.aborted){deps.log?.({stage:'classification_poll_failed'});wait=60_000;}
  }
  if(!stop.aborted&&wait>0)await delay(wait,undefined,{signal:stop}).catch(()=>undefined);
 }
}
