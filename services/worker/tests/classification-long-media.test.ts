import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it,vi} from 'vitest';
import {createClassificationAnalyzer} from '../src/classification/analyze.js';
import {downloadMedia,extractLocalMedia,runProcess} from '../src/places/media.js';
const policy={maxVideoBytes:600*1024*1024,maxDurationMs:3_600_000,downloadTimeoutMs:600_000,processTimeoutMs:5_400_000};
const media={id:'long',kind:'VIDEO' as const,mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://test.r2.cloudflarestorage.com/originals/long.mp4'};

it('bounds the whole response body with the download deadline rather than waiting for the job abort',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'classification-download-timeout-')),parent=AbortSignal.timeout(250);
 try{
  const request:typeof fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}));
  await expect(downloadMedia({...media,byteSize:3},path.join(dir,'source'),parent,request,{...policy,downloadTimeoutMs:10})).rejects.toThrow('MEDIA_UNAVAILABLE');
  expect(parent.aborted).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('passes all sixty minutes of audio and frames through the classifier, while Places rejects that duration',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'classification-long-')),signal=new AbortController().signal;
 try{
  const source=path.join(dir,'source.mp4'),transcribe=path.join(dir,'transcribe.py');
  await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=32x32:r=1:d=3600','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','3600','-c:v','libx264','-threads','1','-c:a','pcm_s16le','-f','mov',source],signal);
  await writeFile(transcribe,'import json,sys,wave\nwith wave.open(sys.argv[2]) as audio:\n assert 3600 <= audio.getnframes()/audio.getframerate() < 3600.1\nprint(json.dumps({"segments":[{"startMs":3599000,"endMs":3600000,"text":"Contexte final de la recette"}]}))\n');
  const bytes=await readFile(source);let inferenceCalls=0;
  const request:typeof fetch=async(_url,init)=>{inferenceCalls++;const body=JSON.parse(String(init?.body));expect(JSON.stringify(body)).toContain('Contexte final de la recette');expect(body.messages[1].content.filter((c:{type:string})=>c.type==='image_url')).toHaveLength(12);const frames=body.messages[1].content.filter((c:{type:string,text?:string})=>c.type==='text').slice(1).map((c:{text:string})=>JSON.parse(c.text));expect(frames[0].timestampMs).toBe(0);expect(frames.at(-1).timestampMs).toBe(3_599_000);return Response.json({model:'insta-places',choices:[{message:{content:JSON.stringify({status:'SUCCEEDED',mainTheme:'Sucré',tags:['Chocolat','Brownie','Pistache'],reason:'Complete recipe context'})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}});};
  const download=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}));
  try{
   const analyzer=createClassificationAnalyzer({origin:'https://app.test',apiKey:'test',hermesUrl:'http://127.0.0.1:8645/v1',hermesKey:'test',tempRoot:dir,python:'/usr/bin/python3',transcribeScript:transcribe,modelCache:dir},()=>undefined,request);
   const output=await analyzer({jobId:'job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b',heartbeatIntervalMs:30000,input:{post_id:'post',input_hash:'hash',caption:'Long recipe',author_username:'baker'},media:[{...media,byteSize:bytes.length}],themes:['Sucré'],existingTags:[],outputSchema:{type:'object'}},dir,signal);
   expect(output.media).toEqual([{mediaId:'long',kind:'VIDEO',durationMs:3_600_000,frameCount:12,audio:'transcribed'}]);expect(inferenceCalls).toBe(1);
  }finally{download.mockRestore();}
  await expect(extractLocalMedia(media,source,1,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:dir},signal)).rejects.toThrow('MEDIA_LIMIT');
 }finally{await rm(dir,{recursive:true,force:true});}
},120_000);

it('enforces video bytes and process deadlines without weakening default downloads',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'classification-limits-')),signal=new AbortController().signal,request=vi.fn();
 try{
  await expect(downloadMedia({...media,byteSize:600*1024*1024},path.join(dir,'default'),signal,request)).rejects.toThrow('MEDIA_LIMIT');
  for(const invalid of [{...media,byteSize:policy.maxVideoBytes+1},{...media,kind:'IMAGE' as const,mimeType:'image/jpeg',byteSize:250*1024*1024+1}])await expect(downloadMedia(invalid,path.join(dir,'invalid'),signal,request,policy)).rejects.toThrow('MEDIA_LIMIT');
  expect(request).not.toHaveBeenCalled();
  await expect(runProcess('/usr/bin/python3',['-c','import time;time.sleep(0.25)'],signal,10)).rejects.toThrow('MEDIA_UNAVAILABLE');
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('rejects a duration above sixty minutes without truncating it',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'classification-overlong-')),signal=new AbortController().signal;
 try{
  const source=path.join(dir,'source.mp4');await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=32x32:r=1:d=3601','-c:v','libx264','-threads','1',source],signal);
  await expect(extractLocalMedia(media,source,0,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:dir},signal,policy)).rejects.toThrow('MEDIA_LIMIT');
 }finally{await rm(dir,{recursive:true,force:true});}
},30_000);
