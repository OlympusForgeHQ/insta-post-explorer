import {z} from 'zod';

const mediaSchema=z.object({mediaId:z.string(),kind:z.enum(['IMAGE','VIDEO']),durationMs:z.number().nullable(),audio:z.enum(['transcribed','absent','not_applicable'])});

function literalCaptionExcerpt(excerpt:string,caption:string):string{
  if(caption.includes(excerpt))return excerpt;
  // Restore a verbatim source span for whitespace-only variations. Never
  // translate, case-fold, paraphrase, truncate or manufacture a quotation.
  const parts=excerpt.trim().split(/\s+/u);
  const pattern=parts.map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
  const match=pattern?new RegExp(pattern,'u').exec(caption)?.[0]:undefined;
  if(!match||match.length>500)throw Error('PLACES_EVIDENCE_INVALID');
  return match;
}

export function groundPlacesEvidence(candidates:Record<string,unknown>[],caption:string,media:unknown[]):Record<string,unknown>[]{
  const coverage=new Map(media.map(item=>{const parsed=mediaSchema.parse(item);return [parsed.mediaId,parsed] as const;}));
  return candidates.map(candidate=>{
    if(!Array.isArray(candidate.evidence))throw Error('PLACES_EVIDENCE_INVALID');
    const evidence=candidate.evidence.map((raw:unknown)=>{
      if(!raw||typeof raw!=='object')throw Error('PLACES_EVIDENCE_INVALID');
      const proof=raw as Record<string,unknown>;
      if(typeof proof.excerpt!=='string'||!proof.excerpt.trim())throw Error('PLACES_EVIDENCE_INVALID');
      if(proof.type==='CAPTION')return {...proof,excerpt:literalCaptionExcerpt(proof.excerpt,caption)};
      if(['AUDIO_TRANSCRIPT','VIDEO_OCR','VISUAL_LANDMARK'].includes(String(proof.type))){
        const source=typeof proof.mediaId==='string'?coverage.get(proof.mediaId):undefined;
        const timestamp=proof.videoTimestampMs;
        if(!source||typeof timestamp!=='number'||!Number.isInteger(timestamp)||timestamp<0||timestamp>(source.durationMs??0)||
          (proof.type==='AUDIO_TRANSCRIPT'&&source.audio!=='transcribed'))throw Error('PLACES_EVIDENCE_INVALID');
      }
      return {...proof};
    });
    return {...candidate,evidence};
  });
}
