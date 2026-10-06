import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { MediaDescriptor } from './api.js';
import type { PlacesConfig } from './config.js';

export type Frame={path:string;timestampMs:number;mediaId:string};
export type MediaExtractionLimits={maxVideoBytes:number;maxDurationMs:number;downloadTimeoutMs:number;processTimeoutMs:number};
const defaultLimits:Readonly<MediaExtractionLimits>={maxVideoBytes:250*1024*1024,maxDurationMs:900_000,downloadTimeoutMs:180_000,processTimeoutMs:600_000};
export type ExtractedMedia={frames:Frame[];transcript:{mediaId:string;segments:Array<{startMs:number;endMs:number;text:string}>};coverage:{mediaId:string;kind:'IMAGE'|'VIDEO';durationMs:number|null;frameCount:number;audio:'transcribed'|'absent'|'not_applicable'}};
export async function runProcess(file:string,args:string[],signal:AbortSignal,timeoutMs=600_000):Promise<string>{
  try{return await new Promise<string>((resolve,reject)=>{
    execFile(file,args,{signal,killSignal:'SIGKILL',timeout:timeoutMs,maxBuffer:4*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>error || (file.startsWith('/usr/bin/ff') && stderr.trim()) ? reject(error ?? Error('MEDIA_DECODE_FAILED')) : resolve(stdout));
  });}catch{throw Error(signal.aborted?'WORKER_STOPPING':'MEDIA_UNAVAILABLE');}
}
export async function downloadMedia(media:MediaDescriptor,target:string,signal:AbortSignal,request:typeof fetch=fetch,limits:Readonly<MediaExtractionLimits>=defaultLimits){
  const url=new URL(media.url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.r2.cloudflarestorage.com')||url.username||url.password||url.hash||url.port)throw Error('MEDIA_UNAVAILABLE');
  if(media.byteSize<=0||media.byteSize>(media.kind==='VIDEO'?limits.maxVideoBytes:250*1024*1024))throw Error('MEDIA_LIMIT');
  const downloadSignal=AbortSignal.any([signal,AbortSignal.timeout(limits.downloadTimeoutMs)]);
  let response:Response;
  try{response=await request(url,{redirect:'error',headers:media.versionTag?{'If-Match':media.versionTag}:{},signal:downloadSignal});}catch{throw Error('MEDIA_UNAVAILABLE');}
  const declared=response.headers.get('content-length');
  if(!response.ok||!response.body||(declared!==null&&Number(declared)!==media.byteSize)){await response.body?.cancel();throw Error('MEDIA_UNAVAILABLE');}
  let size=0;
  const bound=new Transform({transform(chunk:Buffer,_encoding,callback){size+=chunk.length;callback(size>media.byteSize?Error('MEDIA_LIMIT'):null,chunk);}});
  try{await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),bound,createWriteStream(target,{mode:0o600,flags:'wx'}),{signal:downloadSignal});}
  catch(error){throw Error(error instanceof Error&&error.message==='MEDIA_LIMIT'?'MEDIA_LIMIT':'MEDIA_UNAVAILABLE');}
  if(size!==media.byteSize)throw Error('MEDIA_UNAVAILABLE');
}
const probeSchema=z.object({format:z.object({duration:z.string().optional(),format_name:z.string()}),streams:z.array(z.object({codec_type:z.string(),width:z.number().optional(),height:z.number().optional(),duration:z.string().optional(),avg_frame_rate:z.string().optional()}))});
const transcriptSchema=z.object({segments:z.array(z.object({startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),text:z.string().max(5000)})).max(2000)});
export async function extractMedia(media:MediaDescriptor,index:number,dir:string,config:Pick<PlacesConfig,'python'|'transcribeScript'|'modelCache'>,signal:AbortSignal,limits:Readonly<MediaExtractionLimits>=defaultLimits):Promise<ExtractedMedia>{
  const source=path.join(dir,`media-${index}`);
  await downloadMedia(media,source,signal,undefined,limits);
  return extractLocalMedia(media,source,index,dir,config,signal,limits);
}
export async function extractLocalMedia(media:MediaDescriptor,source:string,index:number,dir:string,config:Pick<PlacesConfig,'python'|'transcribeScript'|'modelCache'>,signal:AbortSignal,limits:Readonly<MediaExtractionLimits>=defaultLimits):Promise<ExtractedMedia>{
  const execute=(file:string,args:string[])=>runProcess(file,args,signal,limits.processTimeoutMs);
  const probe=probeSchema.parse(JSON.parse(await execute('/usr/bin/ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',source])));
  const video=probe.streams.find(s=>s.codec_type==='video');
  if(!video?.width||!video.height||video.width>8192||video.height>8192)throw Error('MEDIA_LIMIT');
  const allowed=media.kind==='VIDEO'?['mov','mp4']:media.mimeType==='image/jpeg'?['jpeg_pipe','image2']:media.mimeType==='image/png'?['png_pipe','image2']:['webp_pipe','image2'];
  if(!probe.format.format_name.split(',').some(n=>allowed.includes(n)))throw Error('MEDIA_UNAVAILABLE');
  const durationMs=media.kind==='VIDEO'?Math.round(Number(probe.format.duration)*1000):null;
  if(durationMs!==null&&(!Number.isFinite(durationMs)||durationMs<=0||durationMs>limits.maxDurationMs))throw Error('MEDIA_LIMIT');
  if(media.kind==='VIDEO')await execute('/usr/bin/ffmpeg',['-nostdin','-v','error','-threads','2','-protocol_whitelist','file,pipe','-i',source,'-map','0:v:0','-f','null','-']);
  // The container can continue after its video stream ends (audio tail). Keep
  // its full duration for ASR, but sample only the actual video timeline.
  const streamDurationMs=Number(video.duration)*1000;
  const videoDurationMs=durationMs===null?0:Number.isFinite(streamDurationMs)&&streamDurationMs>0?Math.min(durationMs,streamDurationMs):durationMs;
  const [rateNumerator,rateDenominator]=video.avg_frame_rate?.split('/').map(Number)??[];
  const frameIntervalMs=rateNumerator>0&&rateDenominator>0?1000*rateDenominator/rateNumerator:0;
  const lastFrameMs=Math.max(0,videoDurationMs-Math.max(250,frameIntervalMs));
  const count=durationMs===null?1:Math.min(12,Math.max(1,Math.ceil(videoDurationMs/1000)));
  const frames:Frame[]=[];
  for(let i=0;i<count;i++){
    signal.throwIfAborted();
    const timestampMs=durationMs===null?0:Math.floor(i*lastFrameMs/Math.max(1,count-1));
    const framePath=path.join(dir,`frame-${index}-${i}.jpg`);
    await execute('/usr/bin/ffmpeg',['-nostdin','-v','error','-threads','2','-protocol_whitelist','file,pipe',...(durationMs!==null?['-ss',String(timestampMs/1000)]:[]),'-i',source,'-frames:v','1','-vf',"scale=w='min(1280,iw)':h=-2",'-q:v','3','-y',framePath]);
    frames.push({path:framePath,timestampMs,mediaId:media.id});
  }
  let audio:ExtractedMedia['coverage']['audio']=media.kind==='IMAGE'?'not_applicable':'absent';
  let segments:ExtractedMedia['transcript']['segments']=[];
  if(media.kind==='VIDEO'&&probe.streams.some(s=>s.codec_type==='audio')){
    const audioPath=path.join(dir,`audio-${index}.wav`);
    await execute('/usr/bin/ffmpeg',['-nostdin','-v','error','-threads','2','-protocol_whitelist','file,pipe','-i',source,'-vn','-ac','1','-ar','16000','-y',audioPath]);
    const text=await execute(config.python,[config.transcribeScript,'--audio',audioPath,'--cache',config.modelCache]);
    try{segments=transcriptSchema.parse(JSON.parse(text)).segments;}catch{throw Error('INVALID_RESULT');}
    if(segments.some(s=>s.endMs<s.startMs||s.endMs>(durationMs??0)+1000))throw Error('INVALID_RESULT');
    audio='transcribed';
  }
  // Verify outputs exist before handing them to the inference client.
  try{for(const frame of frames){if(!(await readFile(frame.path)).length)throw Error('MEDIA_UNAVAILABLE');}}
  catch{throw Error('MEDIA_UNAVAILABLE');}
  return {frames,transcript:{mediaId:media.id,segments},coverage:{mediaId:media.id,kind:media.kind,durationMs,frameCount:frames.length,audio}};
}
