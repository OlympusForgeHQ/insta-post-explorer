import type { PreparedPost } from './api.js';
import type { PlacesConfig } from './config.js';
import { HermesPlacesInference } from './inference.js';
import { extractMedia, type ExtractedMedia } from './media.js';
import type { PipelineResult } from './pipeline.js';

export function createPlacesAnalyzer(config:PlacesConfig,log:(event:Record<string,unknown>)=>void){
  const inference=new HermesPlacesInference(config.hermesUrl,config.hermesKey);
  return async(prepared:PreparedPost,dir:string,signal:AbortSignal):Promise<PipelineResult>=>{
    const started=Date.now(),usage={inputTokens:0,outputTokens:0};
    const addUsage=(u:typeof usage)=>{usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;if(usage.inputTokens>2_000_000||usage.outputTokens>100_000)throw Error('MEDIA_LIMIT');};
    const caption=await inference.analyze(prepared,'caption',prepared.input,[],signal);addUsage(caption.usage);
    log({postId:prepared.input.post_id,stage:'caption',candidates:caption.candidates.length});
    const extracted:ExtractedMedia[]=[],ocr:unknown[]=[];
    for(let index=0;index<prepared.media.length;index++){
      const media=await extractMedia(prepared.media[index],index,dir,config,signal);extracted.push(media);
      log({postId:prepared.input.post_id,stage:'media',...media.coverage,transcriptSegments:media.transcript.segments.length});
      const result=await inference.analyze(prepared,'ocr',{mediaId:media.coverage.mediaId},media.frames,signal);addUsage(result.usage);ocr.push(result.candidates);
    }
    const final=await inference.analyze(prepared,'fusion',{post:prepared.input,captionCandidates:caption.candidates,ocrCandidates:ocr,transcripts:extracted.map(m=>m.transcript)},[],signal);addUsage(final.usage);
    log({postId:prepared.input.post_id,stage:'fusion',candidates:final.candidates.length});
    return {candidates:final.candidates,media:extracted.map(m=>m.coverage),model:'deepseek/deepseek-v4.1-flash',usage,elapsedMs:Date.now()-started};
  };
}
