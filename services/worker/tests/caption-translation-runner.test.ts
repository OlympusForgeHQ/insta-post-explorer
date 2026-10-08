import {describe,it,expect,vi} from 'vitest';
import {runCaptionTranslationOnce} from '../src/classification/translation-runner.js';
const claim={jobId:'translation-job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b',input:{post_id:'post',input_hash:'hash',caption:'Hola'}};
const result={decision:'TRANSLATED' as const,sourceLanguages:['es'],translatedCaption:'Bonjour',reason:'Spanish',model:'deepseek/deepseek-v4.1-flash' as const,usage:{inputTokens:20,outputTokens:10},elapsedMs:10};
describe('Leased translation runner',()=>{
 it('heartbeats before publishing and logs metadata without caption text',async()=>{
  const commands:Record<string,unknown>[]=[],logs:unknown[]=[];
  const api={call:async(command:Record<string,unknown>)=>{commands.push(command);return command.action==='claim'?claim:{ok:true};}};
  expect(await runCaptionTranslationOnce({api,analyze:async()=>result,log:event=>logs.push(event)},new AbortController().signal)).toEqual({status:'SUCCEEDED'});
  expect(commands.map(x=>x.action)).toEqual(['claim','heartbeat','complete']);expect(JSON.stringify(logs)).not.toMatch(/Hola|Bonjour/);
 });
 it.each(['INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT'])('reports %s without completing partial work',async code=>{
  const commands:Record<string,unknown>[]=[];const api={call:async(command:Record<string,unknown>)=>{commands.push(command);return command.action==='claim'?claim:{ok:true};}};
  expect(await runCaptionTranslationOnce({api,analyze:async()=>{throw Error(code);}},new AbortController().signal)).toEqual({status:'FAILED'});expect(commands.at(-1)).toMatchObject({action:'fail',code});expect(commands.some(x=>x.action==='complete')).toBe(false);
 });
 it('does not publish after losing its lease',async()=>{
  const complete=vi.fn();const api={call:async(command:Record<string,unknown>)=>{if(command.action==='claim')return claim;if(command.action==='heartbeat')throw Error('CLASSIFICATION_LEASE_LOST');complete();}};
  expect(await runCaptionTranslationOnce({api,analyze:async()=>result},new AbortController().signal)).toEqual({status:'CANCELLED'});expect(complete).not.toHaveBeenCalled();
 });
});
