import {decidePlaceResolution} from '@/lib/places/resolution';
import {distanceMeters} from '@/lib/places/distance';
import type {PlaceResolver,PlaceResolutionInput} from './types';
import type {GoogleHintSource} from './google';

export class FallbackPlaceResolver implements PlaceResolver {
  constructor(private readonly primary:PlaceResolver,private readonly secondary:GoogleHintSource){}
  async resolveApproximate(input:PlaceResolutionInput){
    return this.primary.resolveApproximate?.(input)??[];
  }
  async resolve(input:PlaceResolutionInput){
    return (await this.resolveWithHints(input)).results;
  }
  async resolveWithHints(input:PlaceResolutionInput){
    const results=await this.primary.resolve(input);
    if(results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))return {results,hints:[]};
    // Google only narrows retrieval geographically. Every returned field and
    // coordinate must be independently retrieved from the primary provider and
    // corroborated against the unchanged source candidate, never Google text.
    let hints:Awaited<ReturnType<GoogleHintSource['searchHints']>>;
    try {hints=await this.secondary.searchHints(input);}
    catch(error) {
      const message=error instanceof Error?error.message:'';
      if(message==='PLACES_LEASE_LOST')throw error;
      const code=/^GOOGLE_[A-Z0-9_]{1,64}$/u.test(message)?message:'GOOGLE_HINTS_UNAVAILABLE';
      console.warn(JSON.stringify({stage:'places_google_hints',code}));
      return {results,hints:[]};
    }
    const verified=[...results];
    for(const hint of hints){
      const nearby=await this.primary.resolve({...input,proximity:{latitude:hint.latitude,longitude:hint.longitude}});
      for(const resolved of nearby){
        if(resolved.provider==='geoapify'&&distanceMeters(hint,resolved)<=100&&
          decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'){
          const existing=verified.findIndex(item=>item.provider===resolved.provider&&item.providerPlaceId===resolved.providerPlaceId);
          if(existing<0)verified.push(resolved);
          else if(decidePlaceResolution({candidate:input.candidate,resolved:verified[existing]}).precision==='UNKNOWN')verified[existing]=resolved;
        }
      }
    }
    return {results:verified,hints:hints.map(({latitude,longitude})=>({latitude,longitude}))};
  }
}
