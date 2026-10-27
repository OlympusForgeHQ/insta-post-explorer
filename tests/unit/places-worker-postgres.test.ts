// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { PlaceResolver } from '@/server/places/resolvers/types';
import {createHash,randomUUID} from 'node:crypto';
import {workerResultSchema} from '@/lib/places/worker-contract';
vi.mock('server-only',()=>({}));
const polling=vi.hoisted(()=>({fast:false}));
vi.mock('node:timers/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:timers/promises')>();
  return {...actual,setTimeout:(...args:Parameters<typeof actual.setTimeout>)=>polling.fast?Promise.resolve():actual.setTimeout(...args)};
});
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

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
 it('reprocesses a named review with fresh coverage once per policy, retaining its original history',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},{...dependencies,resolver:{resolve:async()=>[]}});
   const original=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   const completion=(original.result as {completion:{requestHash:string}}).completion;
   const fresh={...result,elapsedMs:2000};
   const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,expectedCompletionHash:completion.requestHash,result:fresh,commit:true};
   for(const [scope,change,error] of [[other,{},'POST_NOT_FOUND'],[owner,{expectedCompletionHash:'0'.repeat(64)},'PLACES_JOB_CONFLICT'],[owner,{inputHash:'0'.repeat(64)},'PLACES_INPUT_STALE'],[owner,{result:{...fresh,media:[]}},'PLACES_MEDIA_INCOMPLETE']] as const){
     await expect(service.reprocessPlacesResult(scope,{...command,...change},dependencies)).rejects.toThrow(error);
   }
   const preview=await service.reprocessPlacesResult(owner,{...command,commit:false},dependencies);
   expect(preview).toMatchObject({committed:false});
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
   const [first,second]=await Promise.all([service.reprocessPlacesResult(owner,command,dependencies),service.reprocessPlacesResult(owner,command,dependencies)]);
   expect(second).toEqual(first);expect(first).toMatchObject({status:'SUCCEEDED',linksPersisted:1});
   expect(await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).toEqual(original);
   expect(await db.placeAnalysisJob.count({where:{ownerId:owner,analysisVersion:'places-policy-reprocess-v1'}})).toBe(1);
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(1);
   const noProvider={...dependencies,resolver:{resolve:async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');}}};
   expect(await service.reprocessPlacesResult(owner,command,noProvider)).toEqual(first);
   await expect(service.reprocessPlacesResult(owner,{...command,result:{...fresh,elapsedMs:2001}},noProvider)).rejects.toThrow('PLACES_JOB_CONFLICT');
   await db.post.update({where:{id:'worker-post'},data:{caption:'Changed source'}});
   await expect(service.reprocessPlacesResult(owner,command,noProvider)).rejects.toThrow('PLACES_INPUT_STALE');
 });
 it('lets owner exclusion and source changes during explicit reprocessing win before persistence',async()=>{
   for(const race of ['exclusion','source','media','active'] as const){
     await clear();await seed();
     await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
     const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
     await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},{...dependencies,resolver:{resolve:async()=>[]}});
     const original=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
     const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,expectedCompletionHash:(original.result as {completion:{requestHash:string}}).completion.requestHash,result,commit:true};
     const racing:PlaceResolver={resolve:async input=>{
       if(race==='exclusion'){
         const review=await import('@/server/places/review');
         await review.confirmPostHasNoPlace(owner,'worker-post',{actor:{type:'USER',id:owner},reason:'No place'});
       }else if(race==='source')await db.post.update({where:{id:'worker-post'},data:{caption:'Source changed during provider lookup'}});
       else if(race==='media')await db.postMedia.update({where:{id:'worker-media'},data:{id:'worker-media-replaced'}});
       else await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{status:'PROCESSING',leaseExpiresAt:new Date(Date.now()+60000)}});
       return resolver.resolve(input);
     }};
     await expect(service.reprocessPlacesResult(owner,command,{...dependencies,resolver:racing})).rejects.toThrow();
     expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
     expect(await db.placeAnalysisJob.count({where:{ownerId:owner,analysisVersion:'places-policy-reprocess-v1'}})).toBe(0);
   }
 });
 it('honors only the owner-authored no-place correction before automatic preparation',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner,postId:'worker-post'}});
   const evidence=await db.placeEvidence.create({data:{ownerId:owner,postId:'worker-post',analysisJobId:job.id,
     placeId:null,evidenceType:'USER_CORRECTION',excerpt:'Informational post without a place',confidence:1,
     metadata:{action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:owner}}});
   await expect(service.preparePlacesPost(owner,'worker-post',dependencies)).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
   for(const metadata of [
     {action:'POST_NO_PLACE_CONFIRMED',actorType:'MCP',actorId:owner},
     {action:'POST_NO_PLACE_CONFIRMED',actorType:'SYSTEM',actorId:owner},
     {action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:other},
     {action:'PLACE_REJECTED',actorType:'USER',actorId:owner},
   ]){
     await db.placeEvidence.update({where:{id:evidence.id},data:{metadata}});
     expect((await service.preparePlacesPost(owner,'worker-post',dependencies)).input.post_id).toBe('worker-post');
   }
 });
 it('confirms no place atomically and idempotently without changing source results, links or the post',async()=>{
   const review=await import('@/server/places/review');
   const context={actor:{type:'USER',id:owner},reason:'Owner confirms this is informational, without a place'};
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const unknown={...result.candidates[0],name:null,address:null,city:null,country:null};
   const source={...result,candidates:[result.candidates[0],unknown]};
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:source},dependencies);
   const before={post:await db.post.findUniqueOrThrow({where:{id:'worker-post'}}),
     job:await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}}),
     links:await db.postPlace.findMany({where:{ownerId:owner}}),
     evidence:await db.placeEvidence.findMany({where:{ownerId:owner},orderBy:{id:'asc'}})};
   await expect(review.confirmPostHasNoPlace(other,'worker-post',{...context,actor:{type:'USER',id:other}})).rejects.toThrow('POST_NOT_FOUND');
   for(const actor of [{type:'MCP',id:owner},{type:'SYSTEM',id:owner},{type:'USER',id:other}]){
     await expect(review.confirmPostHasNoPlace(owner,'worker-post',{...context,actor})).rejects.toThrow('INVALID_REVIEW_CONTEXT');
   }
   const [first,second]=await Promise.all([review.confirmPostHasNoPlace(owner,'worker-post',context),review.confirmPostHasNoPlace(owner,'worker-post',context)]);
   expect(first).toEqual(second);
   expect(await db.post.findUniqueOrThrow({where:{id:'worker-post'}})).toEqual(before.post);
   expect(await db.postPlace.findMany({where:{ownerId:owner}})).toEqual(before.links);
   expect(await db.placeEvidence.findMany({where:{ownerId:owner,evidenceType:{not:'USER_CORRECTION'}},orderBy:{id:'asc'}})).toEqual(before.evidence);
   const cancelled=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   expect(cancelled).toMatchObject({status:'CANCELLED',errorCode:'OWNER_NO_PLACE_REVIEW',result:before.job.result});
   const evidence=await db.placeEvidence.findMany({where:{ownerId:owner,evidenceType:'USER_CORRECTION'}});
   expect(evidence).toHaveLength(1);
   expect(evidence[0]).toMatchObject({postId:'worker-post',placeId:null,analysisJobId:claim.jobId,
     metadata:{action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:owner}});
   await expect(service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:source},dependencies)).rejects.toThrow();
   await db.post.update({where:{id:'worker-post'},data:{caption:'A newly changed input',mainTheme:'Voyages'}});
   expect((await service.enqueuePlacesPosts(owner,{})).queued).toBe(0);
   expect(await service.claimPlacesJob(owner,{},dependencies)).toBeNull();
   const jobs=await import('@/server/places/jobs');
   await expect(jobs.createMetadataAnalysisJob({ownerId:owner,postId:'worker-post',analysisVersion:'new-version'})).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
   const batch=await import('@/server/places/caption-batch');
   const report=await batch.importCandidateBatch({ownerId:owner,resolver,continueOnError:true,
     jsonl:JSON.stringify({post_id:'worker-post',analysis_version:claim.input.analysis_version,
       input_hash:claim.input.input_hash,candidates:result.candidates})});
   expect(report.errors).toEqual([{line:1,code:'POST_NOT_PLACES_ELIGIBLE'}]);
   expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(1);
 });
 it('lets a correction during provider work win over completion, preview and metadata persistence',async()=>{
   const review=await import('@/server/places/review');
   const analysis=await import('@/server/places/analysis');
   const context={actor:{type:'USER',id:owner},reason:'No place to analyze'};
   for(const operation of ['complete','preview','metadata'] as const){
     await clear();await seed();
     await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
     const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
     const racingResolver:PlaceResolver={resolve:async(input)=>{
       await review.confirmPostHasNoPlace(owner,'worker-post',context);
       return resolver.resolve(input);
     }};
     const deps={...dependencies,resolver:racingResolver};
     const attempt=operation==='complete'
       ?service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},deps)
       :operation==='preview'
         ?service.previewPlacesResult(owner,{postId:'worker-post',inputHash:claim.input.input_hash,result},deps)
         :analysis.analyzeCandidateBatchRecord({ownerId:owner,commit:true,resolver:racingResolver,
           record:{post_id:'worker-post',analysis_version:claim.input.analysis_version,input_hash:claim.input.input_hash,
             candidates:workerResultSchema.parse(result).candidates}});
     await expect(attempt).rejects.toThrow();
     expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
     expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(0);
     expect(await db.placeAnalysisJob.count({where:{ownerId:owner,status:{not:'CANCELLED'}}})).toBe(0);
     expect(await db.placeEvidence.count({where:{ownerId:owner,evidenceType:'USER_CORRECTION'}})).toBe(1);
   }
 });
 it('keeps owner exclusion effective across a recovery race and cached success receipts',async()=>{
   const review=await import('@/server/places/review');
   const context={actor:{type:'USER',id:owner},reason:'No recommended place'};
   for(const duringRecovery of [true,false]){
     await clear();await seed();
     await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
     const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
     await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},{...dependencies,resolver:{resolve:async()=>[]}});
     const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,originalResult:result,sourceCandidateIndices:[0],result,commit:true};
     if(duringRecovery){
       const deps={...dependencies,resolver:{resolve:async(input:Parameters<PlaceResolver['resolve']>[0])=>{
         await review.confirmPostHasNoPlace(owner,'worker-post',context);
         return resolver.resolve(input);
       }}};
       await expect(service.recoverPlacesResult(owner,command,deps)).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
       expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(0);
     }else{
       await service.recoverPlacesResult(owner,command,dependencies);
       const saved=await db.placeAnalysisJob.findMany({where:{ownerId:owner},orderBy:{id:'asc'}});
       await review.confirmPostHasNoPlace(owner,'worker-post',context);
       await expect(service.recoverPlacesResult(owner,command,dependencies)).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
       await expect(service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},dependencies)).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
       expect((await db.placeAnalysisJob.findMany({where:{ownerId:owner},orderBy:{id:'asc'}})).map(j=>j.result)).toEqual(saved.map(j=>j.result));
       expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(1);
     }
   }
 });
 it('serializes concurrent owner confirmation with worker and metadata admission',async()=>{
   const review=await import('@/server/places/review');
   const jobs=await import('@/server/places/jobs');
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   await db.post.update({where:{id:'worker-post'},data:{caption:'Updated input before concurrent admission'}});
   const outcomes=await Promise.allSettled([
     review.confirmPostHasNoPlace(owner,'worker-post',{actor:{type:'USER',id:owner},reason:'No place'}),
     service.enqueuePlacesPosts(owner,{postId:'worker-post'}),
     jobs.createMetadataAnalysisJob({ownerId:owner,postId:'worker-post',analysisVersion:'concurrent-new-version'}),
     service.claimPlacesJob(owner,{},dependencies),
   ]);
   expect(outcomes[0].status).toBe('fulfilled');
   for(const outcome of outcomes.slice(1))if(outcome.status==='rejected')expect(outcome.reason.message).toBe('POST_NOT_PLACES_ELIGIBLE');
   expect(await db.placeAnalysisJob.count({where:{ownerId:owner,status:{in:['PENDING','PROCESSING','NEEDS_REVIEW']}}})).toBe(0);
   expect(await db.placeEvidence.count({where:{ownerId:owner,evidenceType:'USER_CORRECTION'}})).toBe(1);
 });
 it('blocks direct persistence and fresh claims for a saved owner exclusion',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
   await db.placeEvidence.create({data:{ownerId:owner,postId:'worker-post',analysisJobId:job.id,placeId:null,
     evidenceType:'USER_CORRECTION',excerpt:'No place',confidence:1,metadata:{action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:owner}}});
   expect(await service.claimPlacesJob(owner,{},dependencies)).toBeNull();
   expect(await db.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({status:'CANCELLED',errorCode:'OWNER_NO_PLACE_REVIEW'});
   const analysis=await import('@/server/places/analysis');
   await expect(db.$transaction(tx=>analysis.persistMetadataAnalysis(tx,{ownerId:owner,postId:'worker-post',jobId:job.id,plans:[]}))).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(1);
 });
 it('binds generic branch scope to full persisted source in preview and completion',async()=>{
   const excerpt='Example Cafe in Paris';
   for(const [caption,evidence,expanded] of [
     [excerpt,[{type:'CAPTION',excerpt}],true],
     [excerpt+'\nSpecific neighborhood branch',[{type:'CAPTION',excerpt}],false],
     ['@examplecafeparis',[{type:'AUTHOR_TEXT',excerpt:'@examplecafeparis'}],false],
   ] as const){
     await clear();await seed();
     await db.post.update({where:{id:'worker-post'},data:{caption}});
     const scoped={...result,candidates:[{...result.candidates[0],evidence,locationScope:{kind:'CITY',evidenceIndex:0}}]};
     const resolve=vi.fn(async(input:Parameters<PlaceResolver['resolve']>[0])=>{
       expect(input.sourceContext).toEqual({caption,structuredLocation:null});
       const [first]=await resolver.resolve(input);
       return [first,{...first,providerPlaceId:'second',latitude:48.85,address:'20 Other Street, Paris, France'}];
     });
     const deps={...dependencies,resolver:{resolve}};
     const prepared=await service.preparePlacesPost(owner,'worker-post',deps);
     const preview=await service.previewPlacesResult(owner,{postId:'worker-post',inputHash:prepared.input.input_hash,result:scoped},deps);
     expect(preview.plans[0].branches?.length??0).toBe(expanded?2:0);
     if(!expanded)expect(preview.plans[0].best).toBeNull();
     await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
     const claim=(await service.claimPlacesJob(owner,{postId:'worker-post'},deps))!;
     const receipt=await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:scoped},deps);
     expect(receipt).toMatchObject({linksPersisted:expanded?2:0,unknownCandidates:expanded?0:1});
     expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(expanded?2:0);
     const job=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
     expect(job.result).toMatchObject({completion:{requestHash:createHash('sha256').update(JSON.stringify(workerResultSchema.parse(scoped))).digest('hex')}});
   }
 });
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
 it('allows one new-policy repair after the legacy recovery budget and preserves source-counted branches',async()=>{
   const branchResult={...result,candidates:[{...result.candidates[0],evidence:[{type:'CAPTION',excerpt:'Example Cafe\nPlusieurs adresses à Paris'}]}]};
   await db.post.update({where:{id:'worker-post'},data:{caption:'Example Cafe\nPlusieurs adresses à Paris'}});
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:branchResult},{...dependencies,resolver:{resolve:async()=>[]}});
   for(let i=0;i<3;i++)await db.placeAnalysisJob.create({data:{ownerId:owner,postId:'worker-post',inputHash:'legacy-'+i,analysisVersion:'places-contextual-recovery-v1',sourceTheme:'Restaurant',status:'NEEDS_REVIEW',depth:'METADATA_ONLY',result:{resolutionPolicy:'contextual-identity-v2'}}});
   const resolve=vi.fn(async(input:Parameters<PlaceResolver['resolve']>[0])=>{const [first]=await resolver.resolve(input);return [first,{...first,providerPlaceId:'second',latitude:48.85,address:'20 Other Street, Paris, France'}];});
   const deps={...dependencies,resolver:{resolve}};
   const command={postId:'worker-post',sourceJobId:claim.jobId,inputHash:claim.input.input_hash,originalResult:branchResult,sourceCandidateIndices:[0],result:branchResult,commit:true};
   const receipt=await service.recoverPlacesResult(owner,command,deps);
   expect(receipt).toMatchObject({status:'SUCCEEDED',placesPersisted:2,linksPersisted:2,unknownCandidates:0});
   expect(await service.recoverPlacesResult(owner,command,deps)).toEqual(receipt);
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(2);
   if(!('jobId' in receipt)||!receipt.jobId)throw Error('MISSING_COMMITTED_RECEIPT');
   const job=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:receipt.jobId}});
   expect((job.result as {decisions:unknown[]}).decisions).toHaveLength(1);
   resolve.mockClear();
   await expect(service.recoverPlacesResult(owner,{...command,result:{...branchResult,candidates:[{...branchResult.candidates[0],region:'Ile-de-France',inferredFields:['region']}]}},deps)).rejects.toThrow('PLACES_JOB_CONFLICT');
   expect(resolve).not.toHaveBeenCalled();
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
   expect(job.result).toMatchObject({resolutionPolicy:'provider-context-v11',decisions:[{precision:'EXACT'},{precision:'UNKNOWN',reasons:['no_identity_context']}]});
 });

 it('learns only from fenced failures, backs off, and retains the recovery outcome and sync provenance',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const pending=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
   await db.placeAnalysisJob.update({where:{id:pending.id},data:{result:{automation:{version:1,source:'sync',syncJobId:'test-sync'}}}});
   const claim=(await service.claimPlacesJob(owner,{learning:true},dependencies))!;
   expect(claim.learningContext?.strategy).toBe('standard');
   const wrong={jobId:claim.jobId,leaseToken:'00000000-0000-4000-8000-000000000000',code:'INVALID_RESULT'};
   await expect(service.failPlacesJob(owner,wrong)).rejects.toThrow('PLACES_LEASE_LOST');
   await expect(service.failPlacesJob(other,{...wrong,leaseToken:claim.leaseToken})).rejects.toThrow('PLACES_JOB_NOT_FOUND');
   expect(await service.failPlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,code:'PLACES_EVIDENCE_INVALID'})).toEqual({ok:true,retryable:true});
   const failed=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   expect(failed).toMatchObject({status:'PENDING',attemptCount:1,result:{learning:{outcomes:[{code:'PLACES_EVIDENCE_INVALID',attempt:1,status:'FAILED'}]}}});
   expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now()+50_000);
   expect(await service.claimPlacesJob(owner,{learning:true},dependencies)).toBeNull();
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{nextAttemptAt:new Date(0)}});
   const retry=(await service.claimPlacesJob(owner,{learning:true},dependencies))!;
   expect(retry.learningContext?.strategy).toBe('evidence_guidance');
   await expect(service.failPlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,code:'INVALID_RESULT'})).rejects.toThrow('PLACES_LEASE_LOST');
   await service.completePlacesJob(owner,{jobId:retry.jobId,leaseToken:retry.leaseToken,result},dependencies);
   const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   expect(saved.result).toMatchObject({automation:{source:'sync'},decisions:[{precision:'EXACT'}],learning:{outcomes:[{status:'FAILED'},{attempt:2,status:'SUCCEEDED',strategy:'evidence_guidance'}]}});
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
 it('defers infrastructure faults with a separate finite budget and preserves analysis history',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
   const marker={automation:{version:1,source:'sync',syncJobId:'sync'},learning:{version:1,shape:'image:short:single',outcomes:[{attempt:1,status:'FAILED',code:'INVALID_RESULT',strategy:'standard'}]}};
   await db.placeAnalysisJob.update({where:{id:job.id},data:{attemptCount:1,result:marker}});
   for(let count=1;count<=7;count++){
    const claim=(await service.claimPlacesJob(owner,{postId:'worker-post',learning:true},dependencies))!;
    const lease={jobId:claim.jobId,leaseToken:claim.leaseToken,code:count%2?'ASR_UNAVAILABLE':'INFERENCE_BUSY'};
    await expect(service.failPlacesJob(other,lease)).rejects.toThrow('PLACES_JOB_NOT_FOUND');
    await service.failPlacesJob(owner,lease);
    const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}});
    expect(saved).toMatchObject({attemptCount:count<=6?1:2,status:count<=6?'PENDING':'FAILED',leaseOwner:null,result:{automation:marker.automation,learning:marker.learning,infrastructure:{deferrals:count,lastCode:lease.code}}});
    await expect(service.failPlacesJob(owner,lease)).rejects.toThrow('PLACES_LEASE_LOST');
    if(count<=6){expect(saved.nextAttemptAt!.getTime()-Date.now()).toBeGreaterThan(55_000);expect(await service.claimPlacesJob(owner,{postId:'worker-post'},dependencies)).toBeNull();await db.placeAnalysisJob.update({where:{id:job.id},data:{nextAttemptAt:new Date(0)}});}
   }
 });
 it('persists provider cooldown across claims even if an individual job is ready',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   await service.failPlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,code:'INFERENCE_BUSY',retryAfterMs:120_000});
   const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});expect(saved.nextAttemptAt!.getTime()-Date.now()).toBeGreaterThan(119_000);
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{nextAttemptAt:new Date(0),status:'FAILED'}});
   expect(await service.retryPlacesJob(owner,{jobId:claim.jobId,postId:'worker-post',inputHash:claim.input.input_hash,repairInfrastructure:true})).toEqual({requeued:true});
   expect(await service.claimPlacesJob(owner,{},dependencies)).toBeNull();
   const result=saved.result as Record<string,unknown>;
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{result:{...result,infrastructure:{deferrals:1,providerBlockedUntil:new Date(0).toISOString()}}}});
   expect(await service.claimPlacesJob(owner,{},dependencies)).not.toBeNull();
 });
 it('repairs a named infrastructure failure once without resetting attempts or protected history',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
   const history={automation:{version:1,source:'sync',syncJobId:'sync'},learning:{version:1,shape:'image:short:single',outcomes:[{attempt:3,status:'FAILED',code:'MEDIA_UNAVAILABLE',strategy:'standard'}]}};
   await db.placeAnalysisJob.update({where:{id:job.id},data:{status:'FAILED',stage:'COMPLETE',attemptCount:3,errorCode:'MEDIA_UNAVAILABLE',result:history}});
   const command={jobId:job.id,postId:job.postId,inputHash:job.inputHash,repairInfrastructure:true};
   await expect(service.retryPlacesJob(other,command)).rejects.toThrow('PLACES_JOB_NOT_FOUND');
   await expect(service.retryPlacesJob(owner,{...command,inputHash:'0'.repeat(64)})).rejects.toThrow('PLACES_INPUT_STALE');
   expect(await service.retryPlacesJob(owner,{...command,repairInfrastructure:false})).toEqual({requeued:false});
   const replies=await Promise.all([service.retryPlacesJob(owner,command),service.retryPlacesJob(owner,command)]);
   expect(replies.filter(r=>r.requeued)).toHaveLength(1);
   expect(await db.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({status:'PENDING',attemptCount:3,maxAttempts:6,result:history});
   const claim=(await service.claimPlacesJob(owner,{postId:'worker-post',learning:true},dependencies))!;
   await service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},dependencies);
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:false});
   const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}});
   expect(saved).toMatchObject({attemptCount:4,status:'SUCCEEDED'});
   expect((saved.result as {learning:{outcomes:unknown[]}}).learning.outcomes).toContainEqual(expect.objectContaining({attempt:4,status:'SUCCEEDED'}));
   await db.placeAnalysisJob.update({where:{id:job.id},data:{status:'FAILED',errorCode:'MEDIA_UNAVAILABLE'}});
   expect(await service.retryPlacesJob(owner,command)).toEqual({requeued:false});
 });
 it('refuses infrastructure repair when the owner has excluded the post',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
   await db.placeAnalysisJob.update({where:{id:job.id},data:{status:'FAILED',attemptCount:3,errorCode:'MEDIA_UNAVAILABLE'}});
   await db.placeEvidence.create({data:{ownerId:owner,postId:job.postId,analysisJobId:job.id,evidenceType:'USER_CORRECTION',excerpt:'No place',confidence:1,metadata:{action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:owner}}});
   await expect(service.retryPlacesJob(owner,{jobId:job.id,postId:job.postId,inputHash:job.inputHash,repairInfrastructure:true})).rejects.toThrow('POST_NOT_PLACES_ELIGIBLE');
 });
 it('coalesces concurrent completion across module instances before any repeated provider work',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   vi.resetModules();const independent=await import('@/server/places/worker');
   const started=deferred(),release=deferred(),duplicate=deferred();let calls=0;
   const slow:PlaceResolver={resolve:async input=>{if(++calls===1)started.release();else duplicate.release();await release.promise;return resolver.resolve(input);}};
   const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result};
   const first=service.completePlacesJob(owner,command,{...dependencies,resolver:slow});
   await started.promise;
   const second=independent.completePlacesJob(owner,command,{...dependencies,resolver:slow});
   let replies:Awaited<typeof first>[]=[];
   try{
     await Promise.race([duplicate.promise,new Promise(resolve=>setTimeout(resolve,150))]);
     expect(calls).toBe(1);
   }finally{release.release();replies=await Promise.all([first,second]);}
   expect(replies[1]).toEqual(replies[0]);
   expect(await independent.completePlacesJob(owner,command,{...dependencies,resolver:slow})).toEqual(replies[0]);
   expect(calls).toBe(1);
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(2);
 });
 it('rejects a divergent payload while its original completion is resolving',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const started=deferred(),release=deferred();
   const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result};
   const first=service.completePlacesJob(owner,command,{...dependencies,resolver:{resolve:async input=>{started.release();await release.promise;return resolver.resolve(input);}}});
   await started.promise;
   try{
     await expect(service.completePlacesJob(owner,{...command,result:{...result,elapsedMs:1001}},dependencies)).rejects.toThrow('PLACES_JOB_CONFLICT');
   }finally{release.release();await Promise.allSettled([first]);}
 });
 it('releases only its own failed computation for an immediate retry without refunding metadata',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const metadata={automation:{source:'sync'},googleUsage:{month:'2026-10',requests:2}};
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{result:metadata}});
   const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result};
   await expect(service.completePlacesJob(owner,command,{...dependencies,resolver:{resolve:async()=>{throw Error('GEOAPIFY_UNAVAILABLE');}}})).rejects.toThrow('GEOAPIFY_UNAVAILABLE');
   polling.fast=true;
   try{expect(await service.completePlacesJob(owner,command,dependencies)).toMatchObject({status:'SUCCEEDED',placesPersisted:1});}
   finally{polling.fast=false;}
   const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   expect(saved.result).toMatchObject(metadata);
   expect(saved.result).not.toHaveProperty('completionInProgress');
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(2);
 });
 it('keeps a crashed computation owned until lease reclaim and bounds identical follower waits',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result};
   // A terminated process cannot run its catch/finally. Seed its durable,
   // already-admitted state to exercise recovery independently of HTTP errors.
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{result:{completionInProgress:{
     requestHash:createHash('sha256').update(JSON.stringify(workerResultSchema.parse(result))).digest('hex'),
     leaseHash:createHash('sha256').update(JSON.stringify(claim.leaseToken)).digest('hex'),token:randomUUID(),
   }}}});
   let repeatedCalls=0;
   polling.fast=true;
   try{await expect(service.completePlacesJob(owner,command,{...dependencies,resolver:{resolve:async input=>{repeatedCalls++;return resolver.resolve(input);}}})).rejects.toThrow('PLACES_COMPLETION_PENDING');}
   finally{polling.fast=false;}
   expect(repeatedCalls).toBe(0);
   expect(await service.claimPlacesJob(owner,{},dependencies)).toBeNull();
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{leaseExpiresAt:new Date(0)}});
   const resumed=(await service.claimPlacesJob(owner,{},dependencies))!;
   expect(resumed.leaseToken).not.toBe(claim.leaseToken);
   expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).result).not.toHaveProperty('completionInProgress');
   await expect(service.completePlacesJob(owner,command,dependencies)).rejects.toThrow('PLACES_LEASE_LOST');
   expect(await service.completePlacesJob(owner,{...command,leaseToken:resumed.leaseToken},dependencies)).toMatchObject({status:'SUCCEEDED',placesPersisted:1});
 });
 it('rejects a replaced computation token and preserves the replacement through failure cleanup',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const replacement=randomUUID();
   const attempt=service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result},{...dependencies,resolver:{resolve:async input=>{
     const saved=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
     const metadata=saved.result as {completionInProgress:{requestHash:string;leaseHash:string;token:string}};
     await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{result:{...metadata,completionInProgress:{...metadata.completionInProgress,token:replacement}}}});
     return resolver.resolve(input);
   }}});
   await expect(attempt).rejects.toThrow('PLACES_LEASE_LOST');
   expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).result).toMatchObject({completionInProgress:{token:replacement}});
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(0);
 });
 it('fences a former producer before its next candidate after reclaim',async()=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const started=deferred(),release=deferred();let calls=0;
   const old=service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:{...result,candidates:[result.candidates[0],result.candidates[0]]}},
     {...dependencies,resolver:{resolve:async input=>{calls++;started.release();await release.promise;return resolver.resolve(input);}}});
   // Attach rejection handling immediately so losing a lease is never unhandled.
   const settled=old.then(value=>({value,error:null}),error=>({value:null,error}));
   await started.promise;
   await db.placeAnalysisJob.update({where:{id:claim.jobId},data:{leaseExpiresAt:new Date(0)}});
   const resumed=(await service.claimPlacesJob(owner,{},dependencies))!;
   const receipt=await service.completePlacesJob(owner,{jobId:resumed.jobId,leaseToken:resumed.leaseToken,result},dependencies);
   release.release();
   expect((await settled).error?.message).toBe('PLACES_LEASE_LOST');
   expect(calls).toBe(1);
   expect(receipt.placesPersisted).toBe(1);
   expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).result).toMatchObject({completion:{receipt}});
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(2);
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
 it.each(['preview','complete'] as const)('rejects missing scope evidence in %s before provider work or writes',async operation=>{
   await service.enqueuePlacesPosts(owner,{postId:'worker-post'});
   const claim=(await service.claimPlacesJob(owner,{},dependencies))!;
   const invalid={...result,candidates:[{...result.candidates[0],locationScope:{kind:'CITY',evidenceIndex:1}}]};
   // Historical source payloads remain readable for evidence-preserving recovery.
   expect(workerResultSchema.safeParse(invalid).success).toBe(true);
   const resolve=vi.fn(resolver.resolve),deps={...dependencies,resolver:{resolve}};
   const auditCount=await db.auditEvent.count({where:{ownerId:owner}});
   const before=await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}});
   const attempt=operation==='preview'
     ?service.previewPlacesResult(owner,{postId:'worker-post',inputHash:claim.input.input_hash,result:invalid},deps)
     :service.completePlacesJob(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:invalid},deps);
   await expect(attempt).rejects.toThrow('PLACES_EVIDENCE_INVALID');
   expect(resolve).not.toHaveBeenCalled();
   expect(await db.placeAnalysisJob.findUniqueOrThrow({where:{id:claim.jobId}})).toEqual(before);
   expect(await db.auditEvent.count({where:{ownerId:owner}})).toBe(auditCount);
   expect(await db.place.count({where:{ownerId:owner}})).toBe(0);
   expect(await db.postPlace.count({where:{ownerId:owner}})).toBe(0);
   expect(await db.placeEvidence.count({where:{ownerId:owner}})).toBe(0);
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
