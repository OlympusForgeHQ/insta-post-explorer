// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {decidePlaceResolution} from '@/lib/places/resolution';
import {planAll} from '@/server/places/analysis';
import {isSupportedRecovery} from '@/lib/places/recovery';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';
const candidate:PlaceCandidate={name:'Example Bakery',address:'12 Example Street, Example Village, London W2 2AF',city:'London',country:'United Kingdom',region:'England',category:'patisserie',confidence:.8,evidence:[{type:'CAPTION',excerpt:'Example Bakery, 12 Example Street, London'}]};
const venue:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'example',providerName:'Example Bakery',displayName:'Example Bakery',address:'Example Bakery, 12 Example Street, London, W2 2BB, United Kingdom',city:'City of Westminster',country:'United Kingdom',countryCode:'GB',region:'England',latitude:51.5,longitude:-.1,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};
// Structured provider fields must resolve presentation differences without
// making another street/number or another occupant interchangeable.
describe('structured place evidence',()=>{
 it('compares explicitly matching GB ground floors without losing the complete street number',()=>{
  const c={...candidate,address:'Ground Floor, 24 Example Street, London'};
  const p={...venue,address:'Example Bakery, Ground Floor 24 Example Street, London, United Kingdom',street:'Example Street',houseNumber:'Ground Floor 24',localityNames:['London']};
  const saved=structuredClone(p);
  for(const address of ['Ground Floor, 24 Example Street, London','Ground Floor 24 Example Street, London','GF, 24 Example Street, London','GF 24 Example Street, London']){
   for(const houseNumber of ['Ground Floor 24','GF 24']){
    const decision=decidePlaceResolution({candidate:{...c,address},resolved:{...p,houseNumber}});
    expect(decision.precision).toBe('EXACT');
    expect(decision.reasons).toContain('address_provider_verified');
   }
  }
  expect(p).toEqual(saved);
  for(const address of ['Ground Floor, 23 Example Street, London','Ground Floor, 24A Example Street, London','Ground Floor, 24-26 Example Street, London',
   'Ground Floor, 24 Other Street, London','24 Example Street, London','First Floor, 24 Example Street, London',
   'Ground Floor, Flat 2, 24 Example Street, London','Ground Floor, 24 Example Street, Flat 2, London',
   'Ground Floor, 24 Example Street, Block A, London','Ground Floor, 24 Example Street, Basement, London']){
   expect(decidePlaceResolution({candidate:{...c,address},resolved:p}).precision).toBe('UNKNOWN');
  }
  for(const bad of [{...p,houseNumber:'Ground Floor 23'},{...p,houseNumber:'Ground Floor 24A'},
   {...p,houseNumber:'Ground Floor 24-26'},{...p,houseNumber:'First Floor 24'},
   {...p,houseNumber:'Flat 2 24'},{...p,houseNumber:'GF'},{...p,providerName:'Different Bakery'},
   {...p,countryCode:'IE'},{...p,countryCode:'BE'},{...p,countryCode:null}]){
   expect(decidePlaceResolution({candidate:c,resolved:bad}).precision).toBe('UNKNOWN');
  }
 });
 it('uses provider-asserted city and exact street/number despite surrounding address context',()=>{
  const resolved={...venue,street:'Example Street',houseNumber:'12',localityNames:['City of Westminster','London']};
  expect(decidePlaceResolution({candidate,resolved}).precision).toBe('EXACT');
  for(const bad of [{...resolved,houseNumber:'14'},{...resolved,street:'Other Street'},
   {...resolved,providerName:'Different Bakery'},{...resolved,localityNames:['City of Westminster']},
   {...resolved,country:'France',countryCode:'FR'}])expect(decidePlaceResolution({candidate,resolved:bad}).precision).toBe('UNKNOWN');
 });
 it('accepts contextual city suffix only with exact address and retains tenant distinctions',()=>{
  const c={...candidate,name:'Example Paris',city:'Paris',region:null,country:'France',address:'10 avenue de Test, 75016 Paris'};
  const p={...venue,providerName:'Example Hotel',displayName:'Example Hotel',city:'Paris',country:'France',countryCode:'FR',address:'Example Hotel, 10 Avenue de Test, 75016 Paris, France',street:'Avenue de Test',houseNumber:'10'};
  expect(decidePlaceResolution({candidate:c,resolved:p}).precision).toBe('EXACT');
  expect(decidePlaceResolution({candidate:{...c,address:null},resolved:p}).precision).toBe('UNKNOWN');
  expect(decidePlaceResolution({candidate:c,resolved:{...p,providerName:'Example Palace'}}).precision).toBe('UNKNOWN');
 });
 it('ignores only an originally inferred region and rejects provenance downgrades',()=>{
  const c={...candidate,address:null,city:'Paris',country:'France',region:'Region A',inferredFields:['region' as const]};
  const p={...venue,city:'Paris',country:'France',countryCode:'FR',region:'Region B'};
  expect(decidePlaceResolution({candidate:c,resolved:p}).precision).toBe('PROBABLE');
  expect(decidePlaceResolution({candidate:{...c,inferredFields:[]},resolved:p}).precision).toBe('UNKNOWN');
  expect(isSupportedRecovery({...c,inferredFields:[]},c)).toBe(false);
 });
 it('expands only explicitly scoped multi-address recommendations, preserving source evidence',async()=>{
  const c={...candidate,name:'Example Bakery',address:null,city:'Paris',country:'France',region:null,evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery\nPlusieurs adresses à Paris'}]};
  const a={...venue,city:'Paris',country:'France',countryCode:'FR',region:null};
  const b={...a,providerPlaceId:'second',latitude:48.87};
  const [plan]=await planAll([c],'Restaurant',{resolve:async()=>[a,b]});
  const branches=(plan as typeof plan & {branches?:typeof plan[]}).branches;
  expect(branches?.map(x=>x.best?.resolved.providerPlaceId).sort()).toEqual(['example','second']);
  expect(branches?.every(x=>x.candidate===plan.candidate)).toBe(true);
  for(const evidence of ['Example Bakery à Paris','Other Bakery: plusieurs adresses à Paris','Example Bakery: plusieurs adresses à Lyon','Example Bakery: plusieurs adresses à Paris Texas']){
   const [ambiguous]=await planAll([{...c,evidence:[{type:'CAPTION',excerpt:evidence}]}],'Restaurant',{resolve:async()=>[a,b]});
   expect(ambiguous.best).toBeNull();
  }
 });
});

import {GeoapifyPlaceResolver} from '@/server/places/resolvers/geoapify';
it('uses an independently retrieved POI when the geocoder score only reflects the wrong locality label',async()=>{
 const raw={place_id:'venue',name:'Example Bakery',formatted:venue.address,address_line2:'12 Example Street, London, W2 2BB, United Kingdom',street:'Example Street',housenumber:'12',city:'City of Westminster',country:'United Kingdom',country_code:'gb',state:'England',postcode:'W2 2BB',lat:51.5,lon:-.1,result_type:'amenity',rank:{confidence:0,match_type:'full_match'}};
 const fetchMock=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).includes('/v2/places')?{features:[{properties:{...raw,rank:undefined,result_type:undefined}}]}:{results:[raw]})));
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock});
 const [plan]=await planAll([{...candidate,address:null}],'Restaurant',resolver);
 expect(plan.best?.resolved.providerPlaceId).toBe('venue');
 expect(plan.best?.resolved.providerRank).toBeNull();
 expect(plan.best?.scored.precision).toBe('EXACT');
 expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/v2/places'))).toBe(true);
});
it('retrieves city-scoped branches beyond the first geocoding result page',async()=>{
 const raw={place_id:'city',name:'Paris',city:'Paris',country:'France',country_code:'fr',lat:48.85,lon:2.35,result_type:'city',rank:{confidence:1,match_type:'full_match'}};
 const fetchMock=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).includes('/v2/places')?{features:[{properties:{...raw,place_id:'branch',name:'Example Bakery',street:'Rue Test',housenumber:'12',formatted:'12 Rue Test, Paris, France'}}]}:{results:[raw]})));
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock});
 const c={...candidate,address:null,city:'Paris',country:'France',region:null,evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery\nPlusieurs adresses à Paris'}]};
 const [plan]=await planAll([c],'Restaurant',resolver);
 expect(plan.best?.resolved.providerPlaceId).toBe('branch');
 expect(fetchMock.mock.calls.some(([url])=>new URL(String(url)).searchParams.get('filter')==='place:city')).toBe(true);
 expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/v2/places')).every(([url])=>new URL(String(url)).searchParams.has('categories'))).toBe(true);
});
it('rejects a truncated street and structured street contradictions without formatted text',()=>{
 for(const providerRank of [0,1])for(const address of ['12 Example Street West, London','Old Example Street 12, London','12 Other Street, London']){
  const resolved={...venue,city:'London',street:'Example Street',houseNumber:'12',providerRank};
  expect(decidePlaceResolution({candidate:{...candidate,address},resolved}).precision).toBe('UNKNOWN');
  expect(decidePlaceResolution({candidate:{...candidate,address},resolved:{...resolved,address:null}}).precision).toBe('UNKNOWN');
 }
});
it('detects a saturated city catalog before discarding nameless results',async()=>{
 const raw={place_id:'city',name:'Paris',city:'Paris',country:'France',country_code:'fr',lat:48.85,lon:2.35,result_type:'city',rank:{confidence:1,match_type:'full_match'}};
 const fetchMock=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).includes('/v2/places')?{features:Array.from({length:100},(_,i)=>({properties:{...raw,place_id:`branch-${i}`,name:i===99?null:'Example Bakery'}}))}:{results:[raw]})));
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock});
 const c={...candidate,address:null,city:'Paris',country:'France',region:null,evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery: plusieurs adresses à Paris'}]};
 await expect(resolver.resolve({candidate:c,sourceTheme:'Restaurant'})).rejects.toThrow('GEOAPIFY_INVALID_RESPONSE');
});
it('accepts a compact account spelling and an omitted cuisine descriptor without merging different cuisines',()=>{
 const v={...venue,city:'London'};
 expect(decidePlaceResolution({candidate:{...candidate,name:'examplebakery',address:null},resolved:v}).precision).toBe('EXACT');
 const c={...candidate,name:'Example Bakehouse',address:null};
 expect(decidePlaceResolution({candidate:c,resolved:{...v,providerName:'Example Italian Bakehouse'}}).precision).toBe('EXACT');
 expect(decidePlaceResolution({candidate:{...c,name:'Example French Bakehouse'},resolved:{...v,providerName:'Example Italian Bakehouse'}}).precision).toBe('UNKNOWN');
});
it('retains zero query confidence but resolves independently agreeing structured identity as probable',()=>{
 const resolved={...venue,street:'Example Street',houseNumber:'12',localityNames:['City of Westminster','London'],providerRank:0};
 const decision=decidePlaceResolution({candidate,resolved});
 expect(decision.precision).toBe('PROBABLE');
 expect(decision.reasons).toContain('structured_identity_despite_query_confidence');
 expect(resolved.providerRank).toBe(0);
 for(const bad of [{...resolved,houseNumber:'14'},{...resolved,providerName:'Other Bakery'},
  {...resolved,providerResultType:'street'},{...resolved,street:undefined},{...resolved,providerStreetConfidence:0},{...resolved,providerBuildingConfidence:0},{...resolved,providerMatchType:'inner_part'}])expect(decidePlaceResolution({candidate,resolved:bad}).precision).toBe('UNKNOWN');
 expect(decidePlaceResolution({candidate:{...candidate,address:null},resolved}).precision).toBe('UNKNOWN');
});
it('represents an explicitly named travel country as a provider-bounded approximate zone only',()=>{
 const c={...candidate,name:'France',address:null,city:null,region:null,country:'France',category:'voyage' as const};
 const p={...venue,providerName:'France',city:null,region:null,country:'France',countryCode:'FR',providerResultType:'country',latitude:46,longitude:2,providerBounds:{lon1:-5,lat1:41,lon2:10,lat2:51}};
 const decision=decidePlaceResolution({candidate:c,resolved:p});
 expect(decision.precision).toBe('APPROXIMATE');
 expect(decision.approximationRadiusMeters).toBeGreaterThan(500_000);
 expect(decision.reasons).toContain('named_country_destination');
 for(const bad of [{...c,name:'Specific Castle'},{...c,category:'restaurant' as const},{...c,city:'Paris'},{...c,country:'Belgium'},{...c,address:'12 Street'}])expect(decidePlaceResolution({candidate:bad,resolved:p}).precision).toBe('UNKNOWN');
 for(const bad of [{...p,providerBounds:undefined},{...p,providerRank:0},{...p,providerBounds:{lon1:900,lat1:41,lon2:10,lat2:51}}])expect(decidePlaceResolution({candidate:c,resolved:bad}).precision).toBe('UNKNOWN');
});

it('retains provider country bounds including an antimeridian crossing through the adapter',async()=>{
 const raw={place_id:'country-fj',name:'Fiji',country:'Fiji',country_code:'fj',lat:-18,lon:178,result_type:'country',bbox:{lon1:177,lat1:-21,lon2:-178,lat2:-12},rank:{confidence:1,match_type:'full_match'}};
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:async(url)=>{
  const params=new URL(String(url)).searchParams;
  expect(params.get('type')).toBe('country');
  expect(params.get('text')).toBe('Fidji');
  expect(params.has('name')).toBe(false);
  return new Response(JSON.stringify({results:[raw]}));
 }});
 const c={...candidate,name:'Fidji',address:null,city:null,region:null,country:'Fidji',category:'voyage' as const};
 const [plan]=await planAll([c],'Voyages',resolver);
 expect(plan.best?.resolved.providerBounds).toEqual(raw.bbox);
 expect(plan.best?.scored.precision).toBe('APPROXIMATE');
 expect(plan.best?.scored.approximationRadiusMeters).toBeGreaterThan(500_000);
 expect(plan.best?.scored.approximationRadiusMeters).toBeLessThan(2_000_000);
});
