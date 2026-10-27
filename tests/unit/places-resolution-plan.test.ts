// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {planAll} from '@/server/places/analysis';
import {decidePlaceResolution} from '@/lib/places/resolution';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

describe('independently researched business addresses',()=>{
  const candidate:PlaceCandidate={name:'Example Bakery',address:null,city:'Paris',region:null,country:'France',
    category:'patisserie',confidence:.6,evidence:[{type:'CAPTION',excerpt:'Example Bakery in Paris'}]};
  const building:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'geo-building',displayName:'12 Example Road, Paris, France',providerName:null,
    address:'12 Example Road, Paris, France',street:'Example Road',houseNumber:'12',postalCode:'75001',city:'Paris',region:null,country:'France',countryCode:'FR',
    latitude:48.85,longitude:2.35,providerResultType:'building',providerRank:1,providerMatchType:'full_match',category:'building',attribution:null,
    webResearch:{name:'Example Bakery',streetAddress:'12 Example Road',city:'Paris',country:'France',postalCode:'75001',
      sources:[{url:'https://bakery.example/locations',excerpt:'Example Bakery, 12 Example Road, Paris 75001, France'},
        {url:'https://city.example/bakeries',excerpt:'Example Bakery, 12 Example Road, Paris 75001, France'}],researchedAt:'2026-10-20T12:00:00.000Z'}};

  it('verifies the independently supported building without rewriting Instagram evidence or provider identity',async()=>{
    const original=structuredClone(candidate),provider=structuredClone(building);
    const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[building]});
    expect(plan.best?.scored).toMatchObject({precision:'EXACT',reasons:expect.arrayContaining(['verified_web_address'])});
    expect(plan.best?.scored.reasons).not.toContain('verified_street_address');
    expect(plan.candidate).toEqual(original);
    expect(candidate).toEqual(original);expect(plan.best?.resolved).toEqual(provider);expect(building).toEqual(provider);
  });

  it.each(['research_name','research_city','research_country','postcode','missing_postcode','provider_city','provider_country',
    'street','number','occupant','source_address','source_region','unsupported_type','zero_confidence','unverified_unit'] as const)(
    'rejects contradictory or unsupported researched addresses: %s',scenario=>{
      const source={...candidate,...(scenario==='source_address'?{address:'14 Other Road'}:{}),
        ...(scenario==='source_region'?{region:'Bretagne'}:{})};
      const researched={...building,webResearch:{...building.webResearch!,
        ...(scenario==='research_name'?{name:'Different Bakery'}:{}),...(scenario==='research_city'?{city:'Lyon'}:{}),
        ...(scenario==='research_country'?{country:'Germany'}:{}),...(scenario==='unverified_unit'?{streetAddress:'12 Example Road, Unit C'}:{})},
        ...(scenario==='postcode'?{postalCode:'69001'}:{}),...(scenario==='missing_postcode'?{postalCode:null}:{}),
        ...(scenario==='provider_city'?{city:'Lyon'}:{}),...(scenario==='provider_country'?{country:'Germany',countryCode:'DE'}:{}),
        ...(scenario==='street'?{street:'Other Road',address:'12 Other Road, Paris, France'}:{}),
        ...(scenario==='number'?{houseNumber:'14',address:'14 Example Road, Paris, France'}:{}),
        ...(scenario==='occupant'?{providerName:'Other Tenant'}:{}),...(scenario==='unsupported_type'?{providerResultType:'street'}:{}),
        ...(scenario==='zero_confidence'?{providerRank:0}:{})};
      expect(decidePlaceResolution({candidate:source,resolved:researched}).precision).toBe('UNKNOWN');
    });

  it('keeps researched branches ambiguous when the original source cannot choose a site',async()=>{
    const other={...building,providerPlaceId:'geo-other-building',houseNumber:'14',address:'14 Example Road, Paris, France',
      latitude:48.88,webResearch:{...building.webResearch!,streetAddress:'14 Example Road'}};
    const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[building,other]});
    expect(plan.best).toBeNull();expect(plan.reasons).toContain('ambiguous_branches');expect(plan.branches).toBeUndefined();
  });

  it('compares written and numeric US street ordinals without changing the researched address',()=>{
    const source={...candidate,city:'New York',country:'United States'};
    for(const [web,geo] of [['Second Avenue','2nd Avenue'],['2nd Avenue','Second Avenue']]){
      const resolved={...building,country:'United States',countryCode:'US',city:'New York',street:geo,houseNumber:'1414',
        address:`1414 ${geo}, New York, NY 10021`,postalCode:'10021',webResearch:{...building.webResearch!,
          streetAddress:`1414 ${web}`,city:'New York',country:'United States',postalCode:'10021'}};
      const original=structuredClone(resolved);
      expect(decidePlaceResolution({candidate:source,resolved}).precision).toBe('EXACT');
      expect(decidePlaceResolution({candidate:source,resolved:{...resolved,street:'Third Avenue',
        address:'1414 Third Avenue, New York, NY 10021'}}).precision).toBe('UNKNOWN');
      expect(resolved).toEqual(original);
    }
  });

  it.each(['handle_occupant','unverified_provider_name','zero_building_confidence','zero_street_confidence'] as const)(
    'does not let an address mask missing provider verification: %s',scenario=>{
      const source={...candidate,...(scenario==='handle_occupant'?{name:'@examplebakery'}:{})};
      const result={...building,...(scenario==='handle_occupant'?{providerName:'Different Tenant'}:{}),
        ...(scenario==='unverified_provider_name'?{providerName:undefined,displayName:'Different Tenant, 12 Example Road, Paris'}:{}),
        ...(scenario==='zero_building_confidence'?{providerBuildingConfidence:0}:{}),
        ...(scenario==='zero_street_confidence'?{providerStreetConfidence:0}:{})};
      expect(decidePlaceResolution({candidate:source,resolved:result}).precision).toBe('UNKNOWN');
    });
});

describe('geographic identity selection',()=>{
  const municipalCandidate:PlaceCandidate={name:'Example Bakery',city:'Shanghai',region:'Jing’An',country:'China',address:'12 Example Road',
    category:'patisserie',confidence:.8,evidence:[{type:'CAPTION',excerpt:'Example Bakery, 12 Example Road, Jing’An, Shanghai'}]};
  const municipalVenue:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'example-shanghai',displayName:'Example Bakery',providerName:'Example Bakery',
    city:"Jing'an District",region:'Shanghai',country:'China',countryCode:'CN',address:"12 Example Road, Jing'an District, Shanghai, China",
    street:'Example Road',houseNumber:'12',localityNames:["Jing'an District",'Shanghai'],
    administrativeLabels:{city:"Jing'an District",state:'Shanghai',district:"Jing'an District"},
    latitude:31.2,longitude:121.4,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};

  it.each([
    {label:'matching district spelling',region:'Jing’An',district:"Jing'an District",accepted:true},
    {label:'matching district suffix',region:"Jing'an District",district:'Jing’An',accepted:true},
    {label:'different district',region:'Huangpu District',district:"Jing'an District",accepted:false},
    {label:'different administrative level',region:'Jingan District',district:'Jingan Subdistrict',accepted:false},
    {label:'district only in the street',region:'Huangpu District',district:null,accepted:false},
  ])('requires structured corroboration for an explicit district: $label',async({label,region,district,accepted})=>{
    const source={...municipalCandidate,region};
    const venue={...municipalVenue,city:'Shanghai',localityNames:['Shanghai'],
      administrativeLabels:{city:'Shanghai',state:'Shanghai',...(district?{district}:{})},
      ...(label==='district only in the street'?{address:'12 Example Road, Huangpu District Road, Shanghai, China'}:{})};
    const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best?.scored.precision??'UNKNOWN').toBe(accepted?'EXACT':'UNKNOWN');
    if(!accepted)expect(plan.reasons).toContain('region_not_corroborated');
    expect(venue.region).toBe('Shanghai');
  });

  it('keeps a missing explicit district unresolved even when the provider omits its state',async()=>{
    const venue={...municipalVenue,city:'Shanghai',region:null,localityNames:['Shanghai'],administrativeLabels:undefined};
    const [plan]=await planAll([municipalCandidate],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best).toBeNull();expect(plan.reasons).toContain('region_not_corroborated');
  });

  it('does not corroborate an explicit district with a bare state or city of the same name',async()=>{
    const source={...municipalCandidate,city:'New York',region:'New York District',country:'United States'};
    const venue={...municipalVenue,city:'New York',region:'New York',country:'United States',countryCode:'US',localityNames:['New York'],
      administrativeLabels:{city:'New York',state:'New York'},address:'12 Example Road, New York, United States'};
    const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best).toBeNull();expect(plan.reasons).toContain('region_not_corroborated');
  });

  it.each(['different_occupant','missing_name','unverified_unit','wrong_unit','wrong_country','zero_confidence'] as const)('does not let administrative agreement bypass %s',async scenario=>{
    const source={...municipalCandidate,...(['unverified_unit','wrong_unit'].includes(scenario)?{address:'12 Example Road, Unit 2',region:'Shanghai'}:{})};
    const venue={...municipalVenue,
      ...(scenario==='different_occupant'?{providerName:'Different Tenant'}:{}),
      ...(scenario==='missing_name'?{providerName:null,displayName:'12 Example Road',providerResultType:'building',providerRank:.13,providerBuildingConfidence:0}:{}),
      ...(scenario==='wrong_unit'?{address:'12 Example Road, Unit 3, Shanghai, China'}:{}),
      ...(scenario==='wrong_country'?{country:'Japan',countryCode:'JP'}:{}),
      ...(scenario==='zero_confidence'?{providerRank:0,providerStreetConfidence:0,providerBuildingConfidence:0}:{}),
    };
    const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best).toBeNull();
  });

  it('retains a provider-verified unit without changing canonical administrative labels',async()=>{
    const source={...municipalCandidate,address:'12 Example Road, Unit 2'};
    const venue={...municipalVenue,address:'12 Example Road, Unit 2, Shanghai, China'};
    const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best?.scored.precision).toBe('EXACT');
    expect(plan.best?.resolved).toEqual(venue);
  });

  it.each([
    {label:'street wording',street:'Flat Rock Road',source:'12 Flat Rock Road',provider:'12 Flat Rock Road, Shanghai',accepted:true},
    {label:'complete unit identifier',street:'Example Road',source:'12 Example Road, Unit 2 B',provider:'12 Example Road, Unit 2, Shanghai',accepted:false},
    {label:'business wording',street:'Example Road',source:'12 Example Road, Unit 2',provider:'Unit 2 Cafe, 12 Example Road, Shanghai',accepted:false},
    {label:'source business wording',street:'Example Road',source:'Unit 2 Cafe, 12 Example Road',provider:'12 Example Road, Shanghai',accepted:true},
    {label:'leading letter unit',street:'Example Road',source:'Unit C, 12 Example Road',provider:'12 Example Road, Unit C, Shanghai',accepted:true},
    {label:'missing leading letter unit',street:'Example Road',source:'Unit C, 12 Example Road',provider:'12 Example Road, Shanghai',accepted:false},
    {label:'missing alphanumeric unit',street:'Example Road',source:'12 Example Road, Unit A12',provider:'12 Example Road, Shanghai',accepted:false},
    {label:'missing fraction unit',street:'Example Road',source:'12 Example Road, Unit 2/3',provider:'12 Example Road, Shanghai',accepted:false},
    {label:'missing suite range',street:'Example Road',source:'12 Example Road, Suite 100-102',provider:'12 Example Road, Shanghai',accepted:false},
    {label:'semicolon separated unit',street:'Example Road',source:'12 Example Road, Shanghai; Unit C',provider:'12 Example Road, Shanghai; Unit C',accepted:true},
  ])('uses whole unit components without confusing $label',async({street,source,provider,accepted})=>{
    const candidate={...municipalCandidate,address:source};
    const venue={...municipalVenue,street,address:provider};
    const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best?.scored.precision??'UNKNOWN').toBe(accepted?'EXACT':'UNKNOWN');
  });

  it('infers absent country from a matching venue and city without a model confidence threshold',async()=>{
    const candidate:PlaceCandidate={name:'Example Café',city:'Paris',region:null,country:null,address:null,
      category:'cafe',confidence:.3,evidence:[{type:'CAPTION',excerpt:'Example Café Paris'}]};
    const venue:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'example',displayName:'Example Café',providerName:'Example Café',
      city:'Paris',region:null,country:'France',countryCode:'FR',address:'12 Rue Example, Paris',latitude:48.85,longitude:2.35,
      providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};
    const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[venue]});
    expect(plan.best?.scored.precision).toBe('PROBABLE');
    expect(plan.best?.scored.reasons).toContain('inferred_country_from_resolved_identity');
    for(const conflicting of [{...venue,city:'Lyon'},{...venue,providerName:'Different Tenant'},
      {...venue,providerResultType:'street'},{...venue,providerRank:0}]){
      expect((await planAll([candidate],'Restaurant',{resolve:async()=>[conflicting]}))[0].best).toBeNull();
    }
    const explicit={...candidate,country:'France',region:'Île-de-France',address:'12 Rue Example, Paris'};
    for(const conflicting of [{...venue,region:'Auvergne'},{...venue,address:'12 Rue Different, Paris'}]){
      expect((await planAll([explicit],'Restaurant',{resolve:async()=>[conflicting]}))[0].best).toBeNull();
    }
    expect((await planAll([{...candidate,address:'12345 Main Street'}],'Restaurant',
      {resolve:async()=>[{...venue,address:'54321 Main Street, Paris'}]}))[0].best).toBeNull();
  });
  it('leaves geographically distinct branches unresolved without address evidence, while accepting duplicate entrances',async()=>{
    const candidate:PlaceCandidate={name:'Example Café',city:'Paris',region:null,country:'France',address:null,
      category:'cafe',confidence:.9,evidence:[{type:'CAPTION',excerpt:'Example Café in Paris'}]};
    const venue:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'branch-a',displayName:'Example Café',providerName:'Example Café',
      city:'Paris',region:null,country:'France',countryCode:'FR',address:'12 Rue Example, Paris',latitude:48.85,longitude:2.35,
      providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:null};
    for(const [offset,ambiguous] of [[.02,true],[.0001,false]] as const){
      const results=[venue,{...venue,providerPlaceId:'branch-b',latitude:venue.latitude+offset}];
      for(const ordered of [results,[...results].reverse()]){
        const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>ordered});
        if(ambiguous)expect(plan.best).toBeNull();
        else expect(plan.best?.resolved.providerPlaceId).toBe('branch-a');
      }
    }
    const area:ResolvedPlaceCandidate={...venue,providerPlaceId:'paris-area',displayName:'Paris',providerName:'Paris',
      address:'Paris, France',providerResultType:'city',providerRank:.25,providerMatchType:'match_by_city_or_disrict'};
    const areaPlans=await planAll([candidate,{...candidate,name:'Example Pastry',category:'patisserie'},{...candidate,name:'Paris'}],
      'Restaurant',{resolve:async()=>[area]});
    expect(areaPlans.map(plan=>plan.best)).toEqual([null,null,null]);
    const [located]=await planAll([{...candidate,address:'12 Rue Example, Paris'}],'Restaurant',{resolve:async()=>[venue]});
    expect(located.best?.resolved.providerPlaceId).toBe('branch-a');
    const unknown={...candidate,name:null,city:null,country:null};
    const resolve=vi.fn(async()=>[venue]);
    const mixed=await planAll([unknown,{...candidate,address:'12 Rue Example, Paris'}],'Restaurant',{resolve});
    expect(mixed[0].best).toBeNull();
    expect(mixed[1].best?.resolved.providerPlaceId).toBe('branch-a');
    expect(resolve).toHaveBeenCalledTimes(1);
    const [ambiguousAddress]=await planAll([{...candidate,address:'Rue Example, Paris'}],'Restaurant',
      {resolve:async()=>[venue,{...venue,providerPlaceId:'branch-b',latitude:48.87}]});
    expect(ambiguousAddress.best).toBeNull();
  });
});


describe('source-grounded approximate venue areas',()=>{
 const candidate:PlaceCandidate={name:'Example Bakery',address:'Unit C, 12 Example Road',city:'Paris',region:null,country:'France',category:'patisserie',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:'Example Bakery, Unit C, 12 Example Road, Paris'}]};
 const building:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'source-building',displayName:'12 Example Road, Paris',providerName:null,
  address:'12 Example Road, Paris',street:'Example Road',houseNumber:'12',city:'Paris',region:null,country:'France',countryCode:'FR',
  latitude:48.85,longitude:2.35,providerResultType:'building',providerRank:1,providerMatchType:'full_match',category:'building',attribution:null};
 const city:ResolvedPlaceCandidate={...building,providerPlaceId:'paris-area',displayName:'Paris',providerName:'Paris',address:'Paris, France',street:null,houseNumber:null,
  providerResultType:'city',category:'populated_place',providerBounds:{lon1:2.22,lat1:48.81,lon2:2.42,lat2:48.90}};
 it('uses a verified building envelope for an unverified unit while retaining source and provider identities',async()=>{
  const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[building]});
  expect(plan.candidate).toEqual(candidate);expect(plan.best?.resolved).toEqual(building);
  expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',approximationRadiusMeters:100,
   contextualArea:{level:'building',sourceName:'Example Bakery',missingDetails:expect.arrayContaining(['unit'])},
   reasons:expect.arrayContaining(['contextual_venue_area','contextual_area_building','provider-context-v11'])});
 });
 it('uses a bounded source city after precise retrieval, without substituting another named occupant',async()=>{
  const events:string[]=[];const resolve=async()=>{events.push('precise');return [{...building,providerName:'Other Tenant',providerResultType:'amenity'}];};
  const resolveApproximate=async()=>{events.push('area');return [city];};
  const [plan]=await planAll([candidate],'Restaurant',{resolve,resolveApproximate});
  expect(events).toEqual(['precise','area']);expect(plan.best?.resolved).toEqual(city);
  expect(plan.best?.scored.contextualArea?.level).toBe('city');
  expect(plan.best?.scored.approximationRadiusMeters).toBeGreaterThan(10_000);
  const exact={...candidate,address:'12 Example Road'};events.length=0;
  const [precise]=await planAll([exact],'Restaurant',{resolve:async()=>[building],resolveApproximate});
  expect(precise.best?.scored.precision).toBe('EXACT');expect(events).toEqual([]);
 });
 it.each(['wrong_country','wrong_city','wrong_street','wrong_number','wrong_unit','wrong_district','named_occupant','unsupported_identity','inferred_city','missing_bounds','degenerate_bounds','wrong_area_identity','wrong_floor','no_city'] as const)('rejects an unsupported approximation: %s',async scenario=>{
  const source={...candidate,...(scenario==='unsupported_identity'?{name:'Invented Bakery'}:{}),
   ...(scenario==='inferred_city'?{inferredFields:['city' as const]}:{}),...(scenario==='no_city'?{city:null}:{}),...(scenario==='wrong_district'?{region:'North District'}:{}),...(scenario==='wrong_floor'?{address:'12 Example Road, Floor 2',evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery, 12 Example Road, Floor 2, Paris'}]}:{})};
  const anchor={...building,...(scenario==='wrong_country'?{country:'Germany',countryCode:'DE'}:{}),
   ...(scenario==='wrong_city'?{city:'Lyon'}:{}),...(scenario==='wrong_street'?{street:'Another Road',address:'12 Another Road, Paris'}:{}),
   ...(scenario==='wrong_number'?{houseNumber:'14',address:'14 Example Road, Paris'}:{}),
   ...(scenario==='wrong_unit'?{address:'Unit D, 12 Example Road, Paris'}:{}),
   ...(scenario==='wrong_district'?{administrativeLabels:{district:'South District'}}:{}),
   ...(scenario==='named_occupant'?{providerName:'Another Bakery'}:{}),...(scenario==='missing_bounds'?{...city,providerBounds:null}:{}),
   ...(scenario==='degenerate_bounds'?{...city,providerBounds:{lon1:2.35,lon2:2.35,lat1:48.85,lat2:48.85}}:{}),
   ...(scenario==='wrong_area_identity'?{...city,providerName:'North District'}:{}),
   ...(scenario==='wrong_floor'?{address:'12 Example Road, Floor 3, Paris'}:{})};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[anchor]});expect(plan.best).toBeNull();
 });
 it.each([
  ['Paris Baguette','Paris Baguette bakery is amazing',false],
  ['Paris Baguette','Paris Baguette à Paris',true],
  ['Example Bakery','Example Bakery @paris #Paris',false],
  ['Invented Bakery (Paris)','The best bakeries in Paris, France',false],
 ])('requires city and venue identity to be independently evidenced: %s / %s',async(name,excerpt,accepted)=>{
  const source={...candidate,name,address:null,country:null,evidence:[{type:'CAPTION' as const,excerpt}]};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[city]});
  expect(Boolean(plan.best)).toBe(accepted);
 });
 it('uses a verified source district even when the provider labels the district as city',async()=>{
  const source={...candidate,address:'12 Example Road, Huangpu District, Shanghai',city:'Shanghai',country:'China',
   evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery, 12 Example Road, Huangpu District, Shanghai'}]};
  const district={...city,providerPlaceId:'huangpu',providerName:'Huangpu District',displayName:'Huangpu District',city:'Huangpu District',region:'Shanghai',
   country:'China',countryCode:'CN',localityNames:['Huangpu District','Shanghai'],administrativeLabels:{city:'Huangpu District',state:'Shanghai'},
   address:'Huangpu District, Shanghai, China',latitude:31.2,longitude:121.5,providerBounds:{lon1:121.45,lon2:121.55,lat1:31.15,lat2:31.25}};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[district]});
  expect(plan.best?.resolved).toEqual(district);expect(plan.best?.scored.contextualArea?.level).toBe('district');
  for(const other of [{...district,providerName:'Other District',city:'Other District',administrativeLabels:{city:'Other District',state:'Shanghai'}},
   {...district,localityNames:['Huangpu District'],region:'Elsewhere',administrativeLabels:{city:'Huangpu District',state:'Elsewhere'}}]){
   expect((await planAll([source],'Restaurant',{resolve:async()=>[other]}))[0].best).toBeNull();
  }
 });
 it('does not let a translated Chinese city label verify a foreign namesake when country is missing',async()=>{
  const source={...candidate,address:null,city:'Shanghai',country:null,evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery in 上海市'}]};
  const foreign={...city,displayName:'Shanghai',providerName:'Shanghai',city:'Shanghai',country:'United States',countryCode:'US'};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[foreign]});expect(plan.best).toBeNull();
 });
 it('does not use a homonymous city in a contradictory explicit state',async()=>{
  const source={...candidate,address:null,city:'Springfield',region:'Illinois',country:'United States',
   evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery in Springfield, Illinois'}]};
  const wrong={...city,displayName:'Springfield',providerName:'Springfield',city:'Springfield',region:'Massachusetts',country:'United States',countryCode:'US',
   address:'Springfield, Massachusetts, United States',latitude:42.1,longitude:-72.6,providerBounds:{lon1:-72.7,lon2:-72.5,lat1:42,lat2:42.2}};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[wrong]});expect(plan.best).toBeNull();
 });
 it('does not borrow another recommendation’s district from a shared caption',async()=>{
  const source={...candidate,evidence:[{type:'CAPTION' as const,excerpt:'Example Bakery, Unit C, 12 Example Road, Paris. Other Bakery is in North District.'}]};
  const district={...city,providerPlaceId:'north-district',providerName:'North District',providerResultType:'district',administrativeLabels:{district:'North District'}};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[district]});expect(plan.best).toBeNull();
 });
 it('refines an already returned city with a neutral address lookup before choosing the envelope',async()=>{
  const resolveApproximate=vi.fn(async()=>[building]);
  const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[city],resolveApproximate});
  expect(resolveApproximate).toHaveBeenCalledTimes(1);expect(plan.best?.resolved).toEqual(building);
 });
 it('places an ambiguous chain within its verified city without selecting an arbitrary branch',async()=>{
  const source={...candidate,address:null};const poi={...building,providerName:'Example Bakery',providerResultType:'amenity'};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[poi,{...poi,providerPlaceId:'second-branch',latitude:48.88}],resolveApproximate:async()=>[city]});
  expect(plan.best?.resolved).toEqual(city);expect(plan.best?.scored.precision).toBe('APPROXIMATE');
 });
 it('keeps only a literally evidenced bilingual name component and can infer a missing country from a verified city',async()=>{
  const source={...candidate,name:'Example Bakery 未证实名',country:null,address:null};
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[city]});
  expect(plan.best?.scored.contextualArea?.sourceName).toBe('Example Bakery');expect(plan.candidate.name).toBe(source.name);
  expect(plan.best?.scored.reasons).toContain('inferred_country_from_verified_area');
 });
});


it('does not truncate an area whose bounds cross the date line',async()=>{
 const source:PlaceCandidate={name:'Island Cafe',city:'Example Island',country:'Fiji',region:null,address:null,category:'cafe',confidence:.8,
  evidence:[{type:'CAPTION',excerpt:'Island Cafe in Example Island'}]};
 const area:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'island',displayName:'Example Island',providerName:'Example Island',address:'Example Island',
  city:'Example Island',region:null,country:'Fiji',countryCode:'FJ',latitude:-17,longitude:179.9,providerResultType:'city',providerRank:1,providerMatchType:'full_match',
  category:'populated_place',attribution:null,providerBounds:{lon1:179.8,lat1:-17.1,lon2:-179.8,lat2:-16.9}};
 const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[area]});
 expect(plan.best?.scored.approximationRadiusMeters).toBeGreaterThan(40_000);
 expect(plan.best?.scored.approximationRadiusMeters).toBeLessThan(50_000);
 const [outside]=await planAll([source],'Restaurant',{resolve:async()=>[{...area,longitude:178}]});expect(outside.best).toBeNull();
});

describe('Japanese municipality and interior context',()=>{
 const candidate:PlaceCandidate={name:'Example Bakery',city:'Shibuya City',region:'Tokyo',country:'Japan',address:'1F 12-3 Examplecho, Shibuya City, Tokyo',
  category:'patisserie',confidence:.8,evidence:[{type:'CAPTION',excerpt:'Example Bakery, 1F 12-3 Examplecho, Shibuya City, Tokyo'}]};
 const area:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'example-neighbourhood',providerName:'Examplechō',displayName:'Examplechō',
  city:'Shibuya',region:null,country:'Japan',countryCode:'JP',address:'Examplechō, Shibuya, Japan',administrativeLabels:{city:'Shibuya',district:'Examplechō'},
  latitude:35.66,longitude:139.70,providerResultType:'suburb',providerRank:1,providerMatchType:'full_match',category:null,attribution:null,
  providerBounds:{lon1:139.69,lat1:35.65,lon2:139.71,lat2:35.67}};
 it.each(['Shibuya City','Shibuya-shi','Shibuya'])('accepts a verified source-address district under the same Japanese municipality: %s',async city=>{
  const source={...candidate,city,address:`1F 12-3 Examplecho, ${city}, Tokyo`,evidence:[{type:'CAPTION' as const,excerpt:`Example Bakery, 1F 12-3 Examplecho, ${city}, Tokyo`}]};
  const saved=structuredClone(area);
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[area]});
  expect(plan.best?.scored.contextualArea?.level).toBe('district');
  expect(plan.best?.resolved).toEqual(saved);expect(plan.candidate).toEqual(source);
 });
 it('does not use another municipality, prefecture, country or caption-only district as an anchor',async()=>{
  for(const resolved of [{...area,city:'Toshima',administrativeLabels:{city:'Toshima',district:'Examplechō'}},
   {...area,region:'Miyagi Prefecture'},{...area,country:'France',countryCode:'FR'},
   {...area,providerName:'Othercho',administrativeLabels:{city:'Shibuya',district:'Othercho'}},
   {...area,providerRank:.71875}]){
   const [plan]=await planAll([{...candidate,evidence:[...candidate.evidence,{type:'CAPTION',excerpt:'Another bakery in Othercho, Shibuya City'}]}],'Restaurant',{resolve:async()=>[resolved]});
   expect(plan.best).toBeNull();
  }
  const [parent]=await planAll([candidate],'Restaurant',{resolve:async()=>[{...area,providerName:'Tokyo',city:'Tokyo',providerResultType:'city'}]});
  expect(parent.best).toBeNull();
  for(const suffix of ['Road','Plaza']){
   const source={...candidate,address:`1F 12-3 Examplecho ${suffix}, Shibuya City, Tokyo`,
    evidence:[{type:'CAPTION' as const,excerpt:`Example Bakery, 1F 12-3 Examplecho ${suffix}, Shibuya City, Tokyo`}]};
   expect((await planAll([source],'Restaurant',{resolve:async()=>[area]}))[0].best).toBeNull();
  }
 });
 it('keeps a Japanese floor unresolved within a verified building and rejects conflicting floors or block numbers',async()=>{
  const building={...area,providerPlaceId:'example-building',providerName:null,displayName:'12-3 Examplecho',providerResultType:'building',
   region:'Tokyo',address:'12-3 Examplecho, Shibuya, Tokyo, Japan',street:'Examplecho',houseNumber:'12-3',providerBounds:null};
  const [plan]=await planAll([candidate],'Restaurant',{resolve:async()=>[building]});
  expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',contextualArea:{level:'building',missingDetails:expect.arrayContaining(['floor'])}});
  for(const resolved of [{...building,address:'2F 12-3 Examplecho, Shibuya, Tokyo, Japan'},
   {...building,houseNumber:'12-4'},{...building,houseNumber:'1-12-3'},
   {...building,providerName:'Different Tenant'}]){
   expect((await planAll([candidate],'Restaurant',{resolve:async()=>[resolved]}))[0].best).toBeNull();
  }
 });
});

it('grounds compact source handles and restores literal caption context for approximate locations',async()=>{
 const source:PlaceCandidate={name:'Example Bakery',address:'Unit C, 12 Example Road',city:'Paris',region:null,country:'France',category:'patisserie',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:'@examplebakery'},{type:'CAPTION',excerpt:'Unit C, 12 Example Road'}]};
 const anchor:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'building-context',displayName:'12 Example Road, Paris',providerName:null,
  address:'12 Example Road, Paris',street:'Example Road',houseNumber:'12',city:'Paris',region:null,country:'France',countryCode:'FR',
  latitude:48.85,longitude:2.35,providerResultType:'building',providerRank:1,providerMatchType:'full_match',category:'building',attribution:null};
 const caption='Our autumn addresses in Paris\nA bakery to visit: @examplebakery\nUnit C, 12 Example Road';
 source.inferredFields=['city'];
 const original=structuredClone(source);
 const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[anchor]},[],{caption,structuredLocation:null});
 expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',contextualArea:{level:'building',sourceName:'Example Bakery'}});
 expect(source).toEqual(original);
 expect(plan.candidate.evidence).toEqual(expect.arrayContaining(original.evidence));
 expect(plan.candidate.evidence.filter(item=>item.type==='CAPTION').every(item=>caption.includes(item.excerpt))).toBe(true);
 for(const changed of [
  {...source,name:'Different Bakery'},
  {...source,city:'Lyon'},
  {...source,name:'Example Bakery North'},
  {...source,evidence:[{type:'CAPTION' as const,excerpt:'@examplebakery_north'}]},
 ])expect((await planAll([changed],'Restaurant',{resolve:async()=>[anchor]},[],{caption:caption.replace(/@examplebakery\b/u,changed.evidence[0].excerpt),structuredLocation:null}))[0].best).toBeNull();
});

it('keeps handle geography separate and never borrows an unrelated venue name from a shared caption',async()=>{
 const area:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'paris-zone',displayName:'Paris',providerName:'Paris',address:'Paris, France',street:null,houseNumber:null,
  city:'Paris',region:null,country:'France',countryCode:'FR',latitude:48.85,longitude:2.35,providerResultType:'city',providerRank:1,providerMatchType:'full_match',
  category:'populated_place',attribution:null,providerBounds:{lon1:2.22,lat1:48.81,lon2:2.42,lat2:48.90}};
 const source:PlaceCandidate={name:'Example Bakery',address:null,city:'Paris',region:null,country:'France',category:'patisserie',confidence:.5,
  inferredFields:['city'],evidence:[{type:'CAPTION',excerpt:'Example Bakery'}]};
 for(const caption of ['Try @examplebakery #Paris','Try @examplebakery. Follow @paris',
  'Paris ideas\nOther Bakery\n12 Example Road',
  'Example Bakery in Lyon\nOther Bakery in Paris',
  'Example Bakery in Lyon\nParis Baguette, another recommendation',
  'Our guide in Paris\n\nExample Bakery in Lyon',
  'Things to do in Paris\n1. Example Bakery à Lyon',
  '1️⃣ Example Bakery in Lyon\n📍Lyon\n2️⃣ Other Bakery\n📍Paris',
  'Example Bakery in Lyon\nOther Bakery\n📍Paris',
  'Our guide in Paris\n\nTry Example Bakery\n📍Lyon']) {
  const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[area]},[],{caption,structuredLocation:null});
  expect(plan.best).toBeNull();
  const [whole]=await planAll([{...source,evidence:[{type:'CAPTION',excerpt:caption}]}],'Restaurant',{resolve:async()=>[area]},[],{caption,structuredLocation:null});
  expect(whole.best).toBeNull();
 }
});

it.each(['@examplebakerynorth','@example_bakery_north','@example.bakery.north'])('never grounds a shorter venue from a suffixed handle: %s',async handle=>{
 const source:PlaceCandidate={name:'Example Bakery',address:null,city:'Paris',country:'France',region:null,category:'patisserie',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:handle},{type:'CAPTION',excerpt:'Paris'}]};
 const {canApproximateVenue}=await import('@/lib/places/approximate-resolution');
 expect(canApproximateVenue(source)).toBe(false);
});

it('uses a literally named neighborhood as a verified bounded zone without inventing a street address',async()=>{
 const source:PlaceCandidate={name:'Example Bakery',address:'North Quarter',city:'Paris',region:null,country:'France',category:'patisserie',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:'Example Bakery, North Quarter, Paris'}]};
 const area:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'quarter-context',displayName:'North Quarter, Paris',providerName:'North Quarter',
  address:'North Quarter, Paris',city:'Paris',region:null,country:'France',countryCode:'FR',latitude:48.85,longitude:2.35,
  providerResultType:'suburb',providerRank:1,providerMatchType:'full_match',category:'populated_place',attribution:null,
  administrativeLabels:{suburb:'North Quarter'},providerBounds:{lon1:2.34,lat1:48.84,lon2:2.36,lat2:48.86}};
 const [plan]=await planAll([source],'Restaurant',{resolve:async()=>[],resolveApproximate:async()=>[area]});
 expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',contextualArea:{level:'district',sourceName:'Example Bakery'}});
 expect(plan.candidate).toEqual(source);
 for(const other of [{...area,providerName:'Other Quarter',administrativeLabels:{suburb:'Other Quarter'}},{...area,providerBounds:null},
  {...area,providerResultType:'amenity',category:'catering.restaurant',providerName:'Other Bakery'}])
  expect((await planAll([source],'Restaurant',{resolve:async()=>[],resolveApproximate:async()=>[other]}))[0].best).toBeNull();
});

it('retains an independently evidenced Belgian city alias through final area verification',async()=>{
 const source:PlaceCandidate={name:'Example Bakery',address:null,city:'Brussels',country:'Belgium',region:null,category:'patisserie',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:'Example Bakery in Bruxelles'}]};
 const area:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'brussels-area',providerName:'Brussels',displayName:'Brussels',address:'Brussels, Belgium',
  city:'Brussels',region:'Brussels-Capital',country:'Belgium',countryCode:'BE',latitude:50.85,longitude:4.35,providerResultType:'city',providerRank:1,providerMatchType:'full_match',
  category:'populated_place',attribution:null,providerBounds:{lon1:4.3,lat1:50.8,lon2:4.4,lat2:50.9}};
 expect((await planAll([source],'Restaurant',{resolve:async()=>[area]}))[0].best?.scored.precision).toBe('APPROXIMATE');
 expect((await planAll([{...source,country:null}],'Restaurant',{resolve:async()=>[{...area,country:'United States',countryCode:'US'}]}))[0].best).toBeNull();
});

it('keeps a named public square inside its verified street envelope without fabricating a house number',async()=>{
 const source:PlaceCandidate={name:'Weekend Market',address:'Place Example',city:'Paris',region:null,country:'France',category:'divers',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:'Weekend Market, Place Example, Paris'}]};
 const street:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'market-square',displayName:'Place Example, Paris',providerName:'Place Example',street:'Place Example',houseNumber:null,
  address:'Place Example, Paris',city:'Paris',region:null,country:'France',countryCode:'FR',latitude:48.85,longitude:2.35,
  providerResultType:'street',providerRank:1,providerMatchType:'full_match',category:null,attribution:null,
  providerBounds:{lon1:2.349,lat1:48.849,lon2:2.351,lat2:48.851}};
 const [plan]=await planAll([source],'Voyages',{resolve:async()=>[street]});
 expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',contextualArea:{level:'street',sourceName:'Weekend Market'}});
 expect(plan.best?.resolved.houseNumber).toBeNull();
 for(const other of [{...street,street:'Place Elsewhere',providerName:'Place Elsewhere'},{...street,providerBounds:null}])
  expect((await planAll([source],'Voyages',{resolve:async()=>[other]}))[0].best).toBeNull();
});

describe('Belgian street envelopes with literal source names',()=>{
 const source=(address:string):PlaceCandidate=>({name:'Weekend Market',address,city:'Bruxelles',region:null,country:'Belgique',category:'voyage',confidence:.5,
  evidence:[{type:'CAPTION',excerpt:`Weekend Market, ${address}, Bruxelles`}]});
 const street=(name:string):ResolvedPlaceCandidate=>({provider:'geoapify',providerPlaceId:'synthetic-street',displayName:`${name}, Bruxelles`,providerName:name,
  street:name,houseNumber:null,address:`${name}, Bruxelles`,city:'Bruxelles',region:null,country:'Belgium',countryCode:'BE',latitude:50.85,longitude:4.35,
  providerResultType:'street',providerRank:1,providerMatchType:'full_match',category:null,attribution:null,
  providerBounds:{lon1:4.349,lat1:50.849,lon2:4.351,lat2:50.851}});
 it.each([
  ['Chaussée Exemple','Chaussée Exemple'],['Allée Exemple','Allée Exemple'],
  ['Chau. Exemple','Chaussée Exemple'],['Pl. Exemple','Place Exemple'],
  ['Place Exemple','Place Exemple - Voorbeeldplein'],['Pl. Exemple','Place Exemple – Voorbeeldplein'],
  ['Rue Exemple','Rue Exemple / Voorbeeldstraat'],
  ['Chaussée Exemple','Chaussée Exemple - Voorbeeld Steenweg'],
  ['Chau. Exemple 133/135','Chaussée Exemple'],['133/135 Allée Exemple','Allée Exemple'],
 ])('verifies the complete source street %s against %s without rewriting either identity',async(address,providerName)=>{
  const candidate=source(address),resolved=street(providerName),original=structuredClone(candidate),provider=structuredClone(resolved);
  const [plan]=await planAll([candidate],'Voyages',{resolve:async()=>[resolved]});
  expect(plan.best?.scored).toMatchObject({precision:'APPROXIMATE',contextualArea:{level:'street',sourceName:'Weekend Market',missingDetails:expect.arrayContaining(['street_number'])}});
  expect(plan.best?.resolved).toEqual(provider);expect(plan.candidate).toEqual(original);
  expect(candidate).toEqual(original);expect(resolved).toEqual(provider);
 });
 it.each([
  ['prefix',{street:'Place Exemple Nord - Noordplein',providerName:'Place Exemple Nord - Noordplein'}],
  ['two French streets',{street:'Place Exemple - Place Ailleurs',providerName:'Place Exemple - Place Ailleurs'}],
  ['different street types',{street:'Place Exemple - Voorbeeldstraat',providerName:'Place Exemple - Voorbeeldstraat'}],
  ['three components',{street:'Place Exemple - Voorbeeldplein - Anderplein',providerName:'Place Exemple - Voorbeeldplein - Anderplein'}],
  ['city as alias',{street:'Place Exemple - Bruxelles',providerName:'Place Exemple - Bruxelles'}],
  ['bare street type',{street:'Place Exemple - Plein',providerName:'Place Exemple - Plein'}],
  ['occupant',{providerName:'Other Market'}],['wrong city',{city:'Leuven'}],['missing bounds',{providerBounds:null}],
  ['unranked',{providerRank:.9}],['foreign provider',{country:'France',countryCode:'FR'}],
 ] as const)('rejects an unsafe bilingual street envelope: %s',async(_scenario,overrides)=>{
  const candidate=source('Place Exemple'),resolved={...street('Place Exemple - Voorbeeldplein'),...overrides};
  expect((await planAll([candidate],'Voyages',{resolve:async()=>[resolved]}))[0].best).toBeNull();
 });
 it('does not apply Belgian abbreviations or bilingual splitting to a foreign street',async()=>{
  const candidate={...source('Pl. Exemple'),country:'France'},resolved={...street('Place Exemple - Voorbeeldplein'),country:'France',countryCode:'FR'};
  expect((await planAll([candidate],'Voyages',{resolve:async()=>[resolved]}))[0].best).toBeNull();
 });
 it('derives only one literally numbered Belgian street for a neutral retry, keeping the original branch number',async()=>{
  const {approximateStreet}=await import('@/lib/places/approximate-resolution');
  const candidate=source('Chau. Exemple 133/135, 1050 Bruxelles'),original=structuredClone(candidate);
  expect(approximateStreet(candidate)).toBe('Chau. Exemple');
  expect(candidate).toEqual(original);
  for(const changed of [
   {...candidate,evidence:[{type:'CAPTION' as const,excerpt:'Weekend Market, Chau. Exemple 133, Bruxelles'}]},
   source('Chau. Exemple 133/135, Rue Ailleurs 2'),
  ])expect(approximateStreet(changed)).toBeNull();
 });
 it('selects the same-named Belgian street whose explicit postcode matches the source',async()=>{
  const candidate=source('Rue Exemple 133/135, 1040 Bruxelles');
  const anchors=['1040','1410','1310'].map((postalCode,index)=>{
   const latitude=50.85-index*.1;
   return {...street('Rue Exemple - Voorbeeldstraat'),providerPlaceId:`street-${postalCode}`,postalCode,latitude,
    providerBounds:{lon1:4.349,lon2:4.351,lat1:latitude-.001,lat2:latitude+.001}};
  });
  const original=structuredClone(candidate),providers=structuredClone(anchors);
  const [plan]=await planAll([candidate],'Voyages',{resolve:async()=>anchors});
  expect(plan.best?.resolved.providerPlaceId).toBe('street-1040');
  expect(plan.best?.scored.contextualArea?.level).toBe('street');
  expect(candidate).toEqual(original);expect(anchors).toEqual(providers);
 });
 it.each([true,false])('rejects a Belgian street with a conflicting explicit postcode (structured: %s)',async structured=>{
  const candidate=source('Rue Exemple 133/135, 1040 Bruxelles');
  const anchor={...street('Rue Exemple - Voorbeeldstraat'),postalCode:structured?'1410':null,
   address:'Rue Exemple - Voorbeeldstraat, 1410 Bruxelles'};
  expect((await planAll([candidate],'Voyages',{resolve:async()=>[anchor]}))[0].best).toBeNull();
 });
 it('does not invent a postal contradiction when the source or provider omits the postcode',async()=>{
  for(const [candidate,anchor] of [
   [source('Rue Exemple 133/135, 1040 Bruxelles'),street('Rue Exemple - Voorbeeldstraat')],
   [source('Rue Exemple 133/135'),{...street('Rue Exemple - Voorbeeldstraat'),postalCode:'1410'}],
  ] as const)expect((await planAll([candidate],'Voyages',{resolve:async()=>[anchor]}))[0].best?.scored.contextualArea?.level).toBe('street');
 });
});
