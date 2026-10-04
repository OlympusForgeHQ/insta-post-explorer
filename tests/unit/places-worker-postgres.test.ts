// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { PlaceResolver } from '@/server/places/resolvers/types';
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
});
