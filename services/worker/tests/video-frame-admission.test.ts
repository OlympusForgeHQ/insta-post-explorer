import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createClassificationAnalyzer} from '../src/classification/analyze.js';
import {createPlacesAnalyzer} from '../src/places/analyze.js';
import {runClassificationOnce} from '../src/classification/runner.js';
import {runPlacesPipeline} from '../src/places/pipeline.js';
import {createTempWorkdirManager} from '../src/runtime/temp-workdir.js';
import type {ExtractedMedia} from '../src/places/media.js';

// Real extraction/ASR is covered by classification-long-media. This fixture
// isolates the admission boundary without re-encoding a video for each case.
const fixture=vi.hoisted(()=>({media:null as ExtractedMedia|null}));
vi.mock('../src/places/media.js',()=>({extractMedia:async()=>fixture.media!}));
let root:string;
beforeEach(async()=>{
 root=await mkdtemp(path.join(tmpdir(),'video-admission-'));
 const frames=[];
 for(let index=0;index<12;index++){
  const filename=path.join(root,`frame-${index}.jpg`);await writeFile(filename,`actual-frame-${index}`);
  frames.push({path:filename,mediaId:'video',timestampMs:index*1000});
 }
 fixture.media={frames,transcript:{mediaId:'video',segments:[{startMs:0,endMs:12_000,text:'Complete original audio, including its final words.'}]},coverage:{mediaId:'video',kind:'VIDEO',durationMs:12_000,frameCount:12,audio:'transcribed'}};
});
afterEach(async()=>{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});
const config=()=>({origin:'https://app.test',apiKey:'private-api-key',hermesUrl:'http://127.0.0.1:8645/v1',hermesKey:'private-hermes-key',tempRoot:root,python:'/unused',transcribeScript:'/unused',modelCache:root});
const media={id:'video',kind:'VIDEO' as const,mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://test.r2.cloudflarestorage.com/video'};
const input={post_id:'post',input_hash:'hash',caption:'A recommendation in the final frame',author_username:'author'};
const claim={jobId:'job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b',heartbeatIntervalMs:30000 as const,input,media:[media],themes:['Restaurant'],existingTags:[],outputSchema:{type:'object'}};
const prepared={jobId:'job',leaseToken:claim.leaseToken,heartbeatIntervalMs:30000 as const,input,media:[media],categoryRules:'Only owner categories',outputSchema:{type:'object',required:['candidates'],properties:{candidates:{type:'array',items:{type:'object'}}}}};
const classified={status:'SUCCEEDED',mainTheme:'Restaurant',tags:['Café indépendant','Brunch','Terrasse'],reason:'The final frame identifies the recommendation.'};
const candidate={name:'Last Frame Café',category:'cafe',evidence:[{type:'VIDEO_OCR',excerpt:'Last Frame Café',mediaId:'video',videoTimestampMs:11_000}]};
const reply=(value:unknown)=>Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});
function contents(init?:RequestInit){const body=JSON.parse(String(init?.body));return body.messages[1].content as Array<{type:string;text?:string;image_url?:{url:string}}>;}
function source(init?:RequestInit){return JSON.parse(contents(init)[0].text!);}
function verifyImages(init:RequestInit|undefined,seen:number[]){
 const content=contents(init),images=content.filter(part=>part.type==='image_url');
 if(images.length>10)return false;
 const labels=content.filter(part=>part.type==='text').slice(1).map(part=>JSON.parse(part.text!));
 images.forEach((part,index)=>{
  const frame=Number(Buffer.from(part.image_url!.url.split(',')[1],'base64').toString().replace('actual-frame-',''));
  expect(labels[index]).toEqual({mediaId:'video',timestampMs:frame*1000});seen.push(frame);
 });
 return true;
}

it.each(['classification','places'] as const)('retains all video frames and final-frame evidence through %s with at most ten images per admission',async kind=>{
 const seen:number[]=[];let synthesis=0;
 const request:typeof fetch=async(_url,init)=>{
  if(!verifyImages(init,seen))return Response.json({error:{code:'invalid_params'}},{status:400});
  const data=source(init),count=contents(init).filter(part=>part.type==='image_url').length;
  if(count){
   const hasLast=seen.at(-1)===11;
   return reply(kind==='classification'?{summary:hasLast?'Last Frame Café is the recommendation.':'Earlier frames only.',visibleText:hasLast?'Last Frame Café':''}:{candidates:hasLast?[candidate]:[]});
  }
  if(kind==='places'&&data.stage==='caption')return reply({candidates:[]});
  synthesis++;
  expect(JSON.stringify(data)).toContain('Last Frame Café');
  expect(JSON.stringify(data)).toContain('Complete original audio, including its final words.');
  return reply(kind==='classification'?classified:{candidates:[candidate]});
 };
 vi.spyOn(globalThis,'fetch').mockImplementation(request);
 const output=kind==='classification'?await createClassificationAnalyzer(config(),()=>{},request)(claim,root,new AbortController().signal):await createPlacesAnalyzer(config(),()=>{})(prepared,root,new AbortController().signal);
 expect(seen).toEqual(Array.from({length:12},(_,index)=>index));expect(synthesis).toBe(1);
 expect(output.media).toEqual([fixture.media!.coverage]);expect(output.usage).toEqual({inputTokens:kind==='classification'?30:40,outputTokens:kind==='classification'?15:20});
 if(kind==='places')expect('candidates' in output&&output.candidates).toEqual([candidate]);
});

it.each([1,10])('keeps the direct classification path for %i images within the admission limit',async count=>{
 fixture.media!.frames=fixture.media!.frames.slice(0,count);fixture.media!.coverage.frameCount=count;
 let calls=0;
 const request:typeof fetch=async(_url,init)=>{calls++;expect(contents(init).filter(part=>part.type==='image_url')).toHaveLength(count);return reply(classified);};
 const output=await createClassificationAnalyzer(config(),()=>{},request)(claim,root,new AbortController().signal);
 expect(output.status).toBe('SUCCEEDED');expect(calls).toBe(1);
});

it.each([{kind:'classification',stop:false},{kind:'places',stop:false},{kind:'classification',stop:true},{kind:'places',stop:true}] as const)('never completes partial $kind evidence after a batch failure or stop=$stop',async({kind,stop})=>{
 const abort=new AbortController();
 let imageCalls=0;const commands:Record<string,unknown>[]=[];
 const request:typeof fetch=async(_url,init)=>{
  const count=contents(init).filter(part=>part.type==='image_url').length;
  if(count>10||count&&++imageCalls===2)return Response.json({error:{code:'invalid_params'}},{status:400});
  if(stop&&count)abort.abort();
  return reply(kind==='classification'?{summary:'Partial evidence only',visibleText:''}:{candidates:[]});
 };
 vi.spyOn(globalThis,'fetch').mockImplementation(request);
 const api={call:async(command:Record<string,unknown>)=>{commands.push(command);return command.action==='claim'?(kind==='classification'?claim:prepared):{ok:true};}};
 const workdir=path.join(root,'work'),workdirs=createTempWorkdirManager({root:workdir,maxAgeMs:21_600_000});
 if(kind==='classification')await runClassificationOnce({api,workdirs,analyze:createClassificationAnalyzer(config(),()=>{},request)},abort.signal);
 else await runPlacesPipeline({limit:1,commit:true,signal:abort.signal},{api,workdirs,analyze:createPlacesAnalyzer(config(),()=>{})});
 expect(imageCalls).toBe(stop?1:2);expect(commands.some(command=>command.action==='complete')).toBe(false);
 expect(commands.find(command=>command.action==='fail')).toMatchObject({code:stop?'WORKER_STOPPING':'INFERENCE_FAILED'});expect(await readdir(workdir)).toEqual([]);
});

it.each(['classification','places'] as const)('logs only bounded allowlisted HTTP diagnostics for %s',async kind=>{
 fixture.media!.frames=fixture.media!.frames.slice(0,1);
 for(const scenario of ['known','unknown','oversized','malformed'] as const){
  const code=scenario==='unknown'?'PRIVATE_TOKEN_https://private.test/caption':'invalid_params';
  const logs:Record<string,unknown>[]=[];
  const request:typeof fetch=async()=>scenario==='malformed'?new Response('PRIVATE_INVALID_JSON',{status:400}):Response.json({error:{code,message:scenario==='oversized'?'PRIVATE_OVERSIZED'.repeat(1000):'PRIVATE_CAPTION private-hermes-key',metadata:{source:'PRIVATE_MEDIA'}}},{status:400});
  vi.spyOn(globalThis,'fetch').mockImplementation(request);
  const analyze=kind==='classification'?()=>createClassificationAnalyzer(config(),event=>logs.push(event),request)(claim,root,new AbortController().signal):()=>createPlacesAnalyzer(config(),event=>logs.push(event))(prepared,root,new AbortController().signal);
  await expect(analyze()).rejects.toThrow('INFERENCE_FAILED');
  expect(logs.find(event=>event.stage==='inference_http_error')).toMatchObject({httpStatus:400,imageCount:kind==='classification'?1:0,providerCode:scenario==='known'?code:'unknown'});
  expect(JSON.stringify(logs)).not.toMatch(/PRIVATE_|private-hermes-key/);
 }
});
