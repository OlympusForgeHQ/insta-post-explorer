import { expect, it, vi } from 'vitest';
import { parseCandidates, HermesPlacesInference } from '../src/places/inference.js';
import type { PreparedPost } from '../src/places/api.js';
import { groundPlacesEvidence } from '../src/places/evidence.js';

const prepared:PreparedPost={input:{post_id:'post',input_hash:'hash',caption:'Untrusted cafe caption'},media:[],categoryRules:'Use owner categories only',outputSchema:{type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',items:{type:'object',additionalProperties:false,required:['name','category'],properties:{name:{type:'string'},category:{enum:['cafe']}}}}}}};
const valid='{"candidates":[{"name":"Cafe","category":"cafe"}]}';
const invalid='{"candidates":[{"name":"Cafe","category":"cafe","evidenceNote":"unexpected"}]}';
const reply=(content:string,model='insta-places',finishReason='stop')=>Response.json({model,choices:[{message:{content},finish_reason:finishReason}],usage:{prompt_tokens:10,completion_tokens:5}});
const empty='{"candidates":[]}';

it.each([
 {source:'caption',region:'Lapland',caption:'Located in Finnish Lapland, this unique hotel lets you watch the aurora from your bed.'},
 {source:'ocr',region:null,caption:'Stay in this unique hotel in Finland and watch the aurora from your bed.'},
])('rechecks empty fusion after a $source proposal and retains a source-grounded destination',async({source,region,caption})=>{
 const candidate={name:null,address:null,city:null,region,country:'Finland',category:'voyage',categoryReason:'The source recommends a stay without identifying the hotel.',confidence:.8,evidence:[{type:'CAPTION',excerpt:caption}]};
 const destinationPrepared:PreparedPost={...prepared,input:{...prepared.input,caption},outputSchema:{
  type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',items:{
   type:'object',additionalProperties:false,required:Object.keys(candidate),properties:{
    name:{type:['string','null']},address:{type:['string','null']},city:{type:['string','null']},region:{type:['string','null']},country:{type:['string','null']},
    category:{enum:['voyage']},categoryReason:{type:'string'},confidence:{type:'number'},evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['type','excerpt'],properties:{type:{enum:['CAPTION']},excerpt:{type:'string'}}}},
   },
  }}}},
 };
 const data={post:destinationPrepared.input,captionCandidates:source==='caption'?[candidate]:[],ocrCandidates:source==='ocr'?[[candidate]]:[],transcripts:[],mediaCoverage:[]};
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(empty)).mockResolvedValueOnce(reply(JSON.stringify({candidates:[candidate]})));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(destinationPrepared,'fusion',data,[],new AbortController().signal,
  candidates=>groundPlacesEvidence(candidates,caption,[]));
 expect(result).toEqual({candidates:[candidate],usage:{inputTokens:20,outputTokens:10}});
 expect(request).toHaveBeenCalledTimes(2);
 const bodies=request.mock.calls.map(([,init])=>JSON.parse(init!.body as string));
 expect(bodies[1].messages.slice(0,2)).toEqual(bodies[0].messages);
 expect(bodies[1].messages).toHaveLength(3);
 expect(request.mock.calls[1][1]!.signal).toBe(request.mock.calls[0][1]!.signal);
});

it.each(['incidental_landmark','comparison','author_only'] as const)('allows an empty reviewed result when the proposal is %s',async scenario=>{
 const caption={incidental_landmark:'Bake this cake at home near the Eiffel Tower.',comparison:'This view looks like Lapland, but no location is given.',author_only:'Photo via @wildaboutlapland.'}[scenario];
 const data={post:{...prepared.input,caption},captionCandidates:[{name:'Lapland',category:'voyage'}],ocrCandidates:[]};
 const request=vi.fn<typeof fetch>(async()=>reply(empty));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'fusion',data,[],new AbortController().signal);
 expect(result).toEqual({candidates:[],usage:{inputTokens:20,outputTokens:10}});
 expect(request).toHaveBeenCalledTimes(2);
});

it.each(['caption','ocr','fusion'] as const)('does not review an empty %s result without lost fusion proposals',async stage=>{
 const data={captionCandidates:stage==='fusion'?[]:[{name:'Cafe',category:'cafe'}],ocrCandidates:[[]]};
 const request=vi.fn<typeof fetch>(async()=>reply(empty));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,stage,data,[],new AbortController().signal);
 expect(result).toEqual({candidates:[],usage:{inputTokens:10,outputTokens:5}});
 expect(request).toHaveBeenCalledOnce();
});

it.each(['schema','evidence','deadline'] as const)('keeps the original %s protection on an empty-fusion review',async scenario=>{
 const runtime=retryRuntime();
 const request=vi.fn<typeof fetch>(async()=>{
  if(request.mock.calls.length===1){if(scenario==='deadline')runtime.advance(360_000);return reply(empty);}
  return reply(scenario==='schema'?'{"candidates":[{"name":"Cafe","category":"cafe","latitude":1}]}':valid);
 });
 const validate=(candidates:Record<string,unknown>[])=>{
  if(candidates.length)throw Error('PLACES_EVIDENCE_INVALID');
  return candidates;
 };
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'fusion',
  {captionCandidates:[{name:'Cafe',category:'cafe'}],ocrCandidates:[]},[],new AbortController().signal,validate))
  .rejects.toThrow(scenario==='schema'?'INVALID_RESULT':scenario==='evidence'?'PLACES_EVIDENCE_INVALID':'INFERENCE_FAILED');
 expect(request).toHaveBeenCalledTimes(scenario==='deadline'?1:2);
});

it('shares the existing follow-up allowance between format repair and empty-fusion review',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(invalid)).mockResolvedValueOnce(reply(empty));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'fusion',
  {captionCandidates:[{name:'Cafe',category:'cafe'}],ocrCandidates:[]},[],new AbortController().signal);
 expect(result).toEqual({candidates:[],usage:{inputTokens:20,outputTokens:10}});
 expect(request).toHaveBeenCalledTimes(2);
});

it('repairs semantically invalid evidence once from original sources without trusting the rejected response',async()=>{
 const request=vi.fn().mockResolvedValueOnce(reply(valid)).mockResolvedValueOnce(reply('{"candidates":[{"name":"Verified Cafe","category":"cafe"}]}'));
 const validate=(candidates:Record<string,unknown>[])=>{
  if(candidates[0]?.name!=='Verified Cafe')throw Error('PLACES_EVIDENCE_INVALID');
  return candidates;
 };
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'fusion',{caption:'Verified Cafe'},[],new AbortController().signal,validate);
 expect(result.candidates[0].name).toBe('Verified Cafe');
 expect(result.usage).toEqual({inputTokens:20,outputTokens:10});
 expect(request).toHaveBeenCalledTimes(2);
 const body=JSON.parse(request.mock.calls[1][1].body);
 expect(body.messages).toHaveLength(3);
 expect(body.messages.at(-1).content).toContain('PLACES_EVIDENCE_INVALID');
});

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

it('stops after one unsuccessful evidence repair without accepting ungrounded results',async()=>{
 const request=vi.fn(async()=>reply(valid));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'fusion',{},[],new AbortController().signal,()=>{throw Error('PLACES_EVIDENCE_INVALID');})).rejects.toThrow('PLACES_EVIDENCE_INVALID');
 expect(request).toHaveBeenCalledTimes(2);
});

it('does not spend a repair call after cancellation or an invalid upstream envelope',async()=>{
 for(const scenario of ['cancel','wrong_model','http'] as const){
  const abort=new AbortController();
  const request=vi.fn(async()=>{
   if(scenario==='cancel'){abort.abort();return reply(invalid);}
   return scenario==='http'?new Response(null,{status:401}):reply(valid,'unexpected-model');
  });
  await expect(new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],abort.signal)).rejects.toThrow(scenario==='cancel'?'WORKER_STOPPING':scenario==='http'?'INFERENCE_FAILED':'INVALID_RESULT');
  expect(request).toHaveBeenCalledTimes(1);
 }
});

it('does not add a call when the initial response is valid',async()=>{
 const request=vi.fn<typeof fetch>(async()=>reply(valid));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',prepared.input,[],new AbortController().signal);
 expect(result.usage).toEqual({inputTokens:10,outputTokens:5});expect(request).toHaveBeenCalledTimes(1);
 const sent=JSON.parse(request.mock.calls[0][1]!.body as string);
 expect(sent.messages[0].content).toContain('Infer missing country, city or region');
 expect(sent.messages[0].content).toContain('inferredFields');
 expect(sent.messages[0].content).toContain('Keep literal source excerpts unchanged');
});

it('preserves an itinerary larger than the old client limit when the server schema allows it',async()=>{
 const candidates=Array.from({length:51},(_,i)=>({name:`Cafe ${i+1}`,category:'cafe'}));
 const schema=structuredClone(prepared.outputSchema) as {properties:{candidates:Record<string,unknown>}};
 schema.properties.candidates.maxItems=200;
 const request=vi.fn<typeof fetch>(async()=>reply(JSON.stringify({candidates})));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze({...prepared,outputSchema:schema},'fusion',{candidates},[],new AbortController().signal);
 expect(result.candidates).toEqual(candidates);
 expect(request).toHaveBeenCalledTimes(1);
 expect(JSON.parse(request.mock.calls[0][1]!.body as string).max_tokens).toBe(32768);
});

it.each(['capacity','over_capacity','length'] as const)('fails an itinerary limited by %s without retrying to compact away destinations',async limit=>{
 const schema=structuredClone(prepared.outputSchema) as {properties:{candidates:Record<string,unknown>}};
 schema.properties.candidates.maxItems=2;
 const candidates=[{name:'Cafe One',category:'cafe'},{name:'Cafe Two',category:'cafe'}];
 if(limit==='over_capacity')candidates.push({name:'Cafe Three',category:'cafe'});
 const content=limit==='length'?valid:JSON.stringify({candidates});
 const request=vi.fn().mockResolvedValueOnce(reply(content,'insta-places',limit==='length'?'length':'stop')).mockImplementation(async()=>reply(valid));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request).analyze({...prepared,outputSchema:schema},'fusion',{},[],new AbortController().signal)).rejects.toThrow('INVALID_RESULT');
 expect(request).toHaveBeenCalledTimes(1);
});

it('applies bounded learned guidance while preserving source validation',async()=>{
 const request=vi.fn<typeof fetch>(async()=>reply(valid));
 await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze({...prepared,learningContext:{version:1,strategy:'evidence_guidance',recent:{examined:2,formatFailures:0,evidenceFailures:2,successes:0}}},'caption',prepared.input,[],new AbortController().signal);
 expect(JSON.parse(request.mock.calls[0][1]!.body as string).messages[0].content).toContain('Previous comparable analyses failed evidence validation');
});

function retryRuntime(){
 let now=Date.UTC(2026,9,16);
 return {now:()=>now,random:()=>0,advance:(ms:number)=>{now+=ms;},wait:vi.fn(async(ms:number)=>{now+=ms;})};
}
const transientFailure=(status:number|'transport',headers?:Record<string,string>)=>{
 if(status==='transport')throw new TypeError('fetch failed');
 return new Response(null,{status,headers});
};

it.each([429,502,503,504,'transport'] as const)('recovers from %s without spending the format repair or changing its source',async status=>{
 const runtime=retryRuntime();let calls=0;
 const request=vi.fn<typeof fetch>(async()=>{
  calls++;
  return calls===1||calls===3?transientFailure(status):reply(calls===2?invalid:valid);
 });
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',prepared.input,[],new AbortController().signal);
 expect(result).toEqual({candidates:[{name:'Cafe',category:'cafe'}],usage:{inputTokens:20,outputTokens:10}});
 expect(request).toHaveBeenCalledTimes(4);
 const bodies=request.mock.calls.map(([,init])=>init!.body as string);
 expect(bodies[1]).toBe(bodies[0]);expect(bodies[3]).toBe(bodies[2]);
 expect(JSON.parse(bodies[2]).messages).toHaveLength(3);
 expect(JSON.parse(bodies[2]).messages.slice(0,2)).toEqual(JSON.parse(bodies[0]).messages);
 expect(bodies[2]).not.toContain('evidenceNote');
 expect(runtime.wait.mock.calls.map(([ms])=>ms)).toEqual([1000,2000]);
 expect(new Set(request.mock.calls.map(([,init])=>init!.signal)).size).toBe(1);
});

it.each([
 {status:429,code:'INFERENCE_BUSY'},
 {status:503,code:'INFERENCE_FAILED'},
 {status:'transport',code:'INFERENCE_FAILED'},
] as const)('bounds $status retries across the original response and its repair',async({status,code})=>{
 const runtime=retryRuntime();let calls=0;
 const request=vi.fn<typeof fetch>(async()=>++calls===2?reply(invalid):transientFailure(status));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',{},[],new AbortController().signal)).rejects.toThrow(code);
 expect(request).toHaveBeenCalledTimes(7);
 expect(runtime.wait.mock.calls.map(([ms])=>ms)).toEqual([1000,2000,4000,8000,15000]);
 expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string).messages).toHaveLength(3);
});

it.each([
 {header:'30',wait:30_000},
 {header:'Fri, 16 Oct 2026 00:00:40 GMT',wait:40_000},
 {header:'-1',wait:1000},
 {header:'not a date',wait:1000},
] as const)('honors Retry-After $header without a hot retry loop',async({header,wait})=>{
 const runtime=retryRuntime();const cancel=vi.fn();
 const rejected=new Response(new ReadableStream({cancel}),{status:429,headers:{'Retry-After':header}});
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(rejected).mockImplementation(async()=>reply(valid));
 const result=await new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',{},[],new AbortController().signal);
 expect(result.usage).toEqual({inputTokens:10,outputTokens:5});
 expect(cancel).toHaveBeenCalledOnce();expect(runtime.wait.mock.calls[0][0]).toBe(wait);
 expect(request).toHaveBeenCalledTimes(2);
});

it.each(['too_long','deadline_before_wait','deadline_during_wait'] as const)('does not retry early or extend the shared deadline: %s',async scenario=>{
 const runtime=retryRuntime();let calls=0;
 if(scenario==='deadline_during_wait')runtime.wait.mockImplementation(async()=>runtime.advance(360_000));
 const request=vi.fn<typeof fetch>(async()=>{
  calls++;
  if(scenario==='deadline_before_wait')runtime.advance(359_500);
  return calls===1?reply(invalid):transientFailure(429,{'Retry-After':scenario==='too_long'?'61':'1'});
 });
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',{},[],new AbortController().signal)).rejects.toThrow('INFERENCE_BUSY');
 expect(request).toHaveBeenCalledTimes(2);
 expect(runtime.wait).toHaveBeenCalledTimes(scenario==='deadline_during_wait'?1:0);
});

it.each([
 {header:'120',remaining:120_000},
 {header:'Fri, 16 Oct 2026 00:02:00 GMT',remaining:120_000},
 {header:'3600',remaining:900_000},
 {header:'9'.repeat(400),remaining:900_000},
])('carries a bounded busy cooldown to the queue for Retry-After $header',async({header,remaining})=>{
 const runtime=retryRuntime();
 const request=vi.fn<typeof fetch>(async()=>transientFailure(429,{'Retry-After':header}));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',{},[],new AbortController().signal)).rejects.toMatchObject({message:'INFERENCE_BUSY',retryAfterMs:remaining});
 expect(request).toHaveBeenCalledOnce();expect(runtime.wait).not.toHaveBeenCalled();
});

it('retains the strongest known remaining busy cooldown across retries',async()=>{
 const runtime=retryRuntime();let calls=0;
 // Simulate elapsed wall time shorter than scheduled waits so later replies
 // cannot erase a still-active cooldown learned from the first response.
 runtime.wait.mockImplementation(async()=>runtime.advance(1000));
 const request=vi.fn<typeof fetch>(async()=>transientFailure(429,++calls===1?{'Retry-After':'30'}:calls===2?{'Retry-After':'10'}:undefined));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,runtime).analyze(prepared,'caption',{},[],new AbortController().signal)).rejects.toMatchObject({message:'INFERENCE_BUSY',retryAfterMs:25_000});
 expect(request).toHaveBeenCalledTimes(6);
});

it.each(['before_request','during_backoff'] as const)('aborts promptly %s without another inference request',async scenario=>{
 const stop=new AbortController();
 if(scenario==='before_request')stop.abort();
 const request=vi.fn<typeof fetch>(async()=>{
  setTimeout(()=>stop.abort(),10);
  return transientFailure(429,{'Retry-After':'30'});
 });
 const error=await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',{},[],stop.signal).catch(error=>error);
 expect(error).toBeInstanceOf(Error);expect(error.message).toBe('WORKER_STOPPING');
 expect(error).not.toHaveProperty('retryAfterMs');
 expect(request).toHaveBeenCalledTimes(scenario==='before_request'?0:1);
});

it.each(['broken_body','invalid_json'] as const)('does not repeat an accepted inference after %s',async scenario=>{
 const body=scenario==='broken_body'?new ReadableStream({start(controller){controller.error(new TypeError('connection lost'));}}):'not JSON';
 const request=vi.fn<typeof fetch>(async()=>new Response(body));
 await expect(new HermesPlacesInference('http://hermes.test/v1','private',request,retryRuntime()).analyze(prepared,'caption',{},[],new AbortController().signal)).rejects.toThrow(scenario==='broken_body'?'INFERENCE_FAILED':'INVALID_RESULT');
 expect(request).toHaveBeenCalledTimes(1);
});

it('rejects repeated decoded JSON keys while accepting separate objects',()=>{
 for(const text of ['{"candidates":[],"candidates":[]}', '{"candidates":[{"name":"Cafe","name":"Other","category":"cafe"}]}', String.raw`{"candidates":[],"\u0063andidates":[]}`])expect(()=>parseCandidates(text,prepared.outputSchema)).toThrow('INVALID_RESULT');
 expect(parseCandidates(JSON.stringify({candidates:[{name:'A \"name\": value } [',category:'cafe'},{name:'Other',category:'cafe'}]}),prepared.outputSchema).candidates).toHaveLength(2);
 expect(()=>parseCandidates('['.repeat(129)+'0'+']'.repeat(129),{type:'array'})).toThrow('INVALID_RESULT');
});
it('repairs duplicate keys within the existing single follow-up allowance',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(reply('{"candidates":[],"candidates":[]}')).mockResolvedValueOnce(reply(valid));
 expect((await new HermesPlacesInference('http://hermes.test/v1','private',request).analyze(prepared,'caption',{},[],new AbortController().signal)).candidates).toHaveLength(1);
 expect(request).toHaveBeenCalledTimes(2);
});
