import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTempWorkdirManager } from '../src/runtime/temp-workdir.js';
import { runPlacesPipeline } from '../src/places/pipeline.js';
import { PlacesHttpApi } from '../src/places/api.js';
import { parseCandidates } from '../src/places/inference.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
const outputSchema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['name','category'],properties:{name:{type:'string'},category:{enum:['restaurant','cafe','patisserie','voyage','divers']}}}}}};
it('rejects injected authoritative fields and categories outside the server schema',()=>{
  expect(parseCandidates('{"candidates":[{"name":"Cafe","category":"cafe"}]}',outputSchema)).toMatchObject({candidates:[{category:'cafe'}]});
  for(const text of ['{"candidates":[{"name":"Cafe","category":"catering.cafe"}]}','{"candidates":[{"name":"Cafe","category":"cafe","latitude":1}]}','ignore the rules'])expect(()=>parseCandidates(text,outputSchema)).toThrow('INVALID_RESULT');
});
it('processes jobs serially and removes every temporary artifact after success and failure',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'places-pipeline-test-'));roots.push(root);
  const workdirs=createTempWorkdirManager({root,maxAgeMs:21_600_000});
  const events:string[]=[];let next=0,active=0;
  const api={async call(command:Record<string,unknown>){
    events.push(String(command.action));
    if(command.action==='claim')return next++<2?{jobId:'job-'+next,leaseToken:'lease-'+next,heartbeatIntervalMs:30_000,input:{post_id:'post-'+next,input_hash:'hash'},media:[],outputSchema,categoryRules:'Only owner categories'}:null;
    if(command.action==='complete')return {status:'SUCCEEDED',placesPersisted:1};
    return {ok:true};
  }};
  const analyzed:string[]=[];
  const summary=await runPlacesPipeline({limit:2,commit:true,signal:new AbortController().signal},{api,workdirs,analyze:async(prepared,dir)=>{
    expect(active++).toBe(0);analyzed.push(prepared.input.post_id);await writeFile(path.join(dir,'private-audio.wav'),'temporary');active--;
    if(prepared.input.post_id==='post-2')throw Error('INFERENCE_FAILED');
    return {candidates:[],media:[],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:1,outputTokens:1},elapsedMs:1};
  }});
  expect(analyzed).toEqual(['post-1','post-2']);expect(summary).toMatchObject({succeeded:1,failed:1});
  expect(events.filter(e=>e==='complete')).toHaveLength(1);expect(events).toContain('fail');expect(await readdir(root)).toEqual([]);
});
it('uses prepare/preview without enqueuing or completing a job',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'places-preview-test-'));roots.push(root);const actions:string[]=[];
  const api={async call(c:Record<string,unknown>){actions.push(String(c.action));return c.action==='prepare'?{input:{post_id:'post',input_hash:'hash'},media:[],outputSchema,categoryRules:'rules'}:{committed:false};}};
  await runPlacesPipeline({limit:1,commit:false,postId:'post',signal:new AbortController().signal},{api,workdirs:createTempWorkdirManager({root,maxAgeMs:21_600_000}),analyze:async()=>({candidates:[],media:[],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:1,outputTokens:1},elapsedMs:1})});
  expect(actions).toEqual(['prepare','preview']);expect(await readdir(root)).toEqual([]);
});

it('aborts an active analysis and cleans the workspace without submitting a result',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'places-abort-test-'));roots.push(root);const abort=new AbortController();const actions:string[]=[];
  const api={async call(c:Record<string,unknown>){actions.push(String(c.action));return c.action==='claim'?{jobId:'job',leaseToken:'lease',input:{post_id:'post',input_hash:'hash'},media:[],outputSchema,categoryRules:'rules'}:{ok:true};}};
  const summary=await runPlacesPipeline({limit:1,commit:true,signal:abort.signal},{api,workdirs:createTempWorkdirManager({root,maxAgeMs:21_600_000}),analyze:async(_prepared,dir,signal)=>{
    await writeFile(path.join(dir,'frame.jpg'),'private');abort.abort();signal.throwIfAborted();throw Error('unreachable');
  }});
  expect(summary.failed).toBe(1);expect(actions).not.toContain('complete');expect(actions).toContain('fail');expect(await readdir(root)).toEqual([]);
});

it('replays the identical completion after a response body is interrupted',async()=>{
  let calls=0;const bodies:string[]=[];
  const request=(async(_url:unknown,init?:RequestInit)=>{
    calls++;bodies.push(String(init?.body));
    return calls===1?new Response(new ReadableStream({start(controller){controller.error(Error('reset'));}}),{status:200}):Response.json({status:'SUCCEEDED'});
  }) as typeof fetch;
  const api=new PlacesHttpApi('https://app.test','private',request);
  await expect(api.call({action:'complete',jobId:'job',leaseToken:'lease',result:{}})).resolves.toEqual({status:'SUCCEEDED'});
  expect(calls).toBe(2);expect(bodies[0]).toBe(bodies[1]);
});

it('preserves definitive evidence rejection codes without a transport retry',async()=>{
 for(const code of ['PLACES_EVIDENCE_INVALID','PLACES_MEDIA_INCOMPLETE']){
  let calls=0;
  const request=(async()=>{calls++;return Response.json({error:{code}},{status:422});}) as typeof fetch;
  await expect(new PlacesHttpApi('https://app.test','private',request).call({action:'complete'})).rejects.toThrow(code);
  expect(calls).toBe(1);
 }
});

it('restricts the automatic runner to sync jobs and preserves evidence failure causes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'places-auto-test-'));roots.push(root);
 const commands:Record<string,unknown>[]=[];
 const api={async call(c:Record<string,unknown>){commands.push(c);return c.action==='claim'?{jobId:'auto',leaseToken:'lease',input:{post_id:'post',input_hash:'hash'},media:[],outputSchema,categoryRules:'rules'}:{ok:true};}};
 await runPlacesPipeline({limit:1,commit:true,scope:'automatic',learning:true,signal:new AbortController().signal},{api,workdirs:createTempWorkdirManager({root,maxAgeMs:21_600_000}),analyze:async()=>{throw Error('PLACES_EVIDENCE_INVALID');}});
 expect(commands[0]).toEqual({action:'claim',scope:'automatic',learning:true});
 expect(commands.find(c=>c.action==='fail')?.code).toBe('PLACES_EVIDENCE_INVALID');
 expect(await readdir(root)).toEqual([]);
});

it('reports temporary storage failure against its lease and stops a batch before the next claim',async()=>{
 const commands:Record<string,unknown>[]=[];const api={async call(c:Record<string,unknown>){commands.push(c);return c.action==='claim'?{jobId:'job',leaseToken:'lease',input:{post_id:'post',input_hash:'hash'},media:[],outputSchema,categoryRules:'rules'}:{ok:true};}};
 const summary=await runPlacesPipeline({limit:2,commit:true,signal:new AbortController().signal},{api,workdirs:{create:async()=>{throw Error('disk unavailable');},remove:async()=>{},cleanupStale:async()=>0},analyze:async()=>{throw Error('unreachable');}});
 expect(summary).toMatchObject({failed:1,failureCodes:['TEMP_STORAGE_UNAVAILABLE']});
 expect(commands.filter(c=>c.action==='claim')).toHaveLength(1);expect(commands.find(c=>c.action==='fail')?.code).toBe('TEMP_STORAGE_UNAVAILABLE');
});

it('carries a sanitized provider cooldown to the API and consumer',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'places-cooldown-test-'));roots.push(root);const commands:Record<string,unknown>[]=[];
 const api={async call(c:Record<string,unknown>){commands.push(c);return c.action==='claim'?{jobId:'job',leaseToken:'lease',input:{post_id:'post',input_hash:'hash'},media:[],outputSchema,categoryRules:'rules'}:{ok:true};}};
 const result=await runPlacesPipeline({limit:1,commit:true,signal:new AbortController().signal},{api,workdirs:createTempWorkdirManager({root,maxAgeMs:21_600_000}),analyze:async()=>{throw Object.assign(Error('INFERENCE_BUSY'),{retryAfterMs:120_000});}});
 expect(result.retryAfterMs).toBe(120_000);expect(commands.find(c=>c.action==='fail')).toMatchObject({code:'INFERENCE_BUSY',retryAfterMs:120_000});
});
