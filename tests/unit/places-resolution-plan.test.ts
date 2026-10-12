// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {planAll} from '@/server/places/analysis';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

describe('geographic identity selection',()=>{
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
