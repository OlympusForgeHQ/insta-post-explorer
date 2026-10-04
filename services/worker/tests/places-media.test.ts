import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { downloadMedia, extractLocalMedia, runProcess } from '../src/places/media.js';

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
      await expect(downloadMedia({...media,url:'https://account.r2.cloudflarestorage.com/b/o'},path.join(dir,'obj-'+index),signal,fetcher as typeof fetch)).rejects.toThrow(/MEDIA_UNAVAILABLE|MEDIA_LIMIT/);
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
    await expect(extractLocalMedia({id:'media',kind:'VIDEO',mimeType:'video/mp4',byteSize:bytes.length,versionTag:null,url:'https://account.r2.cloudflarestorage.com/b/o'},source,0,dir,{python:'/not-called',transcribeScript:'/not-called',modelCache:'/not-called'},signal)).rejects.toThrow('MEDIA_UNAVAILABLE');
  }finally{await rm(dir,{recursive:true,force:true});}
});
