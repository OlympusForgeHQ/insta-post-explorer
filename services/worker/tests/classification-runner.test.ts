import {describe,it,expect,vi,beforeEach} from 'vitest';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runClassificationOnce} from '../src/classification/runner.js';
import {createTempWorkdirManager} from '../src/runtime/temp-workdir.js';
import {prepareClassificationWorkdirs} from '../src/classification/workdirs.js';
import {mkdir} from 'node:fs/promises';
const timers=vi.hoisted(()=>({pending:[] as Array<()=>void>}));
vi.mock('node:timers/promises',()=>({setTimeout:(_ms:number,_value:unknown,options:{signal:AbortSignal})=>new Promise<void>((resolve,reject)=>{
 const abort=()=>reject(Error('aborted'));options.signal.addEventListener('abort',abort,{once:true});timers.pending.push(()=>{options.signal.removeEventListener('abort',abort);resolve();});
})}));
const claim={jobId:'job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b',heartbeatIntervalMs:30000,input:{post_id:'post',input_hash:'hash',caption:'Brownie',author_username:'baker'},media:[{id:'m',kind:'IMAGE',mimeType:'image/jpeg',byteSize:100,versionTag:null,url:'https://test.r2.cloudflarestorage.com/image'}],themes:['Sucré'],existingTags:['Chocolat'],outputSchema:{type:'object'}};
const result={status:'SUCCEEDED' as const,mainTheme:'Sucré',tags:['Chocolat','Brownie','Pistache'],reason:'Recipe',media:[{mediaId:'m',kind:'IMAGE',durationMs:null,frameCount:1,audio:'not_applicable'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:20,outputTokens:10},elapsedMs:100};
describe('Independent classification job lifecycle',()=>{
 beforeEach(()=>{timers.pending=[];});
 it('removes fresh abandoned media on startup while preserving the separate model cache',async()=>{
  const state=await mkdtemp(path.join(tmpdir(),'classification-startup-')),root=path.join(state,'work'),cache=path.join(state,'cache');
  try{await mkdir(path.join(root,'abandoned'),{recursive:true});await writeFile(path.join(root,'abandoned','full-audio.wav'),'private');await mkdir(cache);await writeFile(path.join(cache,'weights'),'retained');await prepareClassificationWorkdirs(root);expect(await readdir(root)).toEqual([]);expect(await readdir(cache)).toEqual(['weights']);}
  finally{await rm(state,{recursive:true,force:true});}
 });
 it.each(['success','review','busy','stale','stop'])('handles %s with owned lease and cleanup',async scenario=>{
  const root=await mkdtemp(path.join(tmpdir(),'classification-test-'));const calls:Record<string,unknown>[]=[];const abort=new AbortController();
  const api={call:async(c:Record<string,unknown>)=>{calls.push(c);if(c.action==='claim')return claim;if(c.action==='complete'&&scenario==='stale')throw Error('CLASSIFICATION_INPUT_STALE');return {ok:true};}};
  try{const summary=await runClassificationOnce({api,workdirs:createTempWorkdirManager({root,maxAgeMs:3600000}),analyze:async(_prepared,dir)=>{await writeFile(path.join(dir,'private.txt'),'source');if(scenario==='busy')throw Error('INFERENCE_BUSY');if(scenario==='stop'){abort.abort();throw Error('WORKER_STOPPING');}return scenario==='review'?{...result,status:'NEEDS_REVIEW',mainTheme:null,tags:[]}:result;}},abort.signal);
   expect(summary.status).toBe(scenario==='success'?'SUCCEEDED':scenario==='review'?'NEEDS_REVIEW':scenario==='stale'?'CANCELLED':'FAILED');
   expect(calls.filter(c=>c.action==='complete')).toHaveLength(['success','review','stale'].includes(scenario)?1:0);
   if(['busy','stop'].includes(scenario))expect(calls.find(c=>c.action==='fail')?.code).toBe(scenario==='busy'?'INFERENCE_BUSY':'WORKER_STOPPING');
   expect(await readdir(root)).toEqual([]);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('aborts inference on background heartbeat loss and cannot complete or fail with a superseded lease',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'classification-lease-loss-')),calls:string[]=[];
  const api={call:async(command:Record<string,unknown>)=>{calls.push(String(command.action));if(command.action==='claim')return claim;throw Error('CLASSIFICATION_LEASE_LOST');}};
  try{const outcome=await runClassificationOnce({api,workdirs:createTempWorkdirManager({root,maxAgeMs:3600000}),analyze:async(_claim,dir,signal)=>{await writeFile(path.join(dir,'private-audio.wav'),'private');const pending=new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));timers.pending.shift()!();return pending;}},new AbortController().signal);expect(outcome.status).toBe('CANCELLED');expect(calls).toEqual(['claim','heartbeat']);expect(await readdir(root)).toEqual([]);}
  finally{await rm(root,{recursive:true,force:true});}
 });
});
