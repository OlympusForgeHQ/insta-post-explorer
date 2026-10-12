// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {FallbackPlaceResolver} from '@/server/places/resolvers/fallback';
import type {PlaceCandidate} from '@/lib/places/candidates';
import type {PlaceResolutionInput,ResolvedPlaceCandidate} from '@/server/places/resolvers/types';
const candidate:PlaceCandidate={name:'Example Cafe',address:null,city:'Paris',country:'France',region:null,category:'cafe',confidence:.2,evidence:[]};
const geo:ResolvedPlaceCandidate={provider:'geoapify',providerPlaceId:'geo-only',displayName:'Example Cafe',providerName:'Example Cafe',address:'Geoapify Address',city:'Paris',country:'France',countryCode:'FR',region:null,latitude:48.85,longitude:2.35,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',category:null,attribution:'Powered by Geoapify'};
it('returns only independently retrieved Geoapify records after transient Google proximity hints',async()=>{
 const resolve=vi.fn(async(input:PlaceResolutionInput)=>input.proximity?[geo]:[]);
 const hints={searchHints:async()=>[{placeId:'google-id',latitude:48.8501,longitude:2.3501}]};
 const resolver=new FallbackPlaceResolver({resolve},hints);
 const [result]=await resolver.resolve({candidate,sourceTheme:'Restaurant'});
 expect(result).toEqual(geo);
 expect(resolve.mock.calls[1][0]).toMatchObject({candidate,proximity:{latitude:48.8501,longitude:2.3501}});
 expect(JSON.stringify(result)).not.toContain('google');
 expect(candidate.address).toBeNull();
});
it('keeps Google-only or distant results unresolved',async()=>{
 for(const results of [[],[{...geo,latitude:49.85}]]){
  const resolver=new FallbackPlaceResolver({resolve:async input=>input.proximity?results:[]},
   {searchHints:async()=>[{placeId:'google-id',latitude:48.85,longitude:2.35}]});
  expect(await resolver.resolve({candidate,sourceTheme:'Restaurant'})).toEqual([]);
 }
});
