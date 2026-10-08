// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
vi.mock('server-only',()=>({}));
const url=process.env.TEST_DATABASE_URL,owner='translation-'+randomUUID();
let db:PrismaClient,service:typeof import('@/server/classification/translation-jobs');
const caption='Mezcla 200 g de harina. @chef #receta';
const result={decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:'Mélanger 200 g de farine. @chef #receta',reason:'Spanish recipe',model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:40,outputTokens:30},elapsedMs:50};
async function seed(){return db.post.create({data:{ownerId:owner,postUrl:'https://www.instagram.com/p/'+randomUUID().replaceAll('-',''),thumbnailUrl:'https://example.test/a.jpg',authorUsername:'chef',authorSortKey:'chef',caption,mainTheme:'Salé',searchText:'original'}});}
async function enqueue(id:string){await db.$transaction(tx=>service.enqueueCaptionTranslation(owner,id,tx));}
async function clear(){await db.post.deleteMany({where:{ownerId:owner}});await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await db.tag.deleteMany({where:{ownerId:owner}});}
(url?describe:describe.skip)('Caption translation durable lifecycle',()=>{
 beforeAll(async()=>{process.env.DATABASE_URL=url;({prisma:db}=await import('@/server/db'));service=await import('@/server/classification/translation-jobs');});
 beforeEach(clear);afterAll(async()=>{await clear();await db.$disconnect();});
 it('enqueues once, claims exclusively, saves/replays without changing source, tags or classification input',async()=>{
  const post=await seed();const tag=await db.tag.create({data:{ownerId:owner,name:'Personnel',slug:'personnel'}});await db.postTag.create({data:{postId:post.id,tagId:tag.id,isManual:true}});
  const {classificationInputs}=await import('@/server/classification/inputs');const before=await classificationInputs(owner,post.id);
  await enqueue(post.id);await enqueue(post.id);expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(1);
  const claims=await Promise.all([service.claimCaptionTranslation(owner),service.claimCaptionTranslation(owner)]);expect(claims.filter(Boolean)).toHaveLength(1);const claim=claims.find(Boolean)!;
  const cmd={jobId:claim.jobId,leaseToken:claim.leaseToken,result};const receipt=await service.completeCaptionTranslation(owner,cmd);expect(await service.completeCaptionTranslation(owner,cmd)).toEqual(receipt);
  expect((await classificationInputs(owner,post.id)).inputHash).toBe(before.inputHash);expect(await db.post.findUniqueOrThrow({where:{id:post.id}})).toEqual(post);expect(await db.postTag.count({where:{postId:post.id,isManual:true}})).toBe(1);
  await enqueue(post.id);expect(await service.claimCaptionTranslation(owner)).toBeNull();await expect(service.completeCaptionTranslation('foreign',cmd)).rejects.toThrow();
  const {getLibraryPost}=await import('@/server/library');expect(await getLibraryPost(post.id,owner)).toMatchObject({caption,captionTranslation:{text:result.translatedCaption,sourceLanguages:['es']}});
 });
 it.each(['edit','delete','expired'])('fences a %s while inference is running',async change=>{
  const post=await seed();await enqueue(post.id);const c=(await service.claimCaptionTranslation(owner))!;
  if(change==='edit'){await db.post.update({where:{id:post.id},data:{caption:'Nueva receta'}});await enqueue(post.id);}
  if(change==='delete')await db.post.delete({where:{id:post.id}});
  if(change==='expired')await db.postClassificationJob.update({where:{id:c.jobId},data:{leaseExpiresAt:new Date(0)}});
  await expect(service.completeCaptionTranslation(owner,{jobId:c.jobId,leaseToken:c.leaseToken,result})).rejects.toThrow();
  if(change==='edit'){const next=(await service.claimCaptionTranslation(owner))!;expect(next.input.caption).toBe('Nueva receta');expect(next.leaseToken).not.toBe(c.leaseToken);}
 });
 it('keeps French/English unchanged and rejects protected-token changes',async()=>{
  const post=await seed();await enqueue(post.id);const c=(await service.claimCaptionTranslation(owner))!;
  await expect(service.completeCaptionTranslation(owner,{jobId:c.jobId,leaseToken:c.leaseToken,result:{...result,translatedCaption:'Mélanger 300 g'}})).rejects.toThrow('TRANSLATION_TOKENS_CHANGED');
  await db.post.update({where:{id:post.id},data:{caption:'Mix 200 g of flour. @chef #receta'}});await enqueue(post.id);const english=(await service.claimCaptionTranslation(owner))!;
  await service.completeCaptionTranslation(owner,{jobId:english.jobId,leaseToken:english.leaseToken,result:{...result,decision:'UNCHANGED',sourceLanguages:['en'],translatedCaption:null,reason:'English'}});
  const {getLibraryPost}=await import('@/server/library');expect((await getLibraryPost(post.id,owner))?.captionTranslation).toBeUndefined();
 });
 it('isolates classification maintenance and bounds translation retries',async()=>{
  const post=await seed();await enqueue(post.id);const job=await db.postClassificationJob.findFirstOrThrow({where:{ownerId:owner}});
  await db.postClassificationJob.update({where:{id:job.id},data:{attemptCount:3}});
  const {claimClassification}=await import('@/server/classification/jobs');expect(await claimClassification(owner)).toBeNull();expect((await db.postClassificationJob.findUniqueOrThrow({where:{id:job.id}})).status).toBe('PENDING');
  expect(await service.claimCaptionTranslation(owner)).toBeNull();expect((await db.postClassificationJob.findUniqueOrThrow({where:{id:job.id}})).status).toBe('FAILED');
 });
});
