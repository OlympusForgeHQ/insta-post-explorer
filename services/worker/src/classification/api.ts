import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {boundedJson} from '../places/api.js';
export const classificationClaimSchema=z.object({jobId:z.string().min(1),leaseToken:z.string().uuid(),heartbeatIntervalMs:z.literal(30_000),input:z.object({post_id:z.string().min(1),input_hash:z.string().min(1),caption:z.string().max(100_000),author_username:z.string().max(255)}),media:z.array(z.object({id:z.string(),kind:z.enum(['IMAGE','VIDEO']),mimeType:z.string(),byteSize:z.number().int().positive().max(250*1024*1024),versionTag:z.string().nullable(),url:z.string().url()})).min(1).max(20),themes:z.array(z.string().min(1).max(120)).min(1).max(32),existingTags:z.array(z.string().max(80)).max(300),outputSchema:z.record(z.string(),z.unknown())});
export type ClassificationClaim=z.infer<typeof classificationClaimSchema>;
export interface ClassificationApi{call(command:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>;}
export class ClassificationHttpApi implements ClassificationApi{
 constructor(private readonly origin:string,private readonly key:string,private readonly request:typeof fetch=fetch){}
 async call(command:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
  for(let attempt=0;attempt<3;attempt++){
   signal?.throwIfAborted();let response:Response,data:unknown;
   try{response=await this.request(new URL('/api/v1/classification/worker',this.origin),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.any([AbortSignal.timeout(40_000),...(signal?[signal]:[])])});data=await boundedJson(response);}
   catch{if(signal?.aborted)throw Error('WORKER_STOPPING');if(attempt<2){await delay(1000*(attempt+1),undefined,{signal});continue;}throw Error('API_UNAVAILABLE');}
   if(response.ok)return data;
   if([429,500,502,503,504].includes(response.status)&&attempt<2){await delay(1000*(attempt+1),undefined,{signal});continue;}
   const parsed=z.object({error:z.object({code:z.string()})}).safeParse(data);const code=parsed.success?parsed.data.error.code:'';
   throw Error(['CLASSIFICATION_INPUT_STALE','CLASSIFICATION_LEASE_LOST','NOT_FOUND'].includes(code)?code:response.status>=500||response.status===429?'API_UNAVAILABLE':'API_REJECTED');
  }
  throw Error('API_UNAVAILABLE');
 }
}
