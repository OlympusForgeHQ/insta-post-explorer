import {describe,it,expect} from 'vitest';
import {translateCaptionExact as translateCaption,splitCaption} from '../src/classification/translation-inference.js';
import {assembleTranslation} from '../src/classification/translation-contract.js';
const unchanged=(sourceText:string,language='en')=>({sourceText,decision:'UNCHANGED',sourceLanguages:[language],translatedCaption:null,reason:'Retain source'});
const translated=(sourceText:string,translatedCaption:string)=>({sourceText,decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption,reason:'Spanish'});
const makeResponse=(segments:unknown[])=>Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify({segments})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}});
describe('Text-only caption inference',()=>{
 it.each([{caption:'A recipe in English',language:'en'},{caption:'Une recette en français',language:'fr'},{caption:'🍝 #recipe @chef https://example.test',language:'zxx'}])('keeps source unchanged: $language',async sample=>{
  const request:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));expect(JSON.stringify(body)).not.toContain('image_url');return makeResponse([unchanged(sample.caption,sample.language)]);};
  const result=await translateCaption(sample.caption,'http://example.test/v1','test',new AbortController().signal,request);expect(result).toMatchObject({decision:'UNCHANGED',translatedCaption:null});
 });
 it('retries invalid protected tokens and never executes instructions embedded in a caption',async()=>{
  let calls=0;
  const request:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));expect(body.messages[0].content).toMatch(/untrusted/i);expect(body.tools).toBeUndefined();return makeResponse([translated('Mezcla 200 g',calls===1?'Mélanger 300 g':'Mélanger 200 g')]);};
  expect(await translateCaption('Mezcla 200 g','http://example.test/v1','test',new AbortController().signal,request)).toMatchObject({translatedCaption:'Mélanger 200 g'});expect(calls).toBe(2);
 });
 it('bounds chunks without losing source and copies English segments locally',async()=>{
  const caption=('Hola mundo.\n').repeat(900)+'English final paragraph';const chunks=splitCaption(caption);expect(chunks.join('')).toBe(caption);expect(chunks.every(x=>x.length<=4000)).toBe(true);let calls=0;
  const request:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));const source=JSON.parse(body.messages[1].content).untrusted_caption as string;const marker=source.indexOf('English');return makeResponse(marker<0?[translated(source,source.replaceAll('Hola mundo.','Bonjour monde.'))]:[translated(source.slice(0,marker),source.slice(0,marker).replaceAll('Hola mundo.','Bonjour monde.')),unchanged(source.slice(marker))]);};
  const result=await translateCaption(caption,'http://example.test/v1','test',new AbortController().signal,request);expect(result.translatedCaption).toBe(caption.replaceAll('Hola mundo.','Bonjour monde.'));expect(calls).toBe(chunks.length);
 });
 it('does not publish a partial translation after a later chunk fails',async()=>{
  let calls=0;const request:typeof fetch=async(_url,init)=>{calls++;const source=JSON.parse(JSON.parse(String(init?.body)).messages[1].content).untrusted_caption;return calls===1?makeResponse([translated(source,'Bonjour')]):new Response('',{status:429});};
  await expect(translateCaption('Hola '.repeat(2000),'http://example.test/v1','test',new AbortController().signal,request)).rejects.toThrow('INFERENCE_BUSY');
 });
 it('subdivides a long invalid copy without dropping source or publishing partial text',async()=>{
  let calls=0;const caption='Hola mundo.\n'.repeat(100);
  const request:typeof fetch=async(_url,init)=>{calls++;const source=JSON.parse(JSON.parse(String(init?.body)).messages[1].content).untrusted_caption as string;return makeResponse([translated(calls<=2?'lost source':source,calls<=2?'lost translation':source.replaceAll('Hola','Bonjour'))]);};
  const result=await translateCaption(caption,'http://example.test/v1','test',new AbortController().signal,request);expect(result.translatedCaption).toBe(caption.replaceAll('Hola','Bonjour'));expect(calls).toBeGreaterThan(2);
 });
 it('rejects missing source, lost emoji/paragraphs, or rewriting declared English/French',()=>{
  const source='Hola amigo.\nKeep this exact English sentence.\n🙂';
  expect(()=>assembleTranslation(source,{segments:[translated('Hola amigo.','Bonjour ami.')]})).toThrow('TRANSLATION_SOURCE_CHANGED');
  expect(()=>assembleTranslation(source,{segments:[translated(source,'Bonjour ami.')]})).toThrow('TRANSLATION_STRUCTURE_CHANGED');
  expect(()=>assembleTranslation(source,{segments:[{...translated(source,source),sourceLanguages:['es','en']}]})).toThrow('TRANSLATION_MIXED_SEGMENT');
  expect(assembleTranslation(source,{segments:[translated('Hola amigo.\n','Bonjour ami.\n'),unchanged('Keep this exact English sentence.\n'),unchanged('🙂','zxx')]}).translatedCaption).toBe('Bonjour ami.\nKeep this exact English sentence.\n🙂');
 });
 it('rejects whitespace-only translations before reconstructing source separators',()=>{
  expect(()=>assembleTranslation('Hola.\n',{segments:[translated('Hola.\n',' ')]})).toThrow();
 });
 it('restores source whitespace at translated segment boundaries',()=>{
  expect(assembleTranslation('Hola.\n\nEnglish',{segments:[translated('Hola.\n\n','Bonjour.\n'),unchanged('English')]}).translatedCaption).toBe('Bonjour.\n\nEnglish');
 });
 it('marks interrupted response bodies as transient inference failures',async()=>{
  const request:typeof fetch=async()=>new Response(new ReadableStream({start(controller){controller.error(Error('connection reset'));}}));
  await expect(translateCaption('Hola mundo','http://example.test/v1','test',new AbortController().signal,request)).rejects.toThrow('INFERENCE_FAILED');
 });
});
