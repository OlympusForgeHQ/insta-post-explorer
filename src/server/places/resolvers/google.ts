import 'server-only';
import {z} from 'zod';
import type {PlaceResolutionInput} from './types';
const placeSchema=z.object({id:z.string().min(1).max(300),
  location:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)})});
export type GooglePlaceHint={placeId:string;latitude:number;longitude:number};
export interface GoogleHintSource {searchHints(input:PlaceResolutionInput):Promise<GooglePlaceHint[]>;}
// Hints are request-local only. No Google record enters canonical persistence.
export class GooglePlacesSearch implements GoogleHintSource {
  constructor(private readonly config:{apiKey:string;fetchImpl?:typeof fetch;reserveRequest?:()=>Promise<void>;sleepImpl?:(ms:number)=>Promise<void>}) {}
  async searchHints({candidate}:PlaceResolutionInput):Promise<GooglePlaceHint[]> {
    const textQuery=[candidate.name,candidate.address,candidate.city,candidate.region,candidate.country].filter(Boolean).join(', ');
    if(!textQuery)return [];
    let response:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){
    await this.config.reserveRequest?.();
    const signal=AbortSignal.timeout(15_000);
    try {
      response=await (this.config.fetchImpl??fetch)('https://places.googleapis.com/v1/places:searchText',{
        method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Goog-Api-Key':this.config.apiKey,
          'X-Goog-FieldMask':'places.id,places.location'},
        body:JSON.stringify({textQuery,pageSize:5,languageCode:'fr'}),
      });
    } catch {throw Error('GOOGLE_PLACES_UNAVAILABLE');}
    if(response.ok)break;
    await response.body?.cancel();
    const retryAfter=response.headers.get('retry-after');
    const explicitDelay=retryAfter===null?NaN:/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now();
    const delay=Number.isFinite(explicitDelay)?Math.max(1000,explicitDelay):15_000*(attempt+1);
    if(![429,503].includes(response.status)||attempt===2||delay>60_000)throw Error(`GOOGLE_PLACES_HTTP_${response.status}`);
    await (this.config.sleepImpl??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(delay);
    }
    if(!response?.ok)throw Error('GOOGLE_PLACES_UNAVAILABLE');
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
    return parsed.data.places.map(place=>({placeId:place.id,latitude:place.location.latitude,longitude:place.location.longitude}));
  }
}
