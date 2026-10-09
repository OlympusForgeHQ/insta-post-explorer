import {describe,it,expect,vi} from 'vitest';
import {prepareCaptionUnits,validateIndexedUnits} from '../src/classification/translation-units.js';
import {translateCaption} from '../src/classification/translation-inference.js';
const envelope=(value:unknown)=>Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}});
const output=(id:number,language:string,text:string|null=null)=>({id,decision:text===null?'UNCHANGED':'TRANSLATED',sourceLanguages:[language],translatedCaption:text,reason:'test'});
describe('Caption recovery protocol',()=>{
 it('retains English without requiring the provider to reproduce source text',async()=>{
  const request:typeof fetch=async()=>envelope({units:[output(0,'en')]});
  expect(await translateCaption('Keep this exact caption!','http://test/v1','test',new AbortController().signal,request)).toMatchObject({decision:'UNCHANGED',translatedCaption:null});
 });
 it('restores protected tokens and paragraph boundaries locally',async()=>{
  const caption='Hola 200 👩🏽‍🍳 @chef #receta https://example.test/a\n\nKeep this English.';
  const request:typeof fetch=async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return envelope({units:input.units.map((u:{id:number;text:string})=>output(u.id,u.text.startsWith('Hola')?'es':'en',u.text.startsWith('Hola')?u.text.replace('Hola','Bonjour'):null))});};
  expect((await translateCaption(caption,'http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe(caption.replace('Hola','Bonjour'));
 });
 it('waits on Retry-After before reporting busy, and aborts the wait promptly',async()=>{
  vi.useFakeTimers();try{
   const controller=new AbortController();const result=translateCaption('Hola','http://test/v1','test',controller.signal,async()=>new Response('',{status:429,headers:{'Retry-After':'30'}}));
   let settled=false;void result.then(()=>{settled=true;},()=>{settled=true;});const assertion=expect(result).rejects.toThrow();await vi.advanceTimersByTimeAsync(1000);expect(settled).toBe(false);controller.abort();await assertion;
  }finally{vi.useRealTimers();}
 });
 it('rejects missing, duplicate and reordered ids and corrupted protected markers',()=>{
  const prepared=prepareCaptionUnits('Hola 20 👩🏽‍🍳.\nAdios @chef.');
  const units=prepared.units;expect(units).toHaveLength(2);
  for(const ids of [[0],[0,0],[1,0]])expect(()=>validateIndexedUnits(units,{units:ids.map(id=>output(id,'en'))})).toThrow('TRANSLATION_UNIT_IDS_CHANGED');
  const unit=units[0];expect(()=>prepared.restoreTranslation(unit.text,'Bonjour')).toThrow('TRANSLATION_MARKERS_CHANGED');
  expect(()=>prepared.restoreTranslation(unit.text,unit.text+' [[IPEKEEP999]]')).toThrow('TRANSLATION_MARKERS_CHANGED');
 });
 it('preserves mixed English within a foreign unit through exact segment fallback',async()=>{
  const source='Hola amigo, keep this exact.';let calls=0;
  const request:typeof fetch=async(_url,init)=>{
   calls++;const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(input.units)return envelope({units:[{...output(0,'es','Bonjour ami, keep this exact.'),sourceLanguages:['es','en']}]});
   return envelope({segments:[{sourceText:'Hola amigo, ',decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:'Bonjour ami, ',reason:'Spanish'},{sourceText:'keep this exact.',decision:'UNCHANGED',sourceLanguages:['en'],translatedCaption:null,reason:'English'}]});
  };
  expect((await translateCaption(source,'http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe('Bonjour ami, keep this exact.');expect(calls).toBe(2);
 });
 it('records bounded diagnostic reasons, never source or provider text',async()=>{
  const logs:unknown[]=[];let calls=0;
  const request:typeof fetch=async()=>{calls++;return calls===1?envelope({units:[output(99,'en')]}):envelope({units:[output(0,'en')]});};
  expect(await translateCaption('Private original text','http://test/v1','test',new AbortController().signal,request,event=>logs.push(event))).toMatchObject({decision:'UNCHANGED'});
  expect(logs).toContainEqual(expect.objectContaining({reason:'TRANSLATION_UNIT_IDS_CHANGED'}));expect(JSON.stringify(logs)).not.toContain('Private original');
 });

 it('never lets the model add prose to locally nonlinguistic units in a mixed batch',async()=>{
  const request:typeof fetch=async(_url,init)=>{const {units}=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return envelope({units:units.map((u:{id:number;text:string})=>output(u.id,'es',u.text.includes('Hola')?'Bonjour.':u.text+' grammes de farine'))});};
  expect((await translateCaption('Hola.\n200 👩🏽‍🍳','http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe('Bonjour.\n200 👩🏽‍🍳');
 });

 it('keeps protected markers through the mixed-language exact fallback',async()=>{
  const request:typeof fetch=async(_url,init)=>{
   const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(input.units)return envelope({units:[{...output(0,'es',input.units[0].text.replace('Mezcla','Mélange')),sourceLanguages:['es','en']}]});
   const source=input.untrusted_caption as string;expect(source).toContain('[[IPEKEEP0]]');expect(source).not.toContain('200');
   const boundary=source.indexOf('keep');return envelope({segments:[{sourceText:source.slice(0,boundary),decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:source.slice(0,boundary).replace('Mezcla','Mélange'),reason:'Spanish'},{sourceText:source.slice(boundary),decision:'UNCHANGED',sourceLanguages:['en'],translatedCaption:null,reason:'English'}]});
  };
  expect((await translateCaption('Mezcla 200 g, keep this exact.','http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe('Mélange 200 g, keep this exact.');
 });

 it.each(['mixed','invalid-indexed'])('rejects marker permutation from the %s fallback',async mode=>{
  const request:typeof fetch=async(_url,init)=>{
   const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
   if(input.units)return envelope({units:[{...output(mode==='mixed'?0:999,'es','Bonjour'),sourceLanguages:['es','en']}]});
   const source=input.untrusted_caption as string;const changed=source.replace('[[IPEKEEP0]]','TEMP').replace('[[IPEKEEP1]]','[[IPEKEEP0]]').replace('TEMP','[[IPEKEEP1]]');
   return envelope({segments:[{sourceText:source,decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:changed,reason:'Spanish'}]});
  };
  await expect(translateCaption('Mezcla 200 y 300, keep this exact.','http://test/v1','test',new AbortController().signal,request)).rejects.toThrow('TRANSLATION_MARKERS_CHANGED');
 });

 it('keeps protected markers atomic at sentence boundaries',async()=>{
  const request:typeof fetch=async(_url,init)=>{const {units}=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return envelope({units:units.map((u:{id:number;text:string})=>output(u.id,'es',u.text.replaceAll('Hola','Bonjour')))});};
  for(const source of ['Hola!🙂\n\n#receta','Hola.200 g','Hola?@chef','Hola!👩🏽‍🍳 Hola.']){
   const prepared=prepareCaptionUnits(source);
   expect(prepared.units.map(u=>u.prefix+prepared.restore(u.text)+u.suffix).join('')+prepared.trailing).toBe(source);
   expect((await translateCaption(source,'http://test/v1','test',new AbortController().signal,request)).translatedCaption).toBe(source.replaceAll('Hola','Bonjour'));
  }
 });

});
