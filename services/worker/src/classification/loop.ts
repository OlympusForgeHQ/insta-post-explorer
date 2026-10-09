import {setTimeout as delay} from 'node:timers/promises';

type Dependencies={
 evaluate?:(signal:AbortSignal)=>Promise<unknown>;
 translateOnce?:(signal:AbortSignal)=>Promise<{status:string}>;
 runOnce:(signal:AbortSignal)=>Promise<{status:string}>;
 cleanup:()=>Promise<unknown>;
 log?:(event:Record<string,unknown>)=>void;
};

export async function runClassificationLoop(deps:Dependencies,stop:AbortSignal){
 let nextEvaluation=0;
 while(!stop.aborted){
  let wait=15_000;
  try{
   // Shutdown drains owned work; each runner retains its own bounded deadline.
   const active=new AbortController().signal;
   let result=await deps.runOnce(active);
   if(result.status==='idle'&&!stop.aborted&&deps.translateOnce)result=await deps.translateOnce(active);
   await deps.cleanup();
   if(result.status==='idle'&&!stop.aborted&&deps.evaluate&&Date.now()>=nextEvaluation){
    nextEvaluation=Date.now()+86400_000;
    try{await deps.evaluate(AbortSignal.any([stop,AbortSignal.timeout(10_000)]));}catch{deps.log?.({stage:'learning_evaluation_failed'});}
   }
   if(result.status==='SUCCEEDED')wait=0;
  }catch{
   if(!stop.aborted){deps.log?.({stage:'classification_poll_failed'});wait=60_000;}
  }
  if(!stop.aborted&&wait>0)await delay(wait,undefined,{signal:stop}).catch(()=>undefined);
 }
}
