import { expect, it } from 'vitest';
import { workerCandidatesSchema, workerResultSchema, workerCommandSchema } from '@/lib/places/worker-contract';
import { placeCandidateBatchSchema } from '@/lib/places/candidates';

const candidate={name:'Example Cafe',address:null,city:'Paris',region:null,country:'France',category:'cafe',categoryReason:'The source recommends brunch.',confidence:0.8,evidence:[{type:'CAPTION',excerpt:'Brunch at Example Cafe'}]};

it('requires an explicitly scoped fresh reprocess command and defaults it to preview',()=>{
 const command={action:'reprocess',postId:'post',sourceJobId:'job',inputHash:'a'.repeat(64),expectedCompletionHash:'b'.repeat(64),
  result:{candidates:[candidate],media:[],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:10,outputTokens:20},elapsedMs:100}};
 expect(workerCommandSchema.parse(command)).toMatchObject({commit:false});
 for(const change of [{ownerId:'other'},{sourceJobId:undefined},{expectedCompletionHash:undefined},{inputHash:'stale'},{resolutionPolicy:'arbitrary'}]){
  expect(workerCommandSchema.safeParse({...command,...change}).success).toBe(false);
 }
});

it('accepts long worker itineraries without widening the caption-import limit',()=>{
 const candidates=Array.from({length:200},(_,i)=>({...candidate,name:`Example Cafe ${i+1}`}));
 expect(workerCandidatesSchema.parse({candidates}).candidates).toEqual(candidates);
 expect(workerCandidatesSchema.safeParse({candidates:[...candidates,candidate]}).success).toBe(false);
 expect(placeCandidateBatchSchema.safeParse(candidates.slice(0,51)).success).toBe(false);
 expect(placeCandidateBatchSchema.safeParse(candidates.slice(0,50)).success).toBe(true);
});

it('accepts full video coverage and late evidence up to fifteen minutes, rejecting longer timelines',()=>{
 const result={candidates:[{...candidate,evidence:[{type:'VIDEO_OCR',excerpt:'Example Cafe',mediaId:'video',videoTimestampMs:454000}]}],media:[{mediaId:'video',kind:'VIDEO',durationMs:454766,frameCount:12,audio:'absent'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:100,outputTokens:50},elapsedMs:1000};
 for(const durationMs of [454766,900000]){
  const input={...result,media:[{...result.media[0],durationMs}],candidates:[{...result.candidates[0],evidence:[{...result.candidates[0].evidence[0],videoTimestampMs:durationMs}]}]};
  const parsed=workerResultSchema.parse(input);
  expect(parsed.media[0].durationMs).toBe(durationMs);
  expect(parsed.candidates[0].evidence[0].videoTimestampMs).toBe(durationMs);
 }
 expect(workerResultSchema.safeParse({...result,media:[{...result.media[0],durationMs:900001}]}).success).toBe(false);
 expect(workerResultSchema.safeParse({...result,candidates:[{...result.candidates[0],evidence:[{...result.candidates[0].evidence[0],videoTimestampMs:900001}]}]}).success).toBe(false);
});

it('accepts automatic-only claims and precise retry causes without widening legacy commands',async()=>{
 const {workerCommandSchema}=await import('@/lib/places/worker-contract');
 expect(workerCommandSchema.safeParse({action:'claim',scope:'automatic',learning:true}).success).toBe(true);
 expect(workerCommandSchema.parse({action:'claim'})).toEqual({action:'claim'});
 expect(workerCommandSchema.safeParse({action:'enqueue',scope:'automatic'}).success).toBe(false);
 for(const code of ['INFERENCE_BUSY','ASR_UNAVAILABLE','ASR_FAILED','MEDIA_DOWNLOAD_FAILED','MEDIA_DECODE_FAILED','MEDIA_TOOLS_UNAVAILABLE','TEMP_STORAGE_UNAVAILABLE','PLACES_EVIDENCE_INVALID','PLACES_MEDIA_INCOMPLETE']){
  expect(workerCommandSchema.safeParse({action:'fail',jobId:'job',leaseToken:'00000000-0000-4000-8000-000000000000',code}).success).toBe(true);
 }
});
