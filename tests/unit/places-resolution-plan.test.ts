// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {planAll} from '@/server/places/analysis';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

describe('geographic identity selection',()=>{
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
    const [located]=await planAll([{...candidate,address:'12 Rue Example, Paris'}],'Restaurant',{resolve:async()=>[venue]});
    expect(located.best?.resolved.providerPlaceId).toBe('branch-a');
    const [ambiguousAddress]=await planAll([{...candidate,address:'Rue Example, Paris'}],'Restaurant',
      {resolve:async()=>[venue,{...venue,providerPlaceId:'branch-b',latitude:48.87}]});
    expect(ambiguousAddress.best).toBeNull();
  });
});
