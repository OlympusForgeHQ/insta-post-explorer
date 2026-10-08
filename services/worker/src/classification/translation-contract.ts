import {z} from 'zod';
const CLASSIFICATION_MODEL='deepseek/deepseek-v4.1-flash';
export const CAPTION_TRANSLATION_VERSION='caption-translation-v1';
export const CAPTION_TRANSLATION_TIMEOUT_MS=900_000;
const fields={decision:z.enum(['TRANSLATED','UNCHANGED','NEEDS_REVIEW']),sourceLanguages:z.array(z.string().regex(/^[a-z]{2,3}$/)).min(1).max(16),translatedCaption:z.string().min(1).max(200_000).refine(text=>text.trim().length>0,'Empty translation').nullable(),reason:z.string().trim().min(1).max(1000)};
const baseOutputSchema=z.object(fields).strict();
type Output=z.infer<typeof baseOutputSchema>;
function checkOutcome(value:Output,ctx:z.RefinementCtx){
 const foreign=value.sourceLanguages.some(x=>!['en','fr','zxx','und'].includes(x));
 if(new Set(value.sourceLanguages).size!==value.sourceLanguages.length||(value.decision==='TRANSLATED'&&(!foreign||!value.translatedCaption||value.sourceLanguages.includes('und')))||(value.decision!=='TRANSLATED'&&value.translatedCaption!==null)||(value.decision==='UNCHANGED'&&value.sourceLanguages.some(x=>!['en','fr','zxx'].includes(x))))ctx.addIssue({code:'custom',message:'Inconsistent translation outcome'});
}
export const translationOutputSchema=baseOutputSchema.superRefine(checkOutcome);
export type TranslationOutput=z.infer<typeof translationOutputSchema>;
export const translationResultSchema=z.object({...fields,model:z.literal(CLASSIFICATION_MODEL),usage:z.object({inputTokens:z.number().int().nonnegative().max(2_000_000),outputTokens:z.number().int().nonnegative().max(200_000)}).strict(),elapsedMs:z.number().int().nonnegative().max(CAPTION_TRANSLATION_TIMEOUT_MS)}).strict().superRefine(checkOutcome);
export type TranslationResult=z.infer<typeof translationResultSchema>;
export function protectedCaptionTokens(text:string){
 return (text.match(/https?:\/\/[^\s<>"“”]+|[@#][\p{L}\p{N}_.]+|\p{N}+(?:[.,:/-]\p{N}+)*/gu)??[]).map(t=>t.replace(/[.!?,;:)]*$/u,'')).sort();
}
export function validateTranslationContent(source:string,result:TranslationOutput){
 if(result.decision==='TRANSLATED'){
  const structure=(text:string)=>JSON.stringify([text.match(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu)??[],text.match(/\r\n|\r|\n/g)??[]]);
  if(structure(source)!==structure(result.translatedCaption!))throw Error('TRANSLATION_STRUCTURE_CHANGED');
 }
 if(result.decision==='TRANSLATED'&&JSON.stringify(protectedCaptionTokens(source))!==JSON.stringify(protectedCaptionTokens(result.translatedCaption!)))throw Error('TRANSLATION_TOKENS_CHANGED');
}

// Provider segments cover the source exactly. Only foreign segments are replaced;
// English/French/nonlinguistic source is copied locally, never regenerated.
export const translationSegmentsSchema=z.object({segments:z.array(z.object({sourceText:z.string().min(1).max(4000),...fields}).strict().superRefine(checkOutcome)).min(1).max(1000)}).strict();
export function assembleTranslation(source:string,value:unknown):TranslationOutput{
 const {segments}=translationSegmentsSchema.parse(value);
 if(segments.map(s=>s.sourceText).join('')!==source)throw Error('TRANSLATION_SOURCE_CHANGED');
 const languages=[...new Set(segments.flatMap(s=>s.sourceLanguages))];
 for(const segment of segments){
  if(segment.decision==='TRANSLATED'&&segment.sourceLanguages.some(l=>['en','fr','zxx'].includes(l)))throw Error('TRANSLATION_MIXED_SEGMENT');
  if(segment.decision==='TRANSLATED'){
   const edge=/^(\s*)([\s\S]*?)(\s*)$/u.exec(segment.sourceText)!;
   segment.translatedCaption=edge[1]+segment.translatedCaption!.trim()+edge[3];
  }
  validateTranslationContent(segment.sourceText,segment);
 }
 if(segments.some(s=>s.decision==='NEEDS_REVIEW'))return {decision:'NEEDS_REVIEW',sourceLanguages:languages,translatedCaption:null,reason:'Ambiguous source segment'};
 const changed=segments.some(s=>s.decision==='TRANSLATED');
 return translationOutputSchema.parse({decision:changed?'TRANSLATED':'UNCHANGED',sourceLanguages:languages,translatedCaption:changed?segments.map(s=>s.decision==='TRANSLATED'?s.translatedCaption:s.sourceText).join(''):null,reason:changed?'Foreign segments translated; other source segments copied unchanged.':'No foreign prose'});
}
