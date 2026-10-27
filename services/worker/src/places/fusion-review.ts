import type {Frame} from './media.js';
import {HERMES_MAX_IMAGES} from './inference-admission.js';

export function fusionReviewFrames(batches:Record<string,unknown>[][],frames:Frame[]):Frame[]{
 const candidates=batches.flat();
 const names=new Set(candidates.map(candidate=>typeof candidate.name==='string'?candidate.name.trim().toLowerCase():'').filter(Boolean));
 const confidence=(candidate:Record<string,unknown>)=>typeof candidate.confidence==='number'&&Number.isFinite(candidate.confidence)?candidate.confidence:1;
 const weak=(candidate:Record<string,unknown>)=>confidence(candidate)<.8;
 const targets=candidates.filter(candidate=>weak(candidate)||names.size>1)
  .sort((a,b)=>Number(weak(b))-Number(weak(a))||confidence(a)-confidence(b));
 const selected:Frame[]=[];
 const add=(frame:Frame)=>{if(selected.length<HERMES_MAX_IMAGES&&!selected.includes(frame))selected.push(frame);};
 for(const candidate of targets){
  if(!Array.isArray(candidate.evidence))continue;
  for(const raw of candidate.evidence){
   if(!raw||typeof raw!=='object')continue;
   const proof=raw as Record<string,unknown>;
   if(proof.type!=='VIDEO_OCR')continue;
   const target=frames.find(frame=>frame.mediaId===proof.mediaId&&frame.timestampMs===proof.videoTimestampMs);
   if(!target||selected.length>=HERMES_MAX_IMAGES)continue;
   const chronological=frames.filter(frame=>frame.mediaId===target.mediaId)
    .sort((a,b)=>a.timestampMs-b.timestampMs);
   const index=chronological.indexOf(target);
   const neighbors=[chronological[index-1],chronological[index+1]].filter((frame):frame is Frame=>Boolean(frame));
   // Reserve both immediate chronological neighbors: rounding can make the
   // opposite side one millisecond closer without making it better context.
   const needed=[target,...neighbors].filter(frame=>!selected.includes(frame));
   if(selected.length+needed.length>HERMES_MAX_IMAGES)continue;
   needed.forEach(add);
  }
 }
 return selected;
}
