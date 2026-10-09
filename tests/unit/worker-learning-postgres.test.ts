// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const url=process.env.TEST_DATABASE_URL,owner='learning-'+randomUUID(),other='learning-other-'+randomUUID();
let db:PrismaClient,learning:typeof import('@/server/classification/learning'),admin:typeof import('@/server/admin-library');
async function post(caption='Brownie chocolat pistache maison',ownerId=owner){return db.post.create({data:{ownerId,postUrl:'https://www.instagram.com/p/'+randomUUID().replaceAll('-',''),thumbnailUrl:'https://example.test/a.jpg',authorUsername:'chef',authorSortKey:'chef',caption,mainTheme:'Cuisine',searchText:'source'}});}
async function clear(){await db.importJob.deleteMany({where:{ownerId:{in:[owner,other]}}});await db.post.deleteMany({where:{ownerId:{in:[owner,other]}}});await db.postClassificationJob.deleteMany({where:{ownerId:{in:[owner,other]}}});await db.tag.deleteMany({where:{ownerId:{in:[owner,other]}}});}
(url?describe:describe.skip)('Verified worker memory',()=>{
 beforeAll(async()=>{vi.stubEnv('DATABASE_URL',url!);({prisma:db}=await import('@/server/db'));learning=await import('@/server/classification/learning');admin=await import('@/server/admin-library');});
 beforeEach(clear);afterAll(async()=>{await clear();vi.unstubAllEnvs();await db.$disconnect();});
 it('learns explicit tag edits only and ignores imported manual flags, wrong owners, revoked and stale examples',async()=>{
  const source=await post(),target=await post('Brownie chocolat pistache fondant'),foreign=await post('Brownie chocolat pistache ailleurs',other);
  const imported=await db.tag.create({data:{ownerId:owner,name:'Ancien import',slug:'ancien-import'}});await db.postTag.create({data:{postId:source.id,tagId:imported.id,isManual:true}});
  expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([]);
  await admin.addTagToPost({ownerId:owner,postId:source.id,tagName:'Pistache'});
  await admin.addTagToPost({ownerId:other,postId:foreign.id,tagName:'Autre propriétaire'});
  let context=await learning.loadLearningContext(db,owner,target.id,'classification');expect(context.examples).toHaveLength(1);expect(context.examples[0]).toMatchObject({kind:'tags',tags:['Pistache'],avoidTags:[]});
  await admin.removeTagFromPost({ownerId:owner,postId:source.id,tagName:'Pistache'});context=await learning.loadLearningContext(db,owner,target.id,'classification');expect(context.examples[0]).toMatchObject({tags:[],avoidTags:['Pistache']});
  await learning.revokeWorkerLearning(owner,source.id,'classification');expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([]);
  await admin.addTagToPost({ownerId:owner,postId:source.id,tagName:'Chocolat'});await db.post.update({where:{id:source.id},data:{caption:'Brownie chocolat pistache contenu changé'}});expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([]);
  await admin.addTagToPost({ownerId:owner,postId:source.id,tagName:'Brownie'});expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([]);
  await db.post.delete({where:{id:source.id}});expect(await db.workerLearningExample.count({where:{postId:source.id}})).toBe(0);
 });
 it('requires current owner-scoped source identity for reviewed classifications and translations',async()=>{
  const p=await post(),state=await learning.getLearningReview(owner,p.id);const original=p.caption;
  const correction={domain:'classification' as const,sourceHash:state.classificationSourceHash,mainTheme:'Sucré',tags:['Brownie','Chocolat','Pistache']};
  await expect(learning.reviewWorkerLearning(other,p.id,correction)).rejects.toThrow('NOT_FOUND');
  await expect(learning.reviewWorkerLearning(owner,p.id,{...correction,sourceHash:'0'.repeat(64)})).rejects.toThrow('LEARNING_SOURCE_STALE');
  await learning.reviewWorkerLearning(owner,p.id,correction);expect((await db.post.findUniqueOrThrow({where:{id:p.id}})).mainTheme).toBe('Sucré');
  expect((await db.postTag.findMany({where:{postId:p.id}})).every(t=>t.isManual)).toBe(true);
  expect((await db.post.findUniqueOrThrow({where:{id:p.id}})).caption).toBe(original);
  const es=await post('Mezcla 200 g de harina.');const info=await learning.getLearningReview(owner,es.id);
  await expect(learning.reviewWorkerLearning(owner,es.id,{domain:'translation',sourceHash:info.translationSourceHash,decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:'Mélangez 300 g de farine.'})).rejects.toThrow('TRANSLATION_TOKENS_CHANGED');
  await learning.reviewWorkerLearning(owner,es.id,{domain:'translation',sourceHash:info.translationSourceHash,decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:'Mélangez 200 g de farine.'});
  expect(await db.workerLearningExample.count({where:{ownerId:owner,postId:es.id,provenance:'MANUAL_REVIEW'}})).toBe(1);
  expect((await db.post.findUniqueOrThrow({where:{id:es.id}})).caption).toBe(es.caption);
 });
 it('keeps all removal guards and suppresses a superseded classification example',async()=>{
  const p=await post(),target=await post('Brownie chocolat pistache fondant');const state=await learning.getLearningReview(owner,p.id);
  await learning.reviewWorkerLearning(owner,p.id,{domain:'classification',sourceHash:state.classificationSourceHash,mainTheme:'Sucré',tags:['Brownie','Chocolat','Pistache']});
  await admin.addTagToPost({ownerId:owner,postId:target.id,tagName:'Pistache'});
  await admin.removeTagFromPost({ownerId:owner,postId:p.id,tagName:'Pistache'});
  expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([expect.objectContaining({kind:'tags',avoidTags:['Pistache']})]);
  await learning.reviewWorkerLearning(owner,p.id,{domain:'classification',sourceHash:(await learning.getLearningReview(owner,p.id)).classificationSourceHash,mainTheme:'Sucré',tags:['Brownie','Chocolat','Pistache']});
  await admin.addTagToPost({ownerId:owner,postId:p.id,tagName:'Noisette'});expect((await learning.loadLearningContext(db,owner,target.id,'classification')).examples).toEqual([expect.objectContaining({kind:'tags',avoidTags:[]})]);
  await admin.removeTagFromPost({ownerId:owner,postId:p.id,tagName:'Pistache'});
  for(let i=0;i<21;i++)await admin.removeTagFromPost({ownerId:owner,postId:p.id,tagName:'Retiré '+i});
  expect((await learning.manualClassificationGuards(db,owner,p.id)).avoidTags).toContain('pistache');
 });
 it('records each lease once, learns a bounded recovery strategy and rejects stale completion',async()=>{
  const jobs=await import('@/server/classification/translation-jobs');
  const make=async()=>{const p=await post('Mezcla harina con chocolate.');await db.$transaction(tx=>jobs.enqueueCaptionTranslation(owner,p.id,tx));return (await jobs.claimCaptionTranslation(owner,true))!;};
  const report={version:1 as const,strategy:'standard' as const,exampleIds:[],signals:['SOURCE_FIDELITY' as const],elapsedMs:30,inputTokens:10,outputTokens:5};
  const result={decision:'TRANSLATED',sourceLanguages:['es'],translatedCaption:'Mélangez la farine avec le chocolat.',reason:'Spanish',model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:10,outputTokens:5},elapsedMs:30};
  const first=await make();expect(first.learningContext?.strategy).toBe('standard');
  const command={jobId:first.jobId,leaseToken:first.leaseToken,result,learning:report};
  await jobs.completeCaptionTranslation(owner,command);await jobs.completeCaptionTranslation(owner,command);
  expect(await db.workerLearningObservation.count({where:{ownerId:owner}})).toBe(1);
  const second=await make();await jobs.failCaptionTranslation(owner,{jobId:second.jobId,leaseToken:second.leaseToken,code:'INVALID_RESULT',learning:report});
  const third=await make();expect(third.learningContext?.strategy).toBe('preserve_source');
  await db.postClassificationJob.update({where:{id:third.jobId},data:{leaseExpiresAt:new Date(0)}});
  await expect(jobs.completeCaptionTranslation(owner,{...command,jobId:third.jobId,leaseToken:third.leaseToken})).rejects.toThrow('CLASSIFICATION_LEASE_LOST');
  expect(await db.workerLearningObservation.count({where:{ownerId:owner}})).toBe(2);
  const evaluation=await import('@/server/classification/learning-evaluation');const reportOut=await evaluation.evaluateWorkerLearning(owner);
  expect(reportOut.domains.find(d=>d.domain==='translation')).toMatchObject({attempts:2,jobs:2,latestOutcomes:{SUCCEEDED:1,FAILED:1}});
  expect(reportOut.semanticAccuracy).toBe('UNKNOWN_REQUIRES_VERIFIED_EVALUATION');
 });
 it('preserves explicit theme and removed tags even after the memory is revoked',async()=>{
  const jobs=await import('@/server/classification/jobs');const p=await post();
  const state=await learning.getLearningReview(owner,p.id);await learning.reviewWorkerLearning(owner,p.id,{domain:'classification',sourceHash:state.classificationSourceHash,mainTheme:'Sucré',tags:['Brownie','Chocolat','Pistache']});
  await admin.removeTagFromPost({ownerId:owner,postId:p.id,tagName:'Pistache'});await learning.revokeWorkerLearning(owner,p.id,'classification');
  const media=await db.postMedia.create({data:{ownerId:owner,postId:p.id,type:'IMAGE',position:0,sourcePath:'test.jpg',objectKey:'originals/test.jpg',mimeType:'image/jpeg',byteSize:100,identityState:'VERIFIED'}});
  await db.$transaction(tx=>jobs.enqueueClassification(owner,p.id,tx));const claim=(await jobs.claimClassification(owner,{learning:true,signMedia:async()=> 'https://test.r2.cloudflarestorage.com/test.jpg'}))!;
  await jobs.completeClassification(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,result:{status:'SUCCEEDED',mainTheme:'Cuisine',tags:['Brownie','Chocolat','Pistache'],reason:'Recipe',media:[{mediaId:media.id,kind:'IMAGE',durationMs:null,frameCount:1,audio:'not_applicable'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:1,outputTokens:1},elapsedMs:1}});
  const saved=await db.post.findUniqueOrThrow({where:{id:p.id},include:{postTags:{include:{tag:true}}}});expect(saved.mainTheme).toBe('Sucré');expect(saved.postTags.map(t=>t.tag.name)).not.toContain('Pistache');
 });

 it('keeps manual corrections through imports and ignores failures for stale sources',async()=>{
  const p=await post();const state=await learning.getLearningReview(owner,p.id);await learning.reviewWorkerLearning(owner,p.id,{domain:'classification',sourceHash:state.classificationSourceHash,mainTheme:'Sucré',tags:['Brownie','Chocolat','Pistache']});await admin.removeTagFromPost({ownerId:owner,postId:p.id,tagName:'Pistache'});
  const {importPosts}=await import('@/server/import-posts');await importPosts([{post_url:p.postUrl,username:'chef',caption:p.caption,thumbnail_url:p.thumbnailUrl,content_type:'image',main_theme:'Cuisine',tags:['Pistache','Autre']}],{ownerId:owner});
  const current=await db.post.findUniqueOrThrow({where:{id:p.id},include:{postTags:{include:{tag:true}}}});expect(current.mainTheme).toBe('Sucré');expect(current.postTags.map(t=>t.tag.name)).not.toContain('Pistache');
  const jobs=await import('@/server/classification/translation-jobs');await db.$transaction(tx=>jobs.enqueueCaptionTranslation(owner,p.id,tx));const claim=(await jobs.claimCaptionTranslation(owner,true))!;
  await db.post.update({where:{id:p.id},data:{caption:'New caption'}});await jobs.failCaptionTranslation(owner,{jobId:claim.jobId,leaseToken:claim.leaseToken,code:'INVALID_RESULT',learning:{version:1,strategy:'standard',exampleIds:[],signals:['FORMAT'],elapsedMs:1,inputTokens:1,outputTokens:1}});
  expect(await db.workerLearningObservation.count({where:{ownerId:owner}})).toBe(0);
 });

});
