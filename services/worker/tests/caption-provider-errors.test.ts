import {describe,it,expect} from 'vitest';
import {translateCaption} from '../src/classification/translation-inference.js';
const output=(decision:string,sourceLanguages:string[],translatedCaption:string|null)=>({decision,sourceLanguages,translatedCaption,reason:'test'});
const reply=(value:unknown,finish_reason='stop')=>Response.json({model:'insta-places',choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason}],usage:{prompt_tokens:20,completion_tokens:10}});
describe('Provider failures inside successful HTTP envelopes',()=>{
 it.each(['indexed','exact','context','spans'])('retries %s provider errors as transport failures, without content retries or leaked errors',async mode=>{
  let calls=0;const logs:unknown[]=[];
  const request:typeof fetch=async(_url,init)=>{
   calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(input.context||input.tokens||mode==='indexed'||(mode==='exact'&&input.untrusted_caption))return reply('Private provider timeout details','error');
   if(input.untrusted_caption)return reply({segments:[{sourceText:'Bad source echo',...output('UNCHANGED',['en'],null)}]});
   return reply({units:[{id:0,...(mode==='context'?output('NEEDS_REVIEW',['und'],null):output('TRANSLATED',['es','en'],'Mélanger 200 g, keep exact.'))}]});
  };
  await expect(translateCaption('Mezcla 200 g, keep exact.','http://test/v1','test',new AbortController().signal,request,e=>logs.push(e))).rejects.toThrow('INFERENCE_FAILED');
  expect(calls).toBe(mode==='indexed'?1:mode==='spans'?4:2);
  expect(JSON.stringify(logs)).not.toContain('Private provider');
 });
});
