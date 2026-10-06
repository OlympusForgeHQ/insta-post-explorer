import {ClassificationInference} from './inference.js';
import type {ClassificationClaim} from './api.js';
import type {ClassificationAnalysis} from './runner.js';
import {extractMedia,type ExtractedMedia} from '../places/media.js';
import type {PlacesConfig} from '../places/config.js';
import {CLASSIFICATION_MEDIA_LIMITS} from './limits.js';
export function createClassificationAnalyzer(config:PlacesConfig,log:(event:Record<string,unknown>)=>void,request:typeof fetch=fetch){
 return async(claim:ClassificationClaim,dir:string,signal:AbortSignal):Promise<ClassificationAnalysis>=>{
  const start=Date.now(),usage={inputTokens:0,outputTokens:0};
  const inference=new ClassificationInference(config.hermesUrl,config.hermesKey,request,u=>{usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;log({postId:claim.input.post_id,stage:'inference_usage',usage:u});if(usage.inputTokens>2_000_000||usage.outputTokens>100_000)throw Error('MEDIA_LIMIT');});
  const extracted:ExtractedMedia[]=[],notes:unknown[]=[];
  for(let i=0;i<claim.media.length;i++){
   const source=await extractMedia(claim.media[i],i,dir,config,signal,CLASSIFICATION_MEDIA_LIMITS);extracted.push(source);log({stage:'classification_media',postId:claim.input.post_id,...source.coverage});
   if(claim.media.length>1){const note=await inference.inspect({caption:claim.input.caption,mediaId:source.coverage.mediaId,transcript:source.transcript},source.frames,signal);notes.push({mediaId:source.coverage.mediaId,...note.output});}
  }
  const output=await inference.classify(claim,{post:claim.input,media:notes,transcripts:claim.media.length===1?extracted.map(m=>m.transcript):[]},claim.media.length===1?extracted[0].frames:[],signal);
  return {...output.output,media:extracted.map(m=>m.coverage),model:'deepseek/deepseek-v4.1-flash',usage,elapsedMs:Date.now()-start};
 };
}
