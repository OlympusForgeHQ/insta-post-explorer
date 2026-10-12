import {decidePlaceResolution} from '@/lib/places/resolution';
import type {PlaceResolver,PlaceResolutionInput} from './types';

export class FallbackPlaceResolver implements PlaceResolver {
  constructor(private readonly primary:PlaceResolver,private readonly secondary:PlaceResolver){}
  async resolve(input:PlaceResolutionInput){
    const results=await this.primary.resolve(input);
    if(results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))return results;
    const fallback=await this.secondary.resolve(input);
    return [...results,...fallback];
  }
}
