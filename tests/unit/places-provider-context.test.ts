// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {GeoapifyPlaceResolver} from '@/server/places/resolvers/geoapify';
import {planAll} from '@/server/places/analysis';
import {selectContextualVenueArea} from '@/lib/places/approximate-resolution';
import {decidePlaceResolution} from '@/lib/places/resolution';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';
const candidate:PlaceCandidate={name:'Example Cafe',address:null,city:'London',region:null,country:'United Kingdom',category:'cafe',confidence:.8,evidence:[{type:'CAPTION',excerpt:'Example Cafe in London'}]};
const raw={place_id:'venue',name:'Example Cafe',formatted:'Example Cafe, London, United Kingdom',city:'London',country:'United Kingdom',country_code:'gb',lat:51.5,lon:-.1,result_type:'amenity',rank:{confidence:1,match_type:'full_match'}};
const venue:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'venue',displayName:raw.name,providerName:raw.name,address:raw.formatted,city:'London',region:null,country:'United Kingdom',countryCode:'GB',latitude:51.5,longitude:-.1,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};

it('recovers an identity from bounded free-form retrieval when structured search returns only a city',async()=>{
 const fetchMock=vi.fn(async(input:string|URL|Request)=>{
  const url=new URL(String(input));
  return new Response(JSON.stringify({results:[url.searchParams.has('text')?raw:{...raw,place_id:'city',name:'London',result_type:'city',rank:{confidence:.25,match_type:'match_by_city_or_disrict'}}]}));
 });
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock});
 const [plan]=await planAll([candidate],'Restaurant',resolver);
 expect(plan.best?.resolved.providerPlaceId).toBe('venue');
 expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
 const success=vi.fn(async()=>new Response(JSON.stringify({results:[raw]})));
 await new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:success}).resolve({candidate,sourceTheme:'Restaurant'});
 expect(success).toHaveBeenCalledTimes(1);
});

it('uses current provider translations for the same area but not historic names or unrelated POI localities',async()=>{
 const c:PlaceCandidate={...candidate,name:'Vienna',city:'Vienna',country:'Austria',category:'voyage'};
 const city={...raw,name:'Wien',city:'Wien',country:'Austria',country_code:'at',result_type:'city',other_names:{'name:en':'Vienna','old_name':'Old Example','description':'Unrelated Name'}};
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:async()=>new Response(JSON.stringify({results:[city]}))});
 const [plan]=await planAll([c],'Voyages',resolver);
 expect(plan.best?.scored.precision).toBe('APPROXIMATE');
 for(const name of ['Old Example','Unrelated Name']){
  const [other]=await planAll([{...c,name,city:name}],'Voyages',resolver);
  expect(other.best).toBeNull();
 }
 const [poi]=await planAll([{...candidate,name:'Vienna',city:'Vienna',country:'Austria'}],'Restaurant',new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:async()=>new Response(JSON.stringify({results:[{...city,result_type:'amenity',city:'Elsewhere'}]}))}));
 expect(poi.best).toBeNull();
});

it('compares complete bilingual streets and unambiguous country aliases without weakening contradictions',()=>{
 const c={...candidate,address:'12 Rue Exemple, Ixelles',city:'Ixelles',country:'Belgium'};
 const p={...venue,address:'Example Cafe, Rue Exemple - Voorbeeldstraat 12, Ixelles - Elsene, Belgium',street:'Rue Exemple - Voorbeeldstraat',houseNumber:'12',city:'Ixelles - Elsene',country:'Belgium',countryCode:'BE'};
 expect(decidePlaceResolution({candidate:c,resolved:p}).precision).toBe('EXACT');
 for(const bad of [{...p,houseNumber:'14'},{...p,street:'Rue Exemple Nord - Noord Voorbeeldstraat'},{...p,providerName:'Other Cafe'}])expect(decidePlaceResolution({candidate:c,resolved:bad}).precision).toBe('UNKNOWN');
 for(const [code,label,actual]of [['US','USA','United States'],['CZ','Czech Republic','Czechia'],['NL','The Netherlands','Netherlands']]){
  expect(decidePlaceResolution({candidate:{...candidate,country:label},resolved:{...venue,country:actual,countryCode:code}}).precision).toBe('EXACT');
  expect(decidePlaceResolution({candidate:{...candidate,country:'France'},resolved:{...venue,country:actual,countryCode:code}}).precision).toBe('UNKNOWN');
 }
});

it('represents provider-classified populated areas with bounds as zones, never as city-named shops',async()=>{
 const c:PlaceCandidate={...candidate,name:'Example Island',city:'Example Island',country:'Greece',category:'voyage'};
 const island={...raw,name:'Example Island',city:'Example Municipality',country:'Greece',country_code:'gr',category:'populated_place',bbox:{lon1:24,lon2:24.2,lat1:36,lat2:36.2},lat:36.1,lon:24.1};
 const resolver=(properties:typeof island)=>new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:async()=>new Response(JSON.stringify({results:[properties]}))});
 const [area]=await planAll([c],'Voyages',resolver(island));
 expect(area.best?.scored.precision).toBe('APPROXIMATE');
 expect(area.best?.scored.approximationRadiusMeters).toBeGreaterThan(10000);
 for(const properties of [{...island,category:'commercial'},{...island,country:'Italy',country_code:'it'}]){
  const [invalid]=await planAll([c],'Voyages',resolver(properties));expect(invalid.best).toBeNull();
 }
});

it('distinguishes an attraction from transit stops borrowing its name before branch ambiguity',async()=>{
 const c:PlaceCandidate={...candidate,name:'Example Wheel',category:'voyage'};
 const attraction={...venue,providerName:c.name,displayName:c.name!,category:'tourism.attraction'};
 const stops=[1,2].map(i=>({...attraction,providerPlaceId:'stop-'+i,latitude:51.5+i*.01,category:'public_transport.bus'}));
 const [plan]=await planAll([c],'Voyages',{resolve:async()=>[attraction,...stops]});
 expect(plan.best?.resolved.providerPlaceId).toBe('venue');
 const [onlyStops]=await planAll([c],'Voyages',{resolve:async()=>stops});expect(onlyStops.best).toBeNull();
 const station={...attraction,providerName:'Example Station',displayName:'Example Station',category:'public_transport.train'};
 expect(decidePlaceResolution({candidate:{...c,name:'Example Station'},resolved:station}).precision).toBe('EXACT');
});

it('searches the POI catalog within a uniquely verified city boundary without trusting homonymous cities',async()=>{
 const city={...raw,place_id:'london-boundary',name:'Greater London',city:'Greater London',result_type:'city',category:'populated_place',bbox:{lon1:-.5,lon2:.3,lat1:51.2,lat2:51.7}};
 const fetchMock=vi.fn(async(input:string|URL|Request)=>{
  const url=new URL(String(input));
  if(url.pathname==='/v2/places'){
   expect(url.searchParams.get('filter')).toBe('place:london-boundary');
   return new Response(JSON.stringify({features:[{properties:{...raw,city:'Westminster',street:'Main Street',housenumber:'12',formatted:'Example Cafe, 12 Main Street, London',rank:null,categories:['catering.cafe']}}]}));
  }
  return new Response(JSON.stringify({results:[city]}));
 });
 const [plan]=await planAll([candidate],'Restaurant',new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock}));
 expect(plan.best?.resolved.providerPlaceId).toBe('venue');
 expect(plan.best?.resolved.category).toBe('catering.cafe');
 for(const number of ['12','14']){
  const [addressed]=await planAll([{...candidate,address:`${number} Main Street, London`}],'Restaurant',new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock}));
  if(number==='12')expect(addressed.best).toMatchObject({resolved:{providerPlaceId:'venue'},scored:{precision:'EXACT'}});
  else expect(addressed.best).toMatchObject({resolved:{providerPlaceId:'london-boundary',providerResultType:'city'},
   scored:{precision:'APPROXIMATE',contextualArea:{level:'city',sourceName:'Example Cafe'},reasons:expect.arrayContaining(['contextual_venue_area'])}});
  // The mismatched numbered venue never becomes an exact or probable point.
  if(number==='14')expect(addressed.best?.resolved.houseNumber).toBeNull();
 }
 expect(plan.best?.resolved.providerLocalityBoundary).toEqual({placeId:'london-boundary',name:'London'});
 const wrongCountry=vi.fn(async()=>new Response(JSON.stringify({results:[{...city,country:'Canada',country_code:'ca'}]})));
 const [wrong]=await planAll([candidate],'Restaurant',new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:wrongCountry}));
 expect(wrong.best).toBeNull();
 expect(wrongCountry.mock.calls.length).toBeLessThanOrEqual(5); // One final neutral city lookup is allowed.
});


it('never converts a known populated area without bounds to a precise POI or a directional street to an alias',()=>{
 const c:PlaceCandidate={...candidate,name:'Example Island',city:null,country:'Greece',category:'voyage'};
 const island={...venue,providerName:'Example Island',displayName:'Example Island',country:'Greece',countryCode:'GR',category:'populated_place',providerRank:.8};
 expect(decidePlaceResolution({candidate:c,resolved:island}).precision).toBe('UNKNOWN');
 expect(decidePlaceResolution({candidate:{...candidate,category:'divers'},resolved:{...venue,providerName:'London',category:'populated_place',providerResultType:'city'}}).precision).toBe('UNKNOWN');
 for(const suffix of ['West','North East','Nord-Est','Extension'])expect(decidePlaceResolution({candidate:{...candidate,address:'12 Main Street, London'},resolved:{...venue,street:'Main Street - '+suffix,houseNumber:'12'}}).precision).toBe('UNKNOWN');
});


it('keeps an explicit region when verifying the city boundary, including POIs without a provider state',async()=>{
 const fetchMock=vi.fn(async(input:string|URL|Request)=>{
  const url=new URL(String(input));
  if(url.pathname==='/v2/places')return new Response(JSON.stringify({features:[{properties:{...raw,city:'Springfield',country:'United States',country_code:'us',state:null,rank:null}}]}));
  return new Response(JSON.stringify({results:[{...raw,place_id:'wrong-city',name:'Springfield',city:'Springfield',country:'United States',country_code:'us',state:'Massachusetts',result_type:'city'}]}));
 });
 const [plan]=await planAll([{...candidate,city:'Springfield',region:'Illinois',country:'United States'}],'Restaurant',new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:fetchMock}));
 expect(plan.best).toBeNull();
 expect(fetchMock.mock.calls.every(([url])=>!String(url).includes('/v2/places'))).toBe(true);
});

it('binds literal city evidence only to a bounded provider city alias and preserves the source',async()=>{
 const source:PlaceCandidate={...candidate,name:'Sample Bakery',city:'Novara Example',address:'Novare Exemple',country:'Italy',evidence:[{type:'CAPTION',excerpt:'Sample Bakery à Novare Exemple'}]};
 const original=structuredClone(source);
 const area:ResolvedPlaceCandidate={...venue,providerPlaceId:'synthetic-city',providerName:'Novara Example',providerNameAliases:['Novare Exemple'],displayName:'Novara Example',city:'Novara Example',country:'Italy',countryCode:'IT',providerResultType:'city',providerBounds:{lon1:12,lon2:12.1,lat1:45,lat2:45.1},latitude:45.05,longitude:12.05};
 const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[area]});
 expect(plan.best?.scored.contextualArea?.level).toBe('city');
 expect(plan.candidate).toEqual(original);
 expect(source).toEqual(original);
 for(const invalid of [{...area,providerResultType:'amenity'},{...area,providerBounds:null},{...area,country:'France',countryCode:'FR'},{...area,city:'Other Municipality'},{...area,providerNameAliases:['Nearby Example']}]){
  const [rejected]=await planAll([source],'Restaurant',{resolve:async()=>[invalid]});
  expect(rejected.best).toBeNull();
 }
});

it('retrieves one neutral city anchor before binding an otherwise ungrounded locality translation',async()=>{
 const source:PlaceCandidate={...candidate,name:'Sample Bakery',city:'Novara Example',address:'Novare Exemple',country:'Italy',evidence:[{type:'CAPTION',excerpt:'Sample Bakery à Novare Exemple'}]};
 const calls:URL[]=[];
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://example.test',fetchImpl:async(input)=>{
  const url=new URL(String(input));calls.push(url);
  const neutral=!url.searchParams.has('name')&&!url.searchParams.has('street')&&!url.searchParams.get('text')?.includes('Sample Bakery');
  return new Response(JSON.stringify({features:[],results:neutral?[{...raw,place_id:'synthetic-city',name:'Novara Example',city:'Novara Example',country:'Italy',country_code:'it',lat:45.05,lon:12.05,result_type:'city',bbox:{lon1:12,lon2:12.1,lat1:45,lat2:45.1},other_names:{'name:fr':'Novare Exemple'}}]:[]}));
 }});
 const anchors=await resolver.resolveApproximate({candidate:source,sourceTheme:'Restaurant'});
 expect(anchors.some(anchor=>anchor.providerPlaceId==='synthetic-city')).toBe(true);
 expect(calls.filter(url=>!url.searchParams.has('name')&&!url.searchParams.has('street')&&!url.searchParams.get('text')?.includes('Sample Bakery')).length).toBe(1);
 calls.length=0;
 expect(await resolver.resolveApproximate({candidate:{...source,inferredFields:['city']},sourceTheme:'Restaurant'})).toEqual([]);
 expect(calls).toHaveLength(0);
});

it('keeps the verified building envelope when a city alias also occurs beside an already grounded city',()=>{
 const source:PlaceCandidate={...candidate,name:'Sample Bakery',city:'Novara Example',address:'12 Example Street, Unit 4',country:'Italy',evidence:[{type:'CAPTION',excerpt:'Sample Bakery, 12 Example Street, Unit 4 in Novara Example (Novare Exemple)'}]};
 const building:ResolvedPlaceCandidate={...venue,providerPlaceId:'synthetic-building',providerName:null,displayName:'12 Example Street',address:'12 Example Street, Novara Example, Italy',street:'Example Street',houseNumber:'12',city:'Novara Example',country:'Italy',countryCode:'IT',providerResultType:'building',providerStreetConfidence:1,providerBuildingConfidence:1};
 const city:ResolvedPlaceCandidate={...building,providerPlaceId:'synthetic-city',providerName:'Novara Example',providerNameAliases:['Novare Exemple'],address:'Novara Example, Italy',street:null,houseNumber:null,providerResultType:'city',providerBounds:{lon1:-.2,lon2:0,lat1:51.4,lat2:51.6}};
 for(const results of [[building],[building,city]]){
  const selected=selectContextualVenueArea(source,results);
  expect(selected?.scored.contextualArea?.level).toBe('building');
  expect(selected?.scored.contextualArea?.missingDetails).toContain('unit');
 }
});
