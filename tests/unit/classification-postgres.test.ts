// @vitest-environment node
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
vi.mock('server-only',()=>({}));
const url=process.env.TEST_DATABASE_URL;const suite=url?describe:describe.skip;
let db:PrismaClient,service:typeof import('@/server/classification/jobs');
const owner='classification-test';const signer=async()=> 'https://test.r2.cloudflarestorage.com/bucket/originals/test.jpg';
const result={status:'SUCCEEDED',mainTheme:'Sucré',tags:['Chocolat','Brownie','Recette protéinée'],reason:'Chocolate brownie recipe',media:[{mediaId:'classification-media',kind:'IMAGE',durationMs:null,frameCount:1,audio:'not_applicable'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:100,outputTokens:50},elapsedMs:100};
async function seed(){await db.post.create({data:{id:'classification-post',ownerId:owner,postUrl:'https://www.instagram.com/p/ClassifyOne',thumbnailUrl:'https://example.test/t.jpg',authorUsername:'baker',authorSortKey:'baker',caption:'Brownie au chocolat',searchText:'brownie',mainTheme:'Divers',media:{create:{id:'classification-media',ownerId:owner,type:'IMAGE',position:0,sourcePath:'test.jpg',objectKey:'originals/test.jpg',mimeType:'image/jpeg',byteSize:100,identityState:'VERIFIED'}}}});}
async function queue(){await db.$transaction(tx=>service.enqueueClassification(owner,'classification-post',tx));}
async function clear(){await db.post.deleteMany({where:{ownerId:owner}});await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await db.tag.deleteMany({where:{ownerId:owner}});}
suite('Classification transactional queue',()=>{
 beforeAll(async()=>{process.env.DATABASE_URL=url;({prisma:db}=await import('@/server/db'));service=await import('@/server/classification/jobs');});
 beforeEach(async()=>{await clear();await seed();});afterAll(async()=>{await clear();await db.$disconnect();});
 it('queues once, claims once under contention and completes/replays atomically with canonical existing tags',async()=>{
  await db.tag.create({data:{ownerId:owner,name:'CHOCOLAT',slug:'chocolat'}});await queue();await queue();
  expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(1);
  const claims=await Promise.all([service.claimClassification(owner,{signMedia:signer}),service.claimClassification(owner,{signMedia:signer})]);expect(claims.filter(Boolean)).toHaveLength(1);const claim=claims.find(Boolean)!;
  expect(await service.claimClassification('other',{signMedia:signer})).toBeNull();
  const command={jobId:claim.jobId,leaseToken:claim.leaseToken,result};const receipt=await service.completeClassification(owner,command);
  expect(await service.completeClassification(owner,command)).toEqual(receipt);
  const post=await db.post.findUniqueOrThrow({where:{id:'classification-post'},include:{postTags:{include:{tag:true}}}});expect(post.mainTheme).toBe('Sucré');expect(post.postTags.map(x=>x.tag.name)).toContain('CHOCOLAT');expect(post.postTags).toHaveLength(3);expect(post.searchText).toContain('chocolat');
  await expect(service.completeClassification('other',command)).rejects.toThrow();
 });
 it('rolls back enqueue with its import and leaves review results without changing provisional classification',async()=>{
  await expect(db.$transaction(async tx=>{await service.enqueueClassification(owner,'classification-post',tx);throw Error('ROLLBACK');})).rejects.toThrow('ROLLBACK');expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(0);
  await queue();const c=(await service.claimClassification(owner,{signMedia:signer}))!;
  await service.completeClassification(owner,{jobId:c.jobId,leaseToken:c.leaseToken,result:{...result,status:'NEEDS_REVIEW',mainTheme:null,tags:[],reason:'Insufficient context'}});
  expect((await db.post.findUniqueOrThrow({where:{id:'classification-post'}})).mainTheme).toBe('Divers');expect((await db.postClassificationJob.findUniqueOrThrow({where:{id:c.jobId}})).status).toBe('NEEDS_REVIEW');
 });
 it.each(['edit','manual','delete','expiry'])('fences %s after inference without overwriting user data',async change=>{
  await queue();const c=(await service.claimClassification(owner,{signMedia:signer}))!;
  if(change==='edit')await db.post.update({where:{id:'classification-post'},data:{mainTheme:'Sport'}});
  if(change==='manual'){const tag=await db.tag.create({data:{ownerId:owner,name:'Personnel',slug:'personnel'}});await db.postTag.create({data:{postId:'classification-post',tagId:tag.id,isManual:true}});}
  if(change==='delete')await db.post.delete({where:{id:'classification-post'}});
  if(change==='expiry')await db.postClassificationJob.update({where:{id:c.jobId},data:{leaseExpiresAt:new Date(0)}});
  await expect(service.completeClassification(owner,{jobId:c.jobId,leaseToken:c.leaseToken,result})).rejects.toThrow();
  expect(await db.post.count({where:{ownerId:owner,mainTheme:'Sucré'}})).toBe(0);
  if(change==='manual')expect(await db.postTag.count({where:{postId:'classification-post',isManual:true}})).toBe(1);
  if(change==='delete')expect((await db.postClassificationJob.findUniqueOrThrow({where:{id:c.jobId}})).status).toBe('CANCELLED');
 });
 it('detects same-value manual promotion and preserves manual extras present before enqueue',async()=>{
  const admin=await import('@/server/admin-library');const tag=await db.tag.create({data:{ownerId:owner,name:'Chocolat',slug:'chocolat'}});await db.postTag.create({data:{postId:'classification-post',tagId:tag.id,isManual:false}});await queue();const c=(await service.claimClassification(owner,{signMedia:signer}))!;
  await admin.addTagToPost({ownerId:owner,postId:'classification-post',tagName:'Chocolat'});
  await expect(service.completeClassification(owner,{jobId:c.jobId,leaseToken:c.leaseToken,result})).rejects.toThrow('CLASSIFICATION_INPUT_STALE');
  expect((await db.postTag.findUniqueOrThrow({where:{postId_tagId:{postId:'classification-post',tagId:tag.id}}})).isManual).toBe(true);
  await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await admin.addTagToPost({ownerId:owner,postId:'classification-post',tagName:'Personnel'});await queue();const next=(await service.claimClassification(owner,{signMedia:signer}))!;
  await service.completeClassification(owner,{jobId:next.jobId,leaseToken:next.leaseToken,result});expect(await db.postTag.count({where:{postId:'classification-post',isManual:true}})).toBe(2);expect(await db.postTag.count({where:{postId:'classification-post'}})).toBe(4);
 });
 it('resumes an expired lease and stops after three attempts with measured backoff and audit history',async()=>{
  await queue();const first=(await service.claimClassification(owner,{signMedia:signer}))!;
  await service.failClassification(owner,{...first,code:'INFERENCE_BUSY'});const pending=await db.postClassificationJob.findUniqueOrThrow({where:{id:first.jobId}});expect(pending.nextAttemptAt!.getTime()-Date.now()).toBeGreaterThan(55_000);expect(await service.claimClassification(owner,{signMedia:signer})).toBeNull();
  await db.postClassificationJob.update({where:{id:first.jobId},data:{nextAttemptAt:new Date(0)}});const second=(await service.claimClassification(owner,{signMedia:signer}))!;
  await db.postClassificationJob.update({where:{id:first.jobId},data:{leaseExpiresAt:new Date(0)}});const third=(await service.claimClassification(owner,{signMedia:signer}))!;expect(third.leaseToken).not.toBe(second.leaseToken);
  await expect(service.heartbeatClassification(owner,{jobId:first.jobId,leaseToken:second.leaseToken})).rejects.toThrow('CLASSIFICATION_LEASE_LOST');await service.failClassification(owner,{...third,code:'INFERENCE_BUSY'});expect((await db.postClassificationJob.findUniqueOrThrow({where:{id:first.jobId}})).status).toBe('FAILED');expect(await service.claimClassification(owner,{signMedia:signer})).toBeNull();
  expect(await db.auditEvent.count({where:{ownerId:owner,tableName:'post_classification_jobs'}})).toBeGreaterThan(3);
 });
 it.each(['rename','merge','delete'])('serializes global tag %s with completion and fences its changed inputs',async action=>{
  const admin=await import('@/server/admin-insights'),locks=await import('@/server/post-deletions');
  const tag=await db.tag.create({data:{ownerId:owner,name:'Chocolat',slug:'chocolat'}}),target=await db.tag.create({data:{ownerId:owner,name:'Cacao',slug:'cacao'}});await db.postTag.create({data:{postId:'classification-post',tagId:tag.id,isManual:false}});await queue();const claim=(await service.claimClassification(owner,{signMedia:signer}))!;
  const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>();const gate=db.$transaction(async tx=>{await locks.lockPostWrites(tx,owner);const [{pid}]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;ready.resolve(pid);await release.promise;},{timeout:10_000});let changing:Promise<unknown>|undefined;
  try{const blocker=await ready.promise;changing=action==='rename'?admin.renameAdminTag(owner,tag.id,'Cacao nouveau'):action==='merge'?admin.mergeAdminTags(owner,tag.id,target.id):admin.deleteAdminTag(owner,tag.id);
   await expect.poll(async()=>{const [{count}]=await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE ${blocker}=ANY(pg_blocking_pids(pid))`;return Number(count);},{timeout:1500}).toBe(1);
  }finally{release.resolve();await Promise.allSettled([gate,changing]);}
  await expect(service.completeClassification(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result})).rejects.toThrow('CLASSIFICATION_INPUT_STALE');expect((await db.post.findUniqueOrThrow({where:{id:'classification-post'}})).mainTheme).toBe('Divers');
 });
 it('cannot recreate a catalog tag deleted manually during inference, even when initially unassigned',async()=>{
  const admin=await import('@/server/admin-insights');const tag=await db.tag.create({data:{ownerId:owner,name:'Chocolat',slug:'chocolat'}});await queue();const claim=(await service.claimClassification(owner,{signMedia:signer}))!;await admin.deleteAdminTag(owner,tag.id);
  await expect(service.completeClassification(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result})).rejects.toThrow('CLASSIFICATION_INPUT_STALE');expect(await db.tag.count({where:{ownerId:owner,slug:'chocolat'}})).toBe(0);
 });
});
