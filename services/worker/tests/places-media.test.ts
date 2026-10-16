import { chmod, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { downloadMedia, extractLocalMedia, runProcess } from '../src/places/media.js';
import * as mediaTools from '../src/places/media.js';

it('extracts bounded real video frames and reports absent audio explicitly',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-ffmpeg-')),signal=new AbortController().signal;
  try{
    const source=path.join(dir,'source.mp4');
    await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=2','-c:v','libx264','-threads','1',source],signal);
    const result=await extractLocalMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:'/not-called'},signal);
    expect(result.coverage).toEqual({mediaId:'media',kind:'VIDEO',durationMs:2000,frameCount:2,audio:'absent'});
    expect(result.frames.map(f=>f.timestampMs)).toEqual([0,1750]);expect(result.transcript.segments).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('rejects unauthorized URLs and truncation or oversized signed object responses',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-download-')),signal=new AbortController().signal;
  const media={id:'media',kind:'VIDEO' as const,mimeType:'video/mp4',byteSize:3,versionTag:'etag',url:'http://127.0.0.1/private'};
  try{
    const request=vi.fn();await expect(downloadMedia(media,path.join(dir,'bad'),signal,request)).rejects.toThrow('MEDIA_UNAVAILABLE');expect(request).not.toHaveBeenCalled();
    for(const [index,body] of ['12','1234'].entries()){
      const fetcher=vi.fn(async()=>new Response(body));
      await expect(downloadMedia({...media,url:'https://account.r2.cloudflarestorage.com/b/o'},path.join(dir,'obj-'+index),signal,fetcher as typeof fetch)).rejects.toThrow(/MEDIA_DOWNLOAD_FAILED|MEDIA_LIMIT/);
      expect(fetcher.mock.calls[0]).toBeDefined();
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('refuses a truncated MP4 even when ffprobe and ffmpeg exit successfully',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-truncated-')),signal=new AbortController().signal;
  try{
    const source=path.join(dir,'source.mp4');
    await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=160x120:rate=25:duration=10','-f','lavfi','-i','sine=frequency=440:duration=10','-c:v','libx264','-threads','1','-c:a','aac','-movflags','+faststart',source],signal);
    const bytes=await readFile(source);await writeFile(source,bytes.subarray(0,Math.floor(bytes.length*0.94)));
    await expect(extractLocalMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:bytes.length,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:'/not-called'},signal)).rejects.toThrow('MEDIA_DECODE_FAILED');
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('samples existing video frames when audio outlasts video or frame rate is low',async()=>{
  for(const audioTail of [true,false]){
    const dir=await mkdtemp(path.join(os.tmpdir(),'places-stream-timing-')),signal=new AbortController().signal;
    try{
      const source=path.join(dir,'source.mp4'),transcribe=path.join(dir,'transcribe.py');
      await writeFile(transcribe,'import json, sys, wave\nwith wave.open(sys.argv[2]) as audio:\n assert audio.getnframes()/audio.getframerate() >= 2.9\nprint(json.dumps({"segments":[{"startMs":2500,"endMs":3000,"text":"Later audio"}]}))\n');
      await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=blue:s=160x120:r=${audioTail?30:1}:d=2`,...(audioTail?['-f','lavfi','-i','sine=frequency=440:duration=3']:[]),'-c:v','libx264','-threads','1',...(audioTail?['-c:a','aac']:[]),source],signal);
      const result=await extractLocalMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/usr/bin/python3',transcribeScript:transcribe,modelCache:dir},signal);
      expect(result.coverage).toMatchObject({durationMs:audioTail?3000:2000,frameCount:2,audio:audioTail?'transcribed':'absent'});
      expect(result.frames.map(f=>f.timestampMs)).toEqual([0,audioTail?1750:1000]);
      for(const frame of result.frames)expect((await readFile(frame.path)).length).toBeGreaterThan(0);
      if(audioTail)expect(result.transcript.segments.at(-1)?.endMs).toBe(3000);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
});

it('extracts the complete timeline for seven-and-a-half and fifteen minute videos, but refuses longer media',async()=>{
  for(const durationSeconds of [450,900,901]){
    const dir=await mkdtemp(path.join(os.tmpdir(),'places-long-video-')),signal=new AbortController().signal;
    try{
      const source=path.join(dir,'source.mp4');
      await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=blue:s=64x64:r=1:d=${durationSeconds}`,'-c:v','libx264','-threads','1',source],signal);
      const pending=extractLocalMedia({id:'long-video',kind:'VIDEO',mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:'/not-called'},signal);
      if(durationSeconds>900){await expect(pending).rejects.toThrow('MEDIA_LIMIT');continue;}
      const result=await pending;
      expect(result.coverage).toEqual({mediaId:'long-video',kind:'VIDEO',durationMs:durationSeconds*1000,frameCount:12,audio:'absent'});
      expect(result.frames[0].timestampMs).toBe(0);
      expect(result.frames.at(-1)?.timestampMs).toBe(durationSeconds===450?449000:899000);
      expect(result.frames.every(frame=>frame.timestampMs>=0&&frame.timestampMs<result.coverage.durationMs!)).toBe(true);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
},30000);

it('separates download failures from stops and deadlines without exposing private URLs',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-download-errors-'));
  const media={id:'media',kind:'VIDEO' as const,mimeType:'video/mp4',byteSize:3,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o?signature=secret'};
  const limits={maxVideoBytes:100,maxDurationMs:1000,downloadTimeoutMs:30,processTimeoutMs:1000};
  try{
    const failed:typeof fetch=async()=>{throw Error('private URL and credential');};
    await expect(downloadMedia(media,path.join(dir,'failed'),new AbortController().signal,failed,limits)).rejects.toThrow(/^MEDIA_DOWNLOAD_FAILED$/);
    const stopped=new AbortController();stopped.abort();
    await expect(downloadMedia(media,path.join(dir,'stop'),stopped.signal,failed,limits)).rejects.toThrow(/^WORKER_STOPPING$/);
    const stalled:typeof fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}));
    await expect(downloadMedia(media,path.join(dir,'deadline'),new AbortController().signal,stalled,limits)).rejects.toThrow(/^WORKER_TIMEOUT$/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('retains process timeout and stop reasons while sanitizing decoder errors',async()=>{
  const signal=new AbortController().signal;
  await expect(runProcess('/usr/bin/python3',['-c','import time;time.sleep(2)'],signal,20)).rejects.toThrow(/^WORKER_TIMEOUT$/);
  const stopped=new AbortController();stopped.abort();
  await expect(runProcess('/usr/bin/python3',['-c','print("not run")'],stopped.signal)).rejects.toThrow(/^WORKER_STOPPING$/);
  const timeout=new AbortController();timeout.abort(new DOMException('deadline','TimeoutError'));
  await expect(runProcess('/usr/bin/python3',['-c','print("not run")'],timeout.signal)).rejects.toThrow(/^WORKER_TIMEOUT$/);
  await expect(runProcess('/usr/bin/ffprobe',['-v','error','/private/media-source'],signal)).rejects.toThrow(/^MEDIA_DECODE_FAILED$/);
});

it('distinguishes missing or inaccessible media tools from corrupt media',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-missing-tools-')),signal=new AbortController().signal;
  try{
    const denied=path.join(dir,'ffmpeg');await writeFile(denied,'#!/bin/sh\nexit 0\n',{mode:0o600});
    for(const tool of [path.join(dir,'not-installed'),denied])await expect(runProcess(tool,[],signal)).rejects.toThrow(/^MEDIA_TOOLS_UNAVAILABLE$/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('preserves subprocess disk failures as infrastructure errors without exposing stderr',async()=>{
  const signal=new AbortController().signal;
  for(const [diagnostic,code] of [
    ['av_interleaved_write_frame(): No space left on device\nError closing file /private/audio.wav: No space left on device','TEMP_STORAGE_UNAVAILABLE'],
    ['Error writing trailer of /private/audio.wav: Disk quota exceeded','TEMP_STORAGE_UNAVAILABLE'],
    ['/private/frame.jpg: Read-only file system','TEMP_STORAGE_UNAVAILABLE'],
    ['Error while decoding stream #0:0: Invalid data found when processing input','MEDIA_DECODE_FAILED'],
  ]){
    // Exercise the actual subprocess boundary with the bounded ffmpeg diagnostics.
    await expect(runProcess('/usr/bin/python3',['-c','import sys;sys.stderr.write(sys.argv[1]);sys.exit(1)',diagnostic],signal)).rejects.toThrow(new RegExp('^'+code+'$'));
  }
});

it.skipIf(process.getuid?.()===0)('identifies inaccessible temporary storage rather than blaming a successful media response',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-denied-storage-')),signal=new AbortController().signal;
  try{
    await chmod(dir,0o500);
    await expect(downloadMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:3,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},path.join(dir,'source'),signal,async()=>new Response('123'))).rejects.toThrow(/^TEMP_STORAGE_UNAVAILABLE$/);
  }finally{await chmod(dir,0o700);await rm(dir,{recursive:true,force:true});}
});

it('loads ASR in preflight and rejects missing or malformed readiness with bounded errors',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-asr-check-')),signal=new AbortController().signal;
  try{
    const script=path.join(dir,'check.py'),config={python:'/usr/bin/python3',transcribeScript:script,modelCache:dir};
    for(const [body,code] of [
      ['import json,sys\nassert sys.argv[1:] == ["--check", "--cache", '+JSON.stringify(dir)+']\nprint(json.dumps({"ready":True}))',null],
      ['import sys\nsys.stderr.write("ASR_UNAVAILABLE\\n")\nsys.exit(1)','ASR_UNAVAILABLE'],
      ['import sys\nsys.stderr.write("private path and credential\\n")\nsys.exit(1)','ASR_UNAVAILABLE'],
      ['print("not ready")','ASR_UNAVAILABLE'],
      ['import time\ntime.sleep(2)','WORKER_TIMEOUT'],
    ] as const){
      await writeFile(script,body);
      const pending=mediaTools.preflightAsr(config,signal,body.includes('sleep')?20:2000);
      if(code)await expect(pending).rejects.toThrow(new RegExp('^'+code+'$'));else await expect(pending).resolves.toBeUndefined();
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('keeps valid media with failed or malformed ASR out of inference and identifies the ASR stage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'places-asr-errors-')),signal=new AbortController().signal;
  try{
    const source=path.join(dir,'source.mp4'),script=path.join(dir,'transcribe.py');
    await runProcess('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-threads','1','-c:a','aac',source],signal);
    for(const [body,code] of [
      ['import sys\nsys.stderr.write("ASR_UNAVAILABLE\\n")\nsys.exit(1)','ASR_UNAVAILABLE'],
      ['import sys\nsys.stderr.write("private raw model failure\\n")\nsys.exit(1)','ASR_FAILED'],
      ['print("invalid transcript")','ASR_FAILED'],
      ['print(\'{"segments":[{"startMs":200,"endMs":100,"text":"wrong timing"}]}\')','ASR_FAILED'],
    ]){
      await writeFile(script,body);
      await expect(extractLocalMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:1,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/usr/bin/python3',transcribeScript:script,modelCache:dir},signal)).rejects.toThrow(new RegExp('^'+code+'$'));
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
