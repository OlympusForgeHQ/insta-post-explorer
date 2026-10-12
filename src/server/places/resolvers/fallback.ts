import {decidePlaceResolution} from '@/lib/places/resolution';
import {distanceMeters} from '@/lib/places/distance';
import type {PlaceResolver,PlaceResolutionInput} from './types';
import type {GoogleHintSource} from './google';

export class FallbackPlaceResolver implements PlaceResolver {
  constructor(private readonly primary:PlaceResolver,private readonly secondary:GoogleHintSource){}
  async resolve(input:PlaceResolutionInput){
    const results=await this.primary.resolve(input);
    if(results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))return results;
    // Google only narrows retrieval geographically. Every returned field and
    // coordinate must be independently retrieved from the primary provider and
    // corroborated against the unchanged source candidate, never Google text.
    const hints=await this.secondary.searchHints(input);
    const verified=[...results];
    for(const hint of hints){
      const nearby=await this.primary.resolve({...input,proximity:{latitude:hint.latitude,longitude:hint.longitude}});
      for(const resolved of nearby){
        if(resolved.provider==='geoapify'&&distanceMeters(hint,resolved)<=100&&
          decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'&&
          !verified.some(item=>item.provider===resolved.provider&&item.providerPlaceId===resolved.providerPlaceId))verified.push(resolved);
      }
    }
    return verified;
  }
}
