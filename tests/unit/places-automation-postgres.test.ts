// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
vi.mock('server-only',()=>({}));
vi.mock('@/server/r2',async original=>({...await original<typeof import('@/server/r2')>(),verifyR2Object:async()=>({contentType:'image/jpeg',etag:'test-etag'})}));
const url=process.env.TEST_DATABASE_URL,owner=`places-auto-${randomUUID()}`;
let db:PrismaClient,sync:typeof import('@/server/sync-post'),classification:typeof import('@/server/classification/jobs'),places:typeof import('@/server/places/worker');
const signer=async()=> 'https://test.r2.cloudflarestorage.com/bucket/originals/test.jpg';
function payload(code:string){return {external_id:code,post_url:`https://www.instagram.com/p/${code}/`,username:'example',caption:'Notre restaurant préféré à Paris',content_type:'image' as const,media:[{type:'image' as const,objectKey:`originals/example/${code}.jpg`,sourcePath:`example/${code}.jpg`,byteSize:100}]};}
async function session(){return db.syncJob.create({data:{ownerId:owner,leaseExpiresAt:new Date(Date.now()+300_000),runExpiresAt:new Date(Date.now()+3_600_000)}});}
async function finish(mainTheme='Restaurant'){
 const claim=(await classification.claimClassification(owner,{signMedia:signer}))!;
 const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result:{status:'SUCCEEDED',mainTheme,tags:['Paris','Brunch','Café'],reason:'A recommended restaurant',media:claim.media.map(m=>({mediaId:m.id,kind:m.kind,durationMs:null,frameCount:1,audio:'not_applicable'})),model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:100,outputTokens:50},elapsedMs:100}};
 await classification.completeClassification(owner,command);
 return {claim,command};
}
(url?describe:describe.skip)('Automatic sync → classification → Places admission',()=>{
 beforeAll(async()=>{vi.stubEnv('DATABASE_URL',url!);({prisma:db}=await import('@/server/db'));sync=await import('@/server/sync-post');classification=await import('@/server/classification/jobs');places=await import('@/server/places/worker');});
 beforeEach(()=>{for(const [key,value] of Object.entries({PLACES_AUTO_ENABLED:'1',CLASSIFICATION_WORKER_ENABLED:'1',MEDIA_PUBLIC_BASE_URL:'https://example.test/',MEDIA_PATH_PREFIX:'originals',R2_ENDPOINT:'https://test.r2.cloudflarestorage.com',R2_BUCKET_NAME:'test-bucket',R2_ACCESS_KEY_ID:'test-access',R2_SECRET_ACCESS_KEY:'test-secret'}))vi.stubEnv(key,value);});
 afterEach(async()=>{await db.post.deleteMany({where:{ownerId:owner}});await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await db.syncJob.deleteMany({where:{ownerId:owner}});await db.importJob.deleteMany({where:{ownerId:owner}});await db.tag.deleteMany({where:{ownerId:owner}});await db.deletedPost.deleteMany({where:{ownerId:owner}});});
 afterAll(async()=>{vi.unstubAllEnvs();await db.$disconnect();});
 it('admits once after final classification, fences concurrent claims and preserves sync provenance',async()=>{
  const run=await session();await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_NEW'));
  expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(0);
  vi.stubEnv('PLACES_AUTO_ENABLED','0');
  const {command}=await finish();await classification.completeClassification(owner,command);
  expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(1);
  expect(await places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer})).toBeNull();
  vi.stubEnv('PLACES_AUTO_ENABLED','1');
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_NEW'));
  expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(1);
  const job=await db.placeAnalysisJob.findFirstOrThrow({where:{ownerId:owner}});
  expect(job.result).toMatchObject({automation:{version:1,source:'sync',syncJobId:run.id}});
  const claims=await Promise.all([places.claimPlacesJob(owner,{scope:'automatic',learning:true},{signMedia:signer}),places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer})]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(claims.find(Boolean)?.input.internal_tags).toEqual(expect.arrayContaining(['Paris','Brunch','Café']));
  expect(await places.claimPlacesJob('other',{scope:'automatic'},{signMedia:signer})).toBeNull();
 });
 it('skips historical posts and noneligible final categories, but supports sync without classification',async()=>{
  const run=await session();vi.stubEnv('PLACES_AUTO_ENABLED','0');
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_OLD'));
  vi.stubEnv('PLACES_AUTO_ENABLED','1');await finish();
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_OLD'));
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_RECIPE'));await finish('Sucré');
  expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(0);
  const old=await db.post.findFirstOrThrow({where:{ownerId:owner,externalId:'AUTO_OLD'}});
  await places.enqueuePlacesPosts(owner,{postId:old.id});
  expect(await places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer})).toBeNull();
  vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','0');
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_DIRECT'));
  expect((await places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer}))?.input.caption).toBe(payload('AUTO_DIRECT').caption);
 });
 it('keeps the feature gate and owner no-place exclusion effective at admission and claim',async()=>{
  const run=await session();await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_EXCLUDED'));
  const post=await db.post.findFirstOrThrow({where:{ownerId:owner}});
  const source=await db.placeAnalysisJob.create({data:{ownerId:owner,postId:post.id,analysisVersion:'manual-review',inputHash:'manual',sourceTheme:'Restaurant'}});
  await db.placeEvidence.create({data:{ownerId:owner,postId:post.id,analysisJobId:source.id,evidenceType:'USER_CORRECTION',confidence:1,metadata:{action:'POST_NO_PLACE_CONFIRMED',actorType:'USER',actorId:owner}}});
  await finish();expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(1);
  await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('AUTO_OFF'));await finish();
  vi.stubEnv('PLACES_AUTO_ENABLED','0');expect(await places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer})).toBeNull();
  vi.stubEnv('PLACES_AUTO_ENABLED','1');expect(await places.claimPlacesJob(owner,{scope:'automatic'},{signMedia:signer})).not.toBeNull();
 });
});
