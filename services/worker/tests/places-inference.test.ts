import { expect, it, vi } from 'vitest';
import { HermesPlacesInference } from '../src/places/inference.js';
import type { PreparedPost } from '../src/places/api.js';

const prepared:PreparedPost={input:{post_id:'post',input_hash:'hash',caption:'Untrusted cafe caption'},media:[],categoryRules:'Use owner categories only',outputSchema:{type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',items:{type:'object',additionalProperties:false,required:['name','category'],properties:{name:{type:'string'},category:{enum:['cafe']}}}}}}};
const valid='{"candidates":[{"name":"Cafe","category":"cafe"}]}';
const invalid='{"candidates":[{"name":"Cafe","category":"cafe","evidenceNote":"unexpected"}]}';
const reply=(content:string,model='insta-places')=>Response.json({model,choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});

it('repairs one invalid model response, preserves the source and counts both calls',async()=>{
 const request=vi.fn().mockResolvedValueOnce(reply(invalid)).mockResolvedValueOnce(reply(valid));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],new AbortController().signal);
 expect(result).toEqual({candidates:[{name:'Cafe',category:'cafe'}],usage:{inputTokens:20,outputTokens:10}});
 expect(request).toHaveBeenCalledTimes(2);
 expect(request.mock.calls[1][1].signal).toBe(request.mock.calls[0][1].signal);
 const bodies=request.mock.calls.map(([,init])=>JSON.parse(init.body));
 expect(bodies[1].messages[0]).toEqual(bodies[0].messages[0]);
 expect(bodies[1].messages[1]).toEqual(bodies[0].messages[1]);
 expect(bodies[1].messages.at(-1).content).toContain('schema');
 expect(JSON.stringify(bodies[1])).not.toContain('evidenceNote');
});

it('keeps strict validation after the single repair attempt',async()=>{
 const request=vi.fn(async()=>reply('{"candidates":[{"name":"Cafe","category":"cafe","latitude":1}]}'));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],new AbortController().signal)).rejects.toThrow('INVALID_RESULT');
 expect(request).toHaveBeenCalledTimes(2);
});

it('does not spend a repair call after cancellation or an invalid upstream envelope',async()=>{
 for(const scenario of ['cancel','wrong_model','http'] as const){
  const abort=new AbortController();
  const request=vi.fn(async()=>{
   if(scenario==='cancel'){abort.abort();return reply(invalid);}
   return scenario==='http'?new Response(null,{status:503}):reply(valid,'unexpected-model');
  });
  await expect(new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],abort.signal)).rejects.toThrow(scenario==='cancel'?'WORKER_STOPPING':scenario==='http'?'INFERENCE_FAILED':'INVALID_RESULT');
  expect(request).toHaveBeenCalledTimes(1);
 }
});

it('does not add a call when the initial response is valid',async()=>{
 const request=vi.fn(async()=>reply(valid));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],new AbortController().signal);
 expect(result.usage).toEqual({inputTokens:10,outputTokens:5});expect(request).toHaveBeenCalledTimes(1);
});
