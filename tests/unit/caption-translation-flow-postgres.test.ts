// @vitest-environment node
import {randomUUID,createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {ClassificationHttpApi} from '../../services/worker/src/classification/api';
import {runCaptionTranslationOnce} from '../../services/worker/src/classification/translation-runner';
import {translateCaption} from '../../services/worker/src/classification/translation-inference';
vi.mock('server-only',()=>({}));
const url=process.env.TEST_DATABASE_URL,owner='translation-flow-'+randomUUID(),key='translation-integration-private-key';
let db:PrismaClient;
(url?describe:describe.skip)('Import → translation worker → library',()=>{
 beforeAll(async()=>{vi.stubEnv('DATABASE_URL',url!);({prisma:db}=await import('@/server/db'));for(const [k,v] of Object.entries({APP_OWNER_ID:owner,CAPTION_TRANSLATION_ENABLED:'1',CLASSIFICATION_WORKER_ENABLED:'1',CLASSIFICATION_WORKER_API_KEY_SHA256:createHash('sha256').update(key).digest('hex')}))vi.stubEnv(k,v);});
 afterAll(async()=>{await db.post.deleteMany({where:{ownerId:owner}});await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await db.importJob.deleteMany({where:{ownerId:owner}});await db.tag.deleteMany({where:{ownerId:owner}});await db.deletedPost.deleteMany({where:{ownerId:owner}});vi.unstubAllEnvs();await db.$disconnect();});
 it('imports, translates text only, keeps originals, and hides/replaces stale translations after resync',async()=>{
  const {importPosts}=await import('@/server/import-posts');const {POST}=await import('@/app/api/v1/classification/translation/route');const {getLibraryPost}=await import('@/server/library');
  const source={post_url:'https://www.instagram.com/p/TRANSLATION_FLOW',username:'chef',thumbnail_url:'https://scontent.cdninstagram.com/a.jpg',caption:'Mezcla 200 g de harina. @chef #receta',tags:['Personnel']};
  expect(await importPosts([source],{ownerId:owner})).toMatchObject({imported:1,invalid:0});const post=await db.post.findFirstOrThrow({where:{ownerId:owner}});
  const request:typeof fetch=async(input,init)=>POST(new Request(input,init));const api=new ClassificationHttpApi('https://example.test',key,request,'/api/v1/classification/translation');
  const inference:typeof fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));const input=JSON.parse(body.messages[1].content);expect(input.units).toBeDefined();return Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify({units:input.units.map((unit:{id:number;text:string})=>({id:unit.id,decision:unit.text.includes('Mezcla')?'TRANSLATED':'UNCHANGED',sourceLanguages:[unit.text.includes('Mezcla')?'es':'zxx'],translatedCaption:unit.text.includes('Mezcla')?unit.text.replace('Mezcla','Mélange').replace('de harina','de farine'):null,reason:'Synthetic recipe'}))})}}],usage:{prompt_tokens:50,completion_tokens:40}});};
  const deps={api,analyze:async(caption:string,signal:AbortSignal)=>({...await translateCaption(caption,'http://127.0.0.1:8645/v1','test',signal,inference),model:'deepseek/deepseek-v4.1-flash' as const,elapsedMs:10})};
  expect(await runCaptionTranslationOnce(deps,new AbortController().signal)).toEqual({status:'SUCCEEDED'});
  expect(await db.post.findUniqueOrThrow({where:{id:post.id}})).toEqual(post);expect(await getLibraryPost(post.id,owner)).toMatchObject({caption:source.caption,captionTranslation:{text:'Mélange 200 g de farine. @chef #receta'},tags:['Personnel']});
  await importPosts([source],{ownerId:owner});expect(await runCaptionTranslationOnce(deps,new AbortController().signal)).toEqual({status:'idle'});
  await importPosts([{...source,caption:'Mix 200 g of flour.'}],{ownerId:owner});expect((await getLibraryPost(post.id,owner))?.captionTranslation).toBeUndefined();
  const claim=await api.call({action:'claim'});expect(claim).toMatchObject({input:{caption:'Mix 200 g of flour.'}});
  const tombstone='https://www.instagram.com/p/TRANSLATION_DELETED';await db.deletedPost.create({data:{ownerId:owner,postUrl:tombstone,postCode:'TRANSLATION_DELETED'}});await importPosts([{...source,post_url:tombstone}],{ownerId:owner});expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(1);
 });
});
