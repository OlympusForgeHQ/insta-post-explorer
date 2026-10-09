import {afterEach,describe,expect,it,vi} from 'vitest';
import {runClassificationLoop} from '../src/classification/loop.js';

const clock=vi.hoisted(()=>({waits:[] as Array<{ms:number;release:()=>void}>}));
vi.mock('node:timers/promises',()=>({setTimeout:(ms:number,_value:unknown,{signal}:{signal:AbortSignal})=>new Promise<void>((resolve,reject)=>{
 const abort=()=>reject(Error('aborted'));
 signal.addEventListener('abort',abort,{once:true});
 clock.waits.push({ms,release:()=>{signal.removeEventListener('abort',abort);resolve();}});
 if(signal.aborted)abort();
})}));
afterEach(()=>{clock.waits=[];});
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}

describe('Classification consumer scheduling',()=>{
 it('finishes and cleans the active job before claiming the next without a busy pause',async()=>{
  const stop=new AbortController(),events:string[]=[];
  let finish!:()=>void;
  const active=new Promise<void>(resolve=>{finish=resolve;});
  let count=0;
  const running=runClassificationLoop({runOnce:async()=>{events.push(`claim-${++count}`);if(count===1)await active;else stop.abort();return {status:'SUCCEEDED'};},cleanup:async()=>{events.push('cleanup');}},stop.signal);
  try{
   await settle();expect(events).toEqual(['claim-1']);
   finish();await settle();
   expect(events).toEqual(['claim-1','cleanup','claim-2','cleanup']);
   expect(clock.waits).toEqual([]);
  }finally{stop.abort();finish();await running;}
 });

 it('drains an active job on shutdown without aborting its lease or claiming again',async()=>{
  const stop=new AbortController();let finish!:()=>void,activeSignal!:AbortSignal;let claims=0;
  const active=new Promise<void>(resolve=>{finish=resolve;});
  const running=runClassificationLoop({runOnce:async signal=>{claims++;activeSignal=signal;await active;return {status:'SUCCEEDED'};},cleanup:async()=>{}},stop.signal);
  await settle();stop.abort();expect(activeSignal.aborted).toBe(false);finish();await running;expect(claims).toBe(1);
 });

 it.each(['SUCCEEDED','idle'])('only polls translations after classification is idle (%s)',async status=>{
  const stop=new AbortController(),events:string[]=[];
  const running=runClassificationLoop({runOnce:async()=>{events.push('classification');if(status!=='idle')stop.abort();return {status};},translateOnce:async()=>{events.push('translation');stop.abort();return {status:'SUCCEEDED'};},cleanup:async()=>{}},stop.signal);
  await running;expect(events).toEqual(status==='idle'?['classification','translation']:['classification']);
 });

 it.each(['idle','NEEDS_REVIEW','FAILED','CANCELLED'])('waits after %s and cancels the wait on shutdown',async status=>{
  const stop=new AbortController();let claims=0,cleanups=0;
  const running=runClassificationLoop({runOnce:async()=>{claims++;return {status};},cleanup:async()=>{cleanups++;}},stop.signal);
  await settle();
  expect(claims).toBe(1);expect(cleanups).toBe(1);expect(clock.waits.map(w=>w.ms)).toEqual([15000]);
  stop.abort();await running;expect(claims).toBe(1);
 });

 it.each(['poll','cleanup'])('backs off for a %s failure before claiming more work',async stage=>{
  const stop=new AbortController(),logs:Record<string,unknown>[]=[];let claims=0;
  const running=runClassificationLoop({runOnce:async()=>{claims++;if(stage==='poll')throw Error('API_UNAVAILABLE');return {status:'SUCCEEDED'};},cleanup:async()=>{if(stage==='cleanup')throw Error('CLEANUP_FAILED');},log:event=>logs.push(event)},stop.signal);
  await settle();
  expect(claims).toBe(1);expect(clock.waits.map(w=>w.ms)).toEqual([60000]);expect(logs).toEqual([{stage:'classification_poll_failed'}]);
  stop.abort();await running;expect(claims).toBe(1);
 });
});

it('evaluates only when idle and isolates evaluation errors from the processing loop',async()=>{
 const stop=new AbortController();let evaluations=0,cleanups=0;
 await runClassificationLoop({runOnce:async()=>({status:'idle'}),translateOnce:async()=>({status:'idle'}),cleanup:async()=>{cleanups++;},evaluate:async()=>{evaluations++;stop.abort();throw Error('unavailable');}},stop.signal);
 expect(evaluations).toBe(1);expect(cleanups).toBe(1);
});
