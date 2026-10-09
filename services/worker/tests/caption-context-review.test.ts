import {describe,it,expect,vi} from 'vitest';
import {captionReviewContext} from '../src/classification/translation-context.js';
import {translateCaption} from '../src/classification/translation-inference.js';
const envelope=(units:unknown[])=>Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify({units})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}});
const result=(id:number,decision:string,sourceLanguages:string[],translatedCaption:string|null=null)=>({id,decision,sourceLanguages,translatedCaption,reason:'test'});
describe('Contextual review of ambiguous caption units',()=>{
 it('uses the surrounding caption to resolve a name without rewriting accepted English',async()=>{
  const source='Visit this lovely restaurant.\nCasa Azul\nBook your table today.';let calls=0;
  const request:typeof fetch=async(_url,init)=>{calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(calls===1)return envelope([result(0,'UNCHANGED',['en']),result(1,'NEEDS_REVIEW',['und']),result(2,'UNCHANGED',['en'])]);
   expect(input.context.map((u:{text:string})=>u.text).join(' ')).toContain('Visit this lovely restaurant.');
   expect(input.units.map((u:{id:number})=>u.id)).toEqual([1]);
   return envelope([result(1,'UNCHANGED',['zxx'])]);
  };
  expect(await translateCaption(source,'http://test/v1','test',new AbortController().signal,request)).toMatchObject({decision:'UNCHANGED',translatedCaption:null});expect(calls).toBe(2);
 });
 it.each(['unresolved','wrong-id','missing-marker','extra-context'])('keeps the review outcome for %s context results',async mode=>{
  let calls=0;const logs:unknown[]=[];
  const request:typeof fetch=async(_url,init)=>{calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(calls===1)return envelope([result(0,'UNCHANGED',['en']),result(1,'NEEDS_REVIEW',['und'])]);
   if(mode==='wrong-id')return envelope([result(0,'UNCHANGED',['en'])]);
   if(mode==='extra-context')return envelope([result(0,'UNCHANGED',['en']),result(1,'UNCHANGED',['zxx'])]);
   if(mode==='missing-marker')return envelope([result(1,'TRANSLATED',['es'],'Bonjour')]);
   return envelope(input.units.map((u:{id:number})=>result(u.id,'NEEDS_REVIEW',['und'])));
  };
  expect(await translateCaption('Keep this exact.\nSecretlabel 200 🙂','http://test/v1','test',new AbortController().signal,request,e=>logs.push(e))).toMatchObject({decision:'NEEDS_REVIEW',translatedCaption:null});
  expect(calls).toBe(2);expect(JSON.stringify(logs)).not.toContain('Secretlabel');
 });
 it('translates a resolved foreign unit and retains protected content and English',async()=>{
  let calls=0;const request:typeof fetch=async(_url,init)=>{calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(calls===1)return envelope([result(0,'UNCHANGED',['en']),result(1,'NEEDS_REVIEW',['und'])]);
   return envelope([result(1,'TRANSLATED',['es'],input.units[0].text.replace('Mezclar','Mélanger'))]);
  };
  expect((await translateCaption('Keep this exact.\nMezclar 200 g 🙂','http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe('Keep this exact.\nMélanger 200 g 🙂');
 });
 it('uses normalization only as a reading hint and keeps stylized English exact',async()=>{
  let calls=0;const request:typeof fetch=async(_url,init)=>{calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(calls===1)return envelope([result(0,'UNCHANGED',['en']),result(1,'NEEDS_REVIEW',['und'])]);
   expect(input.units[0].text).toBe('𝐇𝐞𝐥𝐥𝐨');expect(input.units[0].normalizedHint).toBe('Hello');return envelope([result(1,'UNCHANGED',['en'])]);
  };
  expect(await translateCaption('English greeting.\n𝐇𝐞𝐥𝐥𝐨','http://test/v1','test',new AbortController().signal,request)).toMatchObject({decision:'UNCHANGED',translatedCaption:null});
 });
 it('bounds context while retaining units closest to the uncertain target',()=>{
  const units=Array.from({length:1000},(_,id)=>({id,text:'x'.repeat(600),prefix:'',suffix:''}));const context=captionReviewContext(units,[units[999]]);
  expect(context.reduce((n,u)=>n+u.text.length,0)).toBeLessThanOrEqual(8000);expect(context.some(u=>u.id===999)).toBe(true);expect(context.some(u=>u.id===998)).toBe(true);
 });

 it('keeps shared busy backoff and cancellation during the contextual request',async()=>{
  vi.useFakeTimers();try{
   let calls=0;const request:typeof fetch=async()=>++calls===1?envelope([result(0,'NEEDS_REVIEW',['und'])]):new Response(null,{status:429,headers:{'Retry-After':'30'}});
   const stop=new AbortController();const pending=translateCaption('Unknown label','http://test/v1','test',stop.signal,request);const assertion=expect(pending).rejects.toThrow();
   await vi.advanceTimersByTimeAsync(1000);expect(calls).toBe(2);stop.abort();await assertion;
  }finally{vi.useRealTimers();}
 });

});
