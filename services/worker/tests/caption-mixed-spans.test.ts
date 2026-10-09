import {describe,it,expect} from 'vitest';
import {assembleCaptionSpans,captionSpanTokens} from '../src/classification/translation-spans.js';
import {translateCaption} from '../src/classification/translation-inference.js';
const envelope=(value:unknown)=>Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}});
const out=(decision:string,sourceLanguages:string[],translatedCaption:string|null)=>({decision,sourceLanguages,translatedCaption,reason:'test'});
describe('Indexed fallback for mixed caption units',()=>{
 it('recovers failed source echo by selecting contiguous token spans and copying English locally',async()=>{
  let spanCalls=0;
  const request:typeof fetch=async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(input.units)return envelope({units:[{id:0,...out('TRANSLATED',['es','en'],'Mélanger 200 g, keep this exact.')}]});
   if(input.untrusted_caption)return envelope({segments:[{sourceText:'Incorrect source echo',...out('UNCHANGED',['en'],null)}]});
   spanCalls++;const tokens=input.tokens as Array<{id:number;text:string}>;const start=tokens.find(t=>t.text==='keep')!.id;
   return envelope({segments:[{start:0,end:start,...out('TRANSLATED',['es'],tokens.slice(0,start).map(t=>t.text).join('').replace('Mezcla','Mélanger'))},{start,end:tokens.length,...out('UNCHANGED',['en'],null)}]});
  };
  const result=await translateCaption('Mezcla 200 g, keep this exact.','http://test/v1','test',new AbortController().signal,request);
  expect(result.translatedCaption).toBe('Mélanger 200 g, keep this exact.');expect(spanCalls).toBe(1);
  expect(result.usage).toEqual({inputTokens:80,outputTokens:40});
 });
 it('rejects gaps, overlap, reversed or out-of-range spans',()=>{
  const source='Hola amigo';const n=captionSpanTokens(source).length;
  for(const segments of [ [{start:1,end:n,...out('UNCHANGED',['en'],null)}], [{start:0,end:n+1,...out('UNCHANGED',['en'],null)}], [{start:0,end:1,...out('UNCHANGED',['en'],null)},{start:0,end:n,...out('UNCHANGED',['en'],null)}], [{start:0,end:1,...out('UNCHANGED',['en'],null)}] ]){
   expect(()=>assembleCaptionSpans(source,{segments})).toThrow('TRANSLATION_SPANS_CHANGED');
  }
 });
 it('keeps markers atomic and copies French, English and nonlinguistic spans locally',()=>{
  const source='𝐇𝐞𝐥𝐥𝐨! [[IPEKEEPX12]]\nBonjour';const tokens=captionSpanTokens(source);expect(tokens.join('')).toBe(source);expect(tokens).toContain('[[IPEKEEPX12]]');
  const marker=tokens.indexOf('[[IPEKEEPX12]]');
  const output=assembleCaptionSpans(source,{segments:[{start:0,end:marker,...out('UNCHANGED',['en'],null)},{start:marker,end:marker+1,...out('TRANSLATED',['es'],'[[IPEKEEPX12]] grammes inventés')},{start:marker+1,end:tokens.length,...out('UNCHANGED',['fr'],null)}]});
  expect(output).toMatchObject({decision:'UNCHANGED',translatedCaption:null});
 });
 it('does not accept mixed English/French in a translated span or lost protected content',()=>{
  const source='Hola [[IPEKEEP0]], keep exact';const n=captionSpanTokens(source).length;
  expect(()=>assembleCaptionSpans(source,{segments:[{start:0,end:n,...out('TRANSLATED',['es','en'],'Bonjour [[IPEKEEP0]], keep exact')}]})).toThrow('TRANSLATION_MIXED_SEGMENT');
  expect(()=>assembleCaptionSpans(source,{segments:[{start:0,end:n,...out('TRANSLATED',['es'],'Bonjour')}]})).toThrow('TRANSLATION_TOKENS_CHANGED');
 });

});
