import {it,expect} from 'vitest';
import {runCaptionTranslationOnce} from '../src/classification/translation-runner.js';
import type {LearningTracker} from '../src/classification/learning.js';
const learning={version:1 as const,domain:'translation' as const,shape:'short:latin:single',strategy:'format_guidance' as const,examples:[]};
it.each([false,true])('forwards bounded memory and records success/failure without source text (failure=%s)',async fail=>{
 const calls:Record<string,unknown>[]=[];
 const api={call:async(c:Record<string,unknown>)=>{calls.push(c);return c.action==='claim'?{jobId:'job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b',input:{post_id:'post',input_hash:'hash',caption:'Private source'},learningContext:learning}:{ok:true};}};
 await runCaptionTranslationOnce({api,learningEnabled:true,analyze:async(_caption:string,_signal:AbortSignal,tracker?:LearningTracker)=>{expect(tracker?.context).toEqual(learning);tracker?.observe({stage:'caption_translation_rejected',reason:'TRANSLATION_SOURCE_CHANGED'});if(fail)throw Error('INFERENCE_BUSY');return {decision:'UNCHANGED',sourceLanguages:['en'],translatedCaption:null,reason:'English',model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:5,outputTokens:2},elapsedMs:10};}},new AbortController().signal);
 expect(calls[0]).toEqual({action:'claim',learning:true});const saved=calls.find(c=>c.action===(fail?'fail':'complete'))!;expect(saved.learning).toMatchObject({strategy:'format_guidance',signals:fail?['SOURCE_FIDELITY','PROVIDER_BUSY']:['SOURCE_FIDELITY']});expect(JSON.stringify(saved.learning)).not.toContain('Private source');
});
