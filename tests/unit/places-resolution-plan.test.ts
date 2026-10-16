// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {planAll} from '@/server/places/analysis';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

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
   reasons:expect.arrayContaining(['contextual_venue_area','contextual_area_building','provider-context-v6'])});
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
