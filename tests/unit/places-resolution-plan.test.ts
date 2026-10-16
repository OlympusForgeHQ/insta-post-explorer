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
