// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { PlaceResolver } from '@/server/places/resolvers/types';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
const url=process.env.TEST_DATABASE_URL?.trim();
const owner='places-worker-test', other='places-worker-other';
let db:PrismaClient;
let service:typeof import('@/server/places/worker');
const signer=async()=> 'https://test.r2.cloudflarestorage.com/bucket/originals/example.jpg?X-Amz-Signature=test';
const resolver:PlaceResolver={resolve:async()=>[{provider:'geoapify',providerPlaceId:'geo-brunch',displayName:'Example Cafe',category:'catering.fast_food',address:'10 Main Street, Paris, France',city:'Paris',region:null,country:'France',countryCode:'FR',latitude:48.8,longitude:2.3,providerResultType:'amenity',providerRank:1,providerMatchType:'full_match',attribution:'Geoapify'}]};
const dependencies={signMedia:signer,resolver};
const result={candidates:[{name:'Example Cafe',address:null,city:'Paris',region:null,country:'France',category:'cafe',categoryReason:'The caption describes brunch and coffee',confidence:0.98,evidence:[{type:'CAPTION',excerpt:'Brunch and coffee at Example Cafe'}]}],media:[{mediaId:'worker-media',kind:'IMAGE',durationMs:null,frameCount:1,audio:'not_applicable'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:100,outputTokens:50},elapsedMs:1000};
async function seed(){await db.post.create({data:{id:'worker-post',ownerId:owner,postUrl:'https://instagram.com/p/WorkerTest',thumbnailUrl:'https://example.test/t.jpg',authorUsername:'example',authorSortKey:'example',caption:'Brunch and coffee at Example Cafe',searchText:'brunch cafe',contentType:'IMAGE',mainTheme:'Restaurant',media:{create:{id:'worker-media',ownerId:owner,type:'IMAGE',position:0,sourcePath:'example.jpg',objectKey:'originals/example.jpg',mimeType:'image/jpeg',byteSize:100,versionTag:'v1',identityState:'VERIFIED'}}}});}
async function clear(){await db.post.deleteMany({where:{ownerId:{in:[owner,other]}}});await db.place.deleteMany({where:{ownerId:{in:[owner,other]}}});}
const suite=url?describe:describe.skip;
suite('Places worker ownership, leases and atomic completion',()=>{
 beforeAll(async()=>{process.env.DATABASE_URL=url;({prisma:db}=await import('@/server/db'));service=await import('@/server/places/worker');await clear();});
 beforeEach(async()=>{await clear();await seed();});afterAll(async()=>{await clear();await db.$disconnect();});
 it('learns only owner-confirmed geographic identities, excluding automatic and foreign examples',async()=>{
   const {loadVerifiedResolutionMemory}=await import('@/server/places/resolution-memory');
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},dependencies);
   const candidate={...result.candidates[0],country:null} as import('@/lib/places/candidates').PlaceCandidate;
   expect(await loadVerifiedResolutionMemory(owner,[candidate])).toEqual([]);
   await db.place.updateMany({where:{ownerId:owner},data:{isUserConfirmed:true,reviewStatus:'CONFIRMED'}});
   expect(await loadVerifiedResolutionMemory(owner,[candidate])).toMatchObject([{name:'Example Cafe',country:'France'}]);
   expect(await loadVerifiedResolutionMemory(other,[candidate])).toEqual([]);
 });
 it('reserves Google quota atomically and retains it after job completion',async()=>{
   const {reserveGoogleRequest}=await import('@/server/places/resolvers/google-budget');
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const spent=await db.auditEvent.count({where:{ownerId:owner,action:'places.google.reserve',occurredAt:{gte:new Date(new Date().toISOString().slice(0,7)+'-01T00:00:00Z')}}});
   vi.stubEnv('PLACES_GOOGLE_MONTHLY_CAP',String(spent+1));
   try{
     const attempts=await Promise.allSettled([reserveGoogleRequest(owner,'worker-post'),reserveGoogleRequest(owner,'worker-post')]);
     expect(attempts.filter(attempt=>attempt.status==='fulfilled')).toHaveLength(1);
     expect(attempts.filter(attempt=>attempt.status==='rejected')).toHaveLength(1);
     await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},dependencies);
     expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).result).toMatchObject({googleUsage:{requests:1}});
     await expect(reserveGoogleRequest(owner,'worker-post')).rejects.toThrow('GOOGLE_PLACES_BUDGET_EXHAUSTED');
     await db.post.delete({where:{id:'worker-post'}});
     await seed();await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
     await expect(reserveGoogleRequest(owner,'worker-post')).rejects.toThrow('GOOGLE_PLACES_BUDGET_EXHAUSTED');
   }finally{vi.unstubAllEnvs();}
 });
 it('recovers only unresolved evidence with a fresh owner-bound input and idempotent additive writes',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},{...dependencies,resolver:{resolve:async()=>[]}});
   const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,originalResult:result,sourceCandidateIndices:[0],result,commit:true};
   const legacyHash=createHash('sha256').update(JSON.stringify({sourceJobId:claim.jobId,sourceCandidateIndices:[0],result})).digest('hex');
   await db.placeAnalysisJob.create({data:{ownerId:owner,postId:'worker-post',inputHash:legacyHash,analysisVersion:'places-contextual-recovery-v1',sourceTheme:'Restaurant',status:'NEEDS_REVIEW',depth:'METADATA_ONLY',result:{recoveryReceipt:{status:'NEEDS_REVIEW',linksPersisted:0,unknownCandidates:1}}}});
   const receipt=await service.recoverPlacesResult(owner,command,dependencies);
   expect(receipt).toMatchObject({status:'SUCCEEDED',linksPersisted:1,unknownCandidates:0});
   expect(await service.recoverPlacesResult(owner,command,dependencies)).toEqual(receipt);
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(1);
   await expect(service.recoverPlacesResult(other,command,dependencies)).rejects.toThrow();
   await db.post.update({where:{id:'worker-post'},data:{caption:'Changed'}});
   await expect(service.recoverPlacesResult(owner,command,dependencies)).rejects.toThrow('PLACES_INPUT_STALE');
 });
 it('cannot omit or substitute unresolved identities sharing the same excerpt',async()=>{
   const original={...result,candidates:[result.candidates[0],{...result.candidates[0],name:'Second Cafe'}]};
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:original},{...dependencies,resolver:{resolve:async()=>[]}});
   const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,originalResult:original,sourceCandidateIndices:[0],result,commit:true};
   await expect(service.recoverPlacesResult(owner,command,dependencies)).rejects.toThrow('PLACES_EVIDENCE_INVALID');
   await expect(service.recoverPlacesResult(owner,{...command,originalResult:result},dependencies)).rejects.toThrow('PLACES_EVIDENCE_INVALID');
   for(const replacement of [{name:'Other Cafe'},{address:'999 Other Street'},{city:'Lyon'},{country:'Belgium'}]){
     await expect(service.recoverPlacesResult(owner,{...command,sourceCandidateIndices:[0,1],
       result:{...original,candidates:[{...original.candidates[0],...replacement},original.candidates[1]]}},dependencies)).rejects.toThrow('PLACES_EVIDENCE_INVALID');
   }
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(0);
 });
 it('preserves unidentified evidence for review without making an empty geocoding request',async()=>{
   const empty={...result.candidates[0],name:null,address:null,city:null,region:null,country:null};
   const resolve=vi.fn(async()=>{throw Error('EMPTY_PROVIDER_QUERY');});
   const deps={signMedia:signer,resolver:{resolve}};
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{postId:'worker-post'},deps))!;
   const receipt=await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:{...result,candidates:[empty]}},deps);
   expect(receipt).toMatchObject({status:'NEEDS_REVIEW',unknownCandidates:1,placesPersisted:0,evidencePersisted:1});
   expect(resolve).not.toHaveBeenCalled();
   expect(await db.placeEvidence.count({where:{ownerId:owner,placeId:null}})).toBe(1);
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
 });
 it('keeps partial successes reviewable and persists explanations through completion',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const unknown={...result.candidates[0],name:null,address:null,city:null,region:null,country:null};
   const receipt=await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:{...result,candidates:[result.candidates[0],unknown]}},dependencies);
   expect(receipt).toMatchObject({status:'NEEDS_REVIEW',unknownCandidates:1,linksPersisted:1});
   const job=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   expect(job.result).toMatchObject({resolutionPolicy:'contextual-identity-v2',decisions:[{precision:'EXACT'},{precision:'UNKNOWN',reasons:['no_identity_context']}]});
 });

 it('retries only the explicitly identified failed unchanged job within its original attempt budget',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{postId:'worker-post'},dependencies))!;
   await service.failPlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,code:'INVALID_RESULT'});
   const command={jobId:claim.jobId,postId:'worker-post',inputHash:claim.input.input_hash};
   await expect(service.retryPlacesJob(other,command)).rejects.toThrow('PLACES_JOB_NOT_FOUND');
   await expect(service.retryPlacesJob(owner,{...command,inputHash:'0'.repeat(64)})).rejects.toThrow('PLACES_INPUT_STALE');
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:true});
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:false});
   expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).attemptCount).toBe(1);
   const retried=(await service.claimPlacesJob(owner,{postId:'worker-post'},dependencies))!;
   await service.completePlacesJob(owner,{jobId:retried.jobId,leaseToken:retried.leaseToken,result},dependencies);
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:false});
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{status:'FAILED',errorCode:'INVALID_RESULT',attemptCount:3}});
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:false});
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{attemptCount:1}});
   await db.post.update({where:{id:'worker-post'},data:{caption:'Changed by the owner'}});
   await expect(service.retryPlacesJob(owner,command)).rejects.toThrow('PLACES_INPUT_STALE');
 });
 it('previews without jobs and commits a claimed result exactly once with the post category',async()=>{
   const preview=await service.preparePlacesPost(owner,'worker-post',dependencies);
   expect(preview.input.main_theme).toBe('Restaurant');expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(0);
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=await service.claimPlacesJob(owner,{postId:'worker-post'},dependencies);expect(claim).not.toBeNull();
   expect(await service.claimPlacesJob(owner,{},dependencies)).toBeNull();
   expect(await service.claimPlacesJob(other,{},dependencies)).toBeNull();
   const command={jobId:claim!.jobId,leaseToken:claim!.leaseToken,result};
   const [first,concurrent]=await Promise.all([service.completePlacesJob(owner,command,dependencies),service.completePlacesJob(owner,command,dependencies)]);
   expect(concurrent).toEqual(first);
   expect(first.placesPersisted).toBe(1);
   expect(await service.completePlacesJob(owner,command,dependencies)).toEqual(first);
   expect(await db.place.count({where:{ownerId:owner}})).toBe(1);
   expect((await db.place.findFirstOrThrow({where:{ownerId:owner}})).category).toBe('cafe');
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(2);
   await expect(service.completePlacesJob(other,command,dependencies)).rejects.toThrow();
 });
 it('rejects expired claims and changed or deleted input before any place is written',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{leaseExpiresAt:new Date(0)}});
   await expect(service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},dependencies)).rejects.toThrow('PLACES_LEASE_LOST');
   const resumed=(await service.claimPlacesJob(owner,{},dependencies))!;
   expect(resumed.leaseToken).not.toBe(claim.leaseToken);
   await db.post.update({where:{id:'worker-post'},data:{caption:'Changed to another venue'}});
   await expect(service.completePlacesJob(owner,{jobId:resumed.jobId,leaseToken:resumed.leaseToken,result},dependencies)).rejects.toThrow('PLACES_INPUT_STALE');
   await db.post.delete({where:{id:'worker-post'}});
   await expect(service.completePlacesJob(owner,{jobId:resumed.jobId,leaseToken:resumed.leaseToken,result},dependencies)).rejects.toThrow();
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
 });
 it('rejects missing media coverage and injected authoritative fields without domain writes',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   for(const invalid of [{...result,media:[]},{...result,candidates:[{...result.candidates[0],latitude:1}]},{...result,candidates:[{...result.candidates[0],category:'catering.cafe'}]}]){
     await expect(service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:invalid},dependencies)).rejects.toThrow();
   }
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(0);
 });
 it('persists every distinct destination beyond 50 and replays the complete receipt once',async()=>{
   const candidates=Array.from({length:51},(_,i)=>({...result.candidates[0],name:`Example Cafe ${i+1}`,evidence:[{type:'CAPTION',excerpt:`Brunch at Example Cafe ${i+1}.`}]}));
   await db.post.update({where:{id:'worker-post'},data:{caption:candidates.map(c=>c.evidence[0].excerpt).join('\n')}});
   const many:PlaceResolver={resolve:async input=>[{...(await resolver.resolve(input))[0],providerPlaceId:`geo-${input.candidate.name}`,displayName:input.candidate.name!,providerName:input.candidate.name}]};
   const deps={signMedia:signer,resolver:many};
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{postId:'worker-post'},deps))!;
   const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result:{...result,candidates}};
   const completed=await service.completePlacesJob(owner,command,deps);
   expect(completed.placesPersisted).toBe(51);
   expect(completed.linksPersisted).toBe(51);
   expect(await service.completePlacesJob(owner,command,deps)).toEqual(completed);
   expect(await db.place.count({where:{ownerId:owner}})).toBe(51);
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(51);
   expect(await db.placeEvidence.count({where:{ownerId:owner,evidenceType:'CAPTION'}})).toBe(51);
 });
});
