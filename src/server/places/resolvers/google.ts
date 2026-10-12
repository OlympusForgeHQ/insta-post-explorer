import 'server-only';
import {z} from 'zod';
import type {PlaceResolutionInput,PlaceResolver,ResolvedPlaceCandidate} from './types';
const placeSchema=z.object({id:z.string().min(1).max(300),displayName:z.object({text:z.string().max(500)}),
  formattedAddress:z.string().max(1000),location:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),
  types:z.array(z.string()).max(100).default([]),businessStatus:z.string().optional(),
  addressComponents:z.array(z.object({longText:z.string(),shortText:z.string().optional(),types:z.array(z.string())})).max(50).default([])});
export class GooglePlacesResolver implements PlaceResolver {
  constructor(private readonly config:{apiKey:string;fetchImpl?:typeof fetch;reserveRequest?:()=>Promise<void>}) {}
  async resolve({candidate}:PlaceResolutionInput):Promise<ResolvedPlaceCandidate[]> {
    const textQuery=[candidate.name,candidate.address,candidate.city,candidate.region,candidate.country].filter(Boolean).join(', ');
    if(!textQuery)return [];
    await this.config.reserveRequest?.();
    const signal=AbortSignal.timeout(15_000);
    let response:Response;
    try {
      response=await (this.config.fetchImpl??fetch)('https://places.googleapis.com/v1/places:searchText',{
        method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Goog-Api-Key':this.config.apiKey,
          'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types,places.businessStatus'},
        body:JSON.stringify({textQuery,pageSize:5,languageCode:'fr'}),
      });
    } catch {throw Error('GOOGLE_PLACES_UNAVAILABLE');}
    if(!response.ok){await response.body?.cancel();throw Error(`GOOGLE_PLACES_HTTP_${response.status}`);}
    let payload:unknown;
    try{
      const reader=response.body?.getReader();if(!reader)throw Error();
      const chunks:Uint8Array[]=[];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512_000)throw Error();chunks.push(part.value);}}
      finally{await reader.cancel();reader.releaseLock();}
      payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{throw Error('GOOGLE_PLACES_INVALID_RESPONSE');}
    const parsed=z.object({places:z.array(placeSchema).max(5).default([])}).safeParse(payload);
    if(!parsed.success)throw Error('GOOGLE_PLACES_INVALID_RESPONSE');
    return parsed.data.places.filter(place=>place.businessStatus!=='CLOSED_PERMANENTLY').map(place=>{
      const component=(type:string)=>place.addressComponents.find(item=>item.types.includes(type));
      const area=place.types.includes('locality')?'city':place.types.includes('administrative_area_level_1')?'state':place.types.includes('country')?'country':null;
      return {provider:'google',providerPlaceId:place.id,displayName:place.displayName.text,providerName:place.displayName.text,
        address:place.formattedAddress,city:component('locality')?.longText??component('postal_town')?.longText??null,
        region:component('administrative_area_level_1')?.longText??null,country:component('country')?.longText??null,
        countryCode:component('country')?.shortText?.toUpperCase()??null,latitude:place.location.latitude,longitude:place.location.longitude,
        providerResultType:area??(place.types.includes('establishment')||place.types.includes('point_of_interest')?'poi':'unknown'),
        providerRank:null,providerMatchType:null,category:null,attribution:'Google Maps'};
    });
  }
}
