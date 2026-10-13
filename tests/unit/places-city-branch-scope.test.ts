// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {placeCandidateSchema} from '@/lib/places/candidates';
import {workerCandidatesSchema,workerResultSchema} from '@/lib/places/worker-contract';
import {recommendsCityBranches} from '@/lib/places/branch-scope';
import {isSupportedRecovery} from '@/lib/places/recovery';
import {planAll} from '@/server/places/analysis';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';
const generic={name:'Example Bakery',address:null,city:'London',region:null,country:'United Kingdom',category:'patisserie',categoryReason:'Bakery recommendation',confidence:.8,
 evidence:[{type:'CAPTION',excerpt:'Example Bakery in London'}],locationScope:{kind:'CITY',evidenceIndex:0}};
const sourceContext={caption:generic.evidence[0].excerpt,structuredLocation:null};

it('accepts optional grounded city scope through the worker contract and preserves legacy omission',()=>{
 const parsed=workerCandidatesSchema.parse({candidates:[generic]}).candidates[0];
 expect(recommendsCityBranches(parsed,sourceContext)).toBe(true);
 expect(recommendsCityBranches(parsed)).toBe(false);
 expect(recommendsCityBranches(parsed,{...sourceContext,structuredLocation:'Hackney'})).toBe(false);
 const legacy={...generic,locationScope:undefined};
 expect(workerCandidatesSchema.parse({candidates:[legacy]}).candidates[0]).toEqual(legacy);
 expect(recommendsCityBranches(placeCandidateSchema.parse(legacy))).toBe(false);
 for(const locationScope of [{kind:'CITY',evidenceIndex:8},{kind:'CITY',evidenceIndex:-1},{kind:'ALL',evidenceIndex:0},{kind:'CITY',evidenceIndex:0,latitude:51}]){
  expect(workerCandidatesSchema.safeParse({candidates:[{...generic,locationScope}]}).success).toBe(false);
 }
});

it('requires complete grounded city evidence and retains branch ambiguity on specific or unknown scope',()=>{
 for(const excerpt of ['Example Bakery London','@examplebakery London','#ExampleBakery #London','Example Bakery à London']){
  expect(recommendsCityBranches(placeCandidateSchema.parse({...generic,evidence:[{type:'CAPTION',excerpt}]}),{...sourceContext,caption:excerpt})).toBe(true);
 }
 for(const patch of [
  {address:'12 Test Road'}, {country:null}, {city:null}, {inferredFields:['city']}, {category:'voyage'},
  {locationScope:{kind:'SPECIFIC',evidenceIndex:0}}, {locationScope:{kind:'UNKNOWN',evidenceIndex:0}},
  {locationScope:{kind:'CITY',evidenceIndex:1}},
  {evidence:[{type:'CAPTION',excerpt:'Example Bakery Hackney London'}]},
  {evidence:[{type:'CAPTION',excerpt:'Example Bakery near Central Station, London'}]},
  {evidence:[generic.evidence[0],{type:'VIDEO_OCR',excerpt:'Hackney'}]},
  {evidence:[{type:'CAPTION',excerpt:'Other Bakery London'}]},
 ])expect(recommendsCityBranches(placeCandidateSchema.parse({...generic,...patch}),sourceContext)).toBe(false);
});

it('keeps every independently verified city branch, rejects other cities and preserves original evidence',async()=>{
 const candidate=placeCandidateSchema.parse(generic);
 const branch:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'a',providerName:'Example Bakery',displayName:'Example Bakery',address:'12 Test Road, London',city:'London',region:null,country:'United Kingdom',countryCode:'GB',latitude:51.5,longitude:-.1,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};
 const results=[branch,{...branch,providerPlaceId:'b',address:'20 Other Street, London',latitude:51.52}, {...branch,providerPlaceId:'other-city',city:'Manchester',latitude:53.48}, {...branch,providerPlaceId:'wrong-name',providerName:'Other Bakery'}, {...branch,providerPlaceId:'country-unverified',country:null,countryCode:null,latitude:51.53}, {...branch,providerPlaceId:'duplicate'}];
 const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>results},[],sourceContext);
 expect(plan.branches?.map(p=>p.best?.resolved.providerPlaceId)).toEqual(['a','b']);
 expect(plan.reasons).toContain('generic_city_branches');
 expect(plan.branches?.every(p=>p.candidate===candidate)).toBe(true);
 expect(candidate.evidence).toEqual(generic.evidence);
 const [ambiguous]=await planAll([{...candidate,locationScope:undefined}],'Restaurant',{resolve:async()=>results.slice(0,2)});
 expect(ambiguous.best).toBeNull();
 expect(ambiguous.reasons).toContain('ambiguous_branches');
});

it('does not let contextual recovery silently introduce or broaden extraction scope',()=>{
 const candidate=placeCandidateSchema.parse(generic);
 expect(isSupportedRecovery({...candidate,locationScope:undefined},candidate)).toBe(false);
 expect(isSupportedRecovery({...candidate,locationScope:{kind:'SPECIFIC',evidenceIndex:0}},candidate)).toBe(false);
 expect(isSupportedRecovery(candidate,{...candidate,region:'England',inferredFields:['region']})).toBe(true);
});


import {z} from 'zod';
import {HermesPlacesInference} from '../../services/worker/src/places/inference';
import {groundPlacesEvidence} from '../../services/worker/src/places/evidence';
import {PLACE_CONTEXT_RULES} from '@/lib/places/resolution';
import {GeoapifyPlaceResolver} from '@/server/places/resolvers/geoapify';

it('roundtrips scope through the exported schema, worker inference, evidence grounding and completion parser',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'insta-places',choices:[{message:{content:JSON.stringify({candidates:[generic]})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));
 const prepared={input:{post_id:'p',input_hash:'hash',caption:generic.evidence[0].excerpt},media:[],categoryRules:PLACE_CONTEXT_RULES,outputSchema:z.toJSONSchema(workerCandidatesSchema)};
 const result=await new HermesPlacesInference('https://example.test','test',request).analyze(prepared,'fusion',{post:prepared.input},[],new AbortController().signal,
  candidates=>groundPlacesEvidence(candidates,prepared.input.caption,[]));
 const completion=workerResultSchema.parse({...result,media:[],model:'deepseek/deepseek-v4.1-flash',elapsedMs:1});
 expect(completion.candidates[0].locationScope).toEqual(generic.locationScope);
 expect(recommendsCityBranches(completion.candidates[0],sourceContext)).toBe(true);
 const sent=JSON.parse(request.mock.calls[0][1]!.body as string);
 expect(sent.messages[0].content).toContain('Retain narrower context in evidence');
 expect(sent.messages[0].content).toContain('FULL caption');
});

it('retrieves the complete bounded city catalog even when geocoding already verified one generic branch',async()=>{
 const city={place_id:'city',name:'London',city:'London',country:'United Kingdom',country_code:'gb',lat:51.5,lon:-.1,result_type:'city',rank:{confidence:1,match_type:'full_match'}};
 const first={...city,place_id:'a',name:'Example Bakery',formatted:'12 Test Street, London',result_type:'amenity'};
 const second={...first,place_id:'b',formatted:'20 Other Street, London',lat:51.52};
 const request=vi.fn<typeof fetch>(async url=>{
  const parsed=new URL(String(url));
  if(parsed.pathname.includes('/v2/places')){
   expect(parsed.searchParams.get('filter')).toBe('place:city');
   return new Response(JSON.stringify({features:[first,second].map(properties=>({properties}))}));
  }
  return new Response(JSON.stringify({results:[parsed.searchParams.has('name')?first:city]}));
 });
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:request});
 const [plan]=await planAll([placeCandidateSchema.parse(generic)],'Restaurant',resolver,[],sourceContext);
 expect(plan.branches?.map(p=>p.best?.resolved.providerPlaceId)).toEqual(['a','b']);
 expect(request.mock.calls.some(([url])=>String(url).includes('/v2/places'))).toBe(true);
});


it('rejects omitted source discriminators and account-only city claims after worker grounding',async()=>{
 const branch:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'a',providerName:'Example Bakery',displayName:'Example Bakery',address:'12 Test Road, London',city:'London',region:null,country:'United Kingdom',countryCode:'GB',latitude:51.5,longitude:-.1,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};
 const resolver={resolve:async()=>[branch,{...branch,providerPlaceId:'b',address:'20 Other Road, London',latitude:51.52}]};
 for(const [caption,evidence] of [
  ['Example Bakery in London\nHackney branch',generic.evidence],
  ['@examplebakerylondon',[{type:'AUTHOR_TEXT',excerpt:'@examplebakerylondon'}]],
  ['@examplebakerylondon',[{type:'CAPTION',excerpt:'@examplebakerylondon'}]],
  ['@examplebakery_london',[{type:'CAPTION',excerpt:'@examplebakery_london'}]],
  ['@examplebakery.london',[{type:'CAPTION',excerpt:'@examplebakery.london'}]],
  ['#ExampleBakeryLondon',[{type:'CAPTION',excerpt:'#ExampleBakeryLondon'}]],
 ] as const){
  const output=groundPlacesEvidence([{...generic,evidence}],caption,[]);
  const parsed=workerCandidatesSchema.parse({candidates:output});
  const [plan]=await planAll(parsed.candidates,'Restaurant',resolver,[],{caption,structuredLocation:null});
  expect(plan.branches).toBeUndefined();
  expect(plan.best).toBeNull();
  expect(plan.reasons).toContain('ambiguous_branches');
 }
});
