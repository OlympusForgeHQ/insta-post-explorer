import {afterEach,expect,it,vi} from 'vitest';
import {runPlacesLoop} from '../src/places/loop.js';
const clock=vi.hoisted(()=>({waits:[] as number[],releases:[] as (()=>void)[]}));
vi.mock('node:timers/promises',()=>({setTimeout:(ms:number,_value:unknown,{signal}:{signal:AbortSignal})=>new Promise<void>((resolve,reject)=>{clock.waits.push(ms);clock.releases.push(resolve);signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});if(signal.aborted)resolve();})}));
afterEach(()=>{clock.waits=[];clock.releases=[];});
async function settle(){for(let i=0;i<10;i++)await Promise.resolve();}
it('drains active work on stop, cleans up, and never claims concurrently',async()=>{
 const stop=new AbortController();let finish!:()=>void,activeSignal!:AbortSignal;
 const events:string[]=[];
 const active=new Promise<void>(resolve=>{finish=resolve;});
 const running=runPlacesLoop({runOnce:async signal=>{events.push('claim');activeSignal=signal;await active;return {succeeded:1,failed:0};},cleanup:async()=>{events.push('cleanup');}},stop.signal);
 await settle();stop.abort();expect(activeSignal.aborted).toBe(false);finish();await running;
 expect(events).toEqual(['claim','cleanup']);expect(clock.waits).toEqual([]);
});
it.each(['idle','failed','unavailable'])('waits without busy polling after %s and wakes on stop',async scenario=>{
 const stop=new AbortController();let claims=0;
 const running=runPlacesLoop({runOnce:async()=>{claims++;if(scenario==='unavailable')throw Error('API_UNAVAILABLE');return {succeeded:0,failed:scenario==='failed'?1:0};},cleanup:async()=>{}},stop.signal);
 await settle();expect(claims).toBe(1);expect(clock.waits).toEqual([scenario==='idle'?15_000:60_000]);stop.abort();await running;
});

it('blocks claims on runtime failure and probes with bounded backoff until recovery',async()=>{
 const stop=new AbortController();let checks=0,claims=0;const logs:Record<string,unknown>[]=[];
 const running=runPlacesLoop({checkRuntime:async()=>{if(++checks<=2)throw Error('ASR_UNAVAILABLE');},runOnce:async()=>{claims++;stop.abort();return {succeeded:1,failed:0};},cleanup:async()=>{},log:e=>logs.push(e)},stop.signal);
 await settle();expect(claims).toBe(0);expect(clock.waits).toEqual([60_000]);clock.releases.shift()!();
 await settle();expect(claims).toBe(0);expect(clock.waits).toEqual([60_000,120_000]);clock.releases.shift()!();
 await running;expect(claims).toBe(1);expect(checks).toBe(3);expect(logs.some(e=>e.stage==='places_runtime_unavailable'&&e.code==='ASR_UNAVAILABLE')).toBe(true);
});
it.each([0,1])('rechecks runtime after infrastructure failure even with %s completed receipts',async succeeded=>{
 const stop=new AbortController();let checks=0,claims=0;
 const running=runPlacesLoop({checkRuntime:async()=>{checks++;},runOnce:async()=>{claims++;return {succeeded,failed:1-succeeded,failureCodes:[succeeded?'TEMP_STORAGE_UNAVAILABLE':'ASR_UNAVAILABLE']};},cleanup:async()=>{}},stop.signal);
 await settle();expect(checks).toBe(1);expect(claims).toBe(1);clock.releases.shift()!();await settle();
 expect(checks).toBe(2);stop.abort();await running;
});

it('retains the provider cooldown before any further claim',async()=>{
 const stop=new AbortController();const running=runPlacesLoop({runOnce:async()=>({succeeded:0,failed:1,retryAfterMs:120_000}),cleanup:async()=>{}},stop.signal);
 await settle();expect(clock.waits).toEqual([120_000]);stop.abort();await running;
});
