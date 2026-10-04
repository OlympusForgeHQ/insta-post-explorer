import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const mediaSchema=z.object({id:z.string().min(1),kind:z.enum(['IMAGE','VIDEO']),mimeType:z.string(),byteSize:z.number().int().positive().max(250*1024*1024),versionTag:z.string().nullable(),url:z.string().url()});
export const preparedSchema=z.object({
 input:z.object({post_id:z.string().min(1),input_hash:z.string().min(1),analysis_version:z.string().optional(),main_theme:z.enum(['Restaurant','Voyages']).optional(),caption:z.string().max(100_000).optional(),author_username:z.string().optional(),internal_tags:z.array(z.string()).optional(),instagram_location:z.string().nullable().optional()}),
 media:z.array(mediaSchema).max(20),outputSchema:z.record(z.string(),z.unknown()),categoryRules:z.string().max(5000),
 jobId:z.string().optional(),leaseToken:z.string().optional(),heartbeatIntervalMs:z.number().int().min(100).max(30_000).optional(),
});
export type PreparedPost=z.infer<typeof preparedSchema>;
export type MediaDescriptor=z.infer<typeof mediaSchema>;
export interface PlacesApi {call(command:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>;}
export async function boundedJson(response:Response,maxBytes=2_000_000):Promise<unknown>{
 if(!response.body)throw Error('API_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw Error('INVALID_RESULT');chunks.push(part.value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export class PlacesHttpApi implements PlacesApi {
 constructor(private readonly origin:string,private readonly key:string,private readonly request:typeof fetch=fetch){}
 async call(command:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
  for(let attempt=0;attempt<3;attempt++){
   signal?.throwIfAborted();let response:Response,data:unknown;
   try{
    response=await this.request(this.origin+'/api/v1/places/worker',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.any([AbortSignal.timeout(240_000),...(signal?[signal]:[])])});
    if((response.status===429||response.status>=500)&&attempt<2){await response.body?.cancel();await delay(1000*(attempt+1),undefined,{signal});continue;}
    // Include interrupted/truncated response bodies in transport retries. The
    // server replays an identical completed payload without repeating writes.
    data=await boundedJson(response);
   }catch(error){
    if(signal?.aborted)throw Error('WORKER_STOPPING');
    if(error instanceof Error&&error.message==='INVALID_RESULT')throw error;
    if(attempt<2){await delay(1000*(attempt+1),undefined,{signal});continue;}
    throw Error('API_UNAVAILABLE');
   }
   if(!response.ok){const code=z.object({error:z.object({code:z.string()})}).safeParse(data);throw Error(code.success&&['PLACES_LEASE_LOST','PLACES_INPUT_STALE','POST_NOT_PLACES_ELIGIBLE','NOT_FOUND'].includes(code.data.error.code)?code.data.error.code:response.status>=500||response.status===429?'API_UNAVAILABLE':'API_REJECTED');}
   return data;
  }
  throw Error('API_UNAVAILABLE');
 }
}
