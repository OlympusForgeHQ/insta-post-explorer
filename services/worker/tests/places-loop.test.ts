import {afterEach,expect,it,vi} from 'vitest';
import {runPlacesLoop} from '../src/places/loop.js';
const clock=vi.hoisted(()=>({waits:[] as number[]}));
vi.mock('node:timers/promises',()=>({setTimeout:(ms:number,_value:unknown,{signal}:{signal:AbortSignal})=>new Promise<void>((resolve,reject)=>{clock.waits.push(ms);signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});if(signal.aborted)resolve();})}));
afterEach(()=>{clock.waits=[];});
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
