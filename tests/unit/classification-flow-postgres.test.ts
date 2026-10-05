// @vitest-environment node
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {ClassificationHttpApi} from '../../services/worker/src/classification/api';
import {createClassificationAnalyzer} from '../../services/worker/src/classification/analyze';
import {runClassificationOnce} from '../../services/worker/src/classification/runner';
import {createTempWorkdirManager} from '../../services/worker/src/runtime/temp-workdir';
import {runProcess} from '../../services/worker/src/places/media';
vi.mock('server-only',()=>({}));
// Only external R2 HEAD and inference are replaced; all application, media
// extraction, HTTP serialization and database services remain real.
vi.mock('@/server/r2',async original=>({...await original<typeof import('@/server/r2')>(),verifyR2Object:async(key:string)=>({contentType:key.endsWith('.mp4')?'video/mp4':'image/jpeg',etag:'test-etag'})}));
const url=process.env.TEST_DATABASE_URL,owner=`classification-flow-${randomUUID()}`,apiKey='classification-integration-private-key';
let db:PrismaClient,sync:typeof import('@/server/sync-post'),route:typeof import('@/app/api/v1/classification/worker/route');
async function session(){return db.syncJob.create({data:{ownerId:owner,leaseExpiresAt:new Date(Date.now()+300_000),runExpiresAt:new Date(Date.now()+3_600_000)}});}
function payload(code:string,size=100){return {external_id:code,post_url:`https://www.instagram.com/p/${code}/`,username:'baker',caption:'Brownie au chocolat et pistache',content_type:'image' as const,media:[{type:'image' as const,objectKey:`originals/baker/${code}.jpg`,sourcePath:`baker/${code}.jpg`,byteSize:size}]};}
(url?describe:describe.skip)('New sync import → independent classification → library',()=>{
 beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL',url!);({prisma:db}=await import('@/server/db'));sync=await import('@/server/sync-post');route=await import('@/app/api/v1/classification/worker/route');
  for(const [key,value] of Object.entries({APP_OWNER_ID:owner,CLASSIFICATION_WORKER_ENABLED:'1',CLASSIFICATION_WORKER_API_KEY_SHA256:createHash('sha256').update(apiKey).digest('hex'),MEDIA_PUBLIC_BASE_URL:'https://example.test/',MEDIA_PATH_PREFIX:'originals',R2_ENDPOINT:'https://test.r2.cloudflarestorage.com',R2_BUCKET_NAME:'test-bucket',R2_ACCESS_KEY_ID:'test-access',R2_SECRET_ACCESS_KEY:'test-secret'}))vi.stubEnv(key,value);
 });
 afterEach(async()=>{vi.unstubAllGlobals();await db.post.deleteMany({where:{ownerId:owner}});await db.postClassificationJob.deleteMany({where:{ownerId:owner}});await db.syncJob.deleteMany({where:{ownerId:owner}});await db.importJob.deleteMany({where:{ownerId:owner}});await db.tag.deleteMany({where:{ownerId:owner}});await db.deletedPost.deleteMany({where:{ownerId:owner}});});
 afterAll(async()=>{vi.unstubAllEnvs();await db.$disconnect();});
 it('analyzes a real image, complete audio and video frames, then replays a lost completion response once',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'classification-flow-')),signal=new AbortController().signal,logs:unknown[]=[],requests:unknown[]=[];
  try{
   const image=path.join(root,'source.jpg'),video=path.join(root,'source.mp4'),transcribe=path.join(root,'transcribe.py');
   await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x120','-frames:v','1','-threads','1',image],signal);
   await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:d=2','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-threads','1','-c:a','aac',video],signal);
   await writeFile(transcribe,'import json, sys, wave\nwith wave.open(sys.argv[2]) as audio:\n assert audio.getnframes()/audio.getframerate() >= 2.9\nprint(json.dumps({"segments":[{"startMs":2500,"endMs":3000,"text":"Pistache au chocolat"}]}))\n');
   const bytes=[await readFile(image),await readFile(video)],job=await session();
   await db.post.create({data:{id:`old-${owner}`,ownerId:owner,postUrl:'https://www.instagram.com/p/OLD_CLASSIFICATION',thumbnailUrl:'https://example.test/image.jpg',authorUsername:'old',authorSortKey:'old',caption:'Existing library',mainTheme:'Sport',searchText:'old'}});
   const post={...payload('CLASSIFY_FLOW'),content_type:'carousel' as const,media:bytes.map((b,i)=>({type:i===0?'image' as const:'video' as const,objectKey:`originals/baker/CLASSIFY_FLOW_${i+1}.${i===0?'jpg':'mp4'}`,sourcePath:`baker/CLASSIFY_FLOW_${i+1}.${i===0?'jpg':'mp4'}`,byteSize:b.length}))};
   expect(await sync.importSyncedPost({sub:job.id,ownerId:owner},post)).toMatchObject({imported:1});
   expect(await sync.importSyncedPost({sub:job.id,ownerId:owner},post)).toMatchObject({imported:1});expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(1);
   await sync.importSyncedPost({sub:job.id,ownerId:owner},payload('CLASSIFY_WAITING',bytes[0].length));
   vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{const b=bytes[String(input).includes('.mp4')?1:0];return new Response(b,{headers:{'Content-Length':String(b.length)}});});
   const inference:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(String(init?.body));requests.push(body);const content=JSON.parse(body.messages[1].content[0].text);const summary=Boolean(content.output_schema.properties?.summary);
    return Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify(summary?{summary:'Brownie et pistache dans les images et la transcription',visibleText:'Chocolat'}:{status:'SUCCEEDED',mainTheme:'Sucré',tags:['Chocolat','Brownie','Pistache'],reason:'Recette illustrée et expliquée'})},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:20}});
   };
   let completionCalls=0;const transport:typeof fetch=async(_input,init)=>{const response=await route.POST(new Request('https://example.test/api/v1/classification/worker',init));if(JSON.parse(String(init?.body)).action==='complete'&&++completionCalls===1){await response.body?.cancel();return new Response('{',{status:200});}return response;};
   const workerApi=new ClassificationHttpApi('https://example.test',apiKey,transport),workRoot=path.join(root,'work');
   const outcome=await runClassificationOnce({api:workerApi,workdirs:createTempWorkdirManager({root:workRoot,maxAgeMs:3600000}),analyze:createClassificationAnalyzer({origin:'https://example.test',apiKey,hermesUrl:'http://127.0.0.1:8645/v1',hermesKey:'local-test-key',tempRoot:workRoot,python:'/usr/bin/python3',transcribeScript:transcribe,modelCache:root},event=>logs.push(event),inference)},signal);
   expect(outcome.status).toBe('SUCCEEDED');expect(completionCalls).toBe(2);expect(requests).toHaveLength(3);expect(JSON.stringify(requests)).toContain('data:image/jpeg;base64,');expect(JSON.stringify(requests)).toContain('Pistache au chocolat');expect(JSON.stringify(logs)).not.toContain('Pistache au chocolat');expect(await readdir(workRoot)).toEqual([]);
   const saved=await db.post.findFirstOrThrow({where:{ownerId:owner,externalId:'CLASSIFY_FLOW'},include:{postTags:{include:{tag:true}}}});expect(saved.mainTheme).toBe('Sucré');expect(saved.postTags.map(t=>t.tag.name).sort()).toEqual(['Brownie','Chocolat','Pistache']);
   const record=await db.postClassificationJob.findFirstOrThrow({where:{ownerId:owner,postId:saved.id}});expect(record.status).toBe('SUCCEEDED');expect((record.result as {media:unknown[]}).media).toEqual(expect.arrayContaining([expect.objectContaining({kind:'VIDEO',audio:'transcribed',durationMs:3000,frameCount:2})]));expect((await db.post.findUniqueOrThrow({where:{id:`old-${owner}`}})).mainTheme).toBe('Sport');expect(await db.placeAnalysisJob.count({where:{ownerId:owner}})).toBe(0);
   const waiting=await db.post.findFirstOrThrow({where:{ownerId:owner,externalId:'CLASSIFY_WAITING'}});expect(await workerApi.call({action:'claim'},signal)).toMatchObject({input:{post_id:waiting.id}});
  }finally{await rm(root,{recursive:true,force:true});}
 },30_000);
 it('rolls back the new import when its durable enqueue fails and skips disabled/deleted imports',async()=>{
  const run=await session(),hook=`classification_fail_${randomUUID().replaceAll('-','')}`;
  await db.$executeRawUnsafe(`CREATE FUNCTION "${hook}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id = TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic queue failure'; END IF; RETURN NEW; END $$`);
  try{await db.$executeRawUnsafe(`CREATE TRIGGER "${hook}" BEFORE INSERT ON post_classification_jobs FOR EACH ROW EXECUTE FUNCTION "${hook}"('${owner}')`);await expect(sync.importSyncedPost({sub:run.id,ownerId:owner},payload('CLASSIFY_ROLLBACK'))).rejects.toThrow('synthetic queue failure');expect(await db.post.count({where:{ownerId:owner}})).toBe(0);expect((await db.syncJob.findUniqueOrThrow({where:{id:run.id}})).imported).toBe(0);}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${hook}" ON post_classification_jobs`);await db.$executeRawUnsafe(`DROP FUNCTION "${hook}"()`);}
  vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','0');await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('CLASSIFY_DISABLED'));expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(0);
  vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','1');await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('CLASSIFY_DISABLED'));expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(0);
  await db.deletedPost.create({data:{ownerId:owner,postUrl:'https://www.instagram.com/p/CLASSIFY_DELETED',externalId:'CLASSIFY_DELETED',postCode:'CLASSIFY_DELETED'}});expect(await sync.importSyncedPost({sub:run.id,ownerId:owner},payload('CLASSIFY_DELETED'))).toMatchObject({skipped:1});expect(await db.postClassificationJob.count({where:{ownerId:owner}})).toBe(0);
 });
});
