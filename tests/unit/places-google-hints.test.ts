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
it('upgrades an unresolved geocoding record when the independent POI catalog corroborates the same ID',async()=>{
 const resolver=new FallbackPlaceResolver({resolve:async input=>input.proximity?[geo]:[{...geo,providerResultType:'building'}]},
  {searchHints:async()=>[{placeId:'google-id',latitude:48.85,longitude:2.35}]});
 expect(await resolver.resolve({candidate,sourceTheme:'Restaurant'})).toEqual([geo]);
});
it('retains distinct nearby-hint branches so the decision layer can reject ambiguity',async()=>{
 const other={...geo,providerPlaceId:'second-branch',latitude:48.86};
 const resolver=new FallbackPlaceResolver({resolve:async input=>!input.proximity?[{...geo,providerResultType:'building'}]:input.proximity.latitude===48.85?[geo]:[other]},
  {searchHints:async()=>[{placeId:'first-hint',latitude:48.85,longitude:2.35},{placeId:'second-hint',latitude:48.86,longitude:2.35}]});
 expect(await resolver.resolve({candidate,sourceTheme:'Restaurant'})).toEqual([geo,other]);
});


it('keeps area fallback separate until all precise hints have been attempted',async()=>{
 const calls:string[]=[];
 const resolve=async()=>{calls.push('primary');return [];};
 const resolveApproximate=async()=>{calls.push('area');return [];};
 const resolver=new FallbackPlaceResolver({resolve,resolveApproximate},{searchHints:async()=>{calls.push('google');return [];}});
 await resolver.resolve({candidate,sourceTheme:'Restaurant'});expect(calls).toEqual(['primary','google']);
 await resolver.resolveApproximate({candidate,sourceTheme:'Restaurant'});expect(calls).toEqual(['primary','google','area']);
});
