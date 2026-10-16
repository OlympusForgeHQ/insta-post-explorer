import {z} from 'zod';
// Shared with the application: diagnostic codes never contain private payloads.
export const placesFailureCodes = ['MEDIA_UNAVAILABLE','MEDIA_DOWNLOAD_FAILED','MEDIA_DECODE_FAILED','MEDIA_TOOLS_UNAVAILABLE','MEDIA_LIMIT','ASR_UNAVAILABLE','ASR_FAILED','TEMP_STORAGE_UNAVAILABLE','INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT','PLACES_EVIDENCE_INVALID','PLACES_MEDIA_INCOMPLETE','WORKER_STOPPING','WORKER_TIMEOUT'] as const;
export const runtimeFailureCodes = new Set<string>(['ASR_UNAVAILABLE','MEDIA_TOOLS_UNAVAILABLE','TEMP_STORAGE_UNAVAILABLE']);
export const deferredFailureCodes = new Set<string>([...runtimeFailureCodes,'INFERENCE_BUSY']);
export const repairableFailureCodes = new Set<string>([...deferredFailureCodes,'MEDIA_UNAVAILABLE','MEDIA_DOWNLOAD_FAILED','INFERENCE_FAILED','WORKER_TIMEOUT']);


const strategySchema=z.enum(['standard','format_guidance','evidence_guidance']);
export const placesFailureSchema=z.enum(placesFailureCodes);
const shapeSchema=z.string().regex(/^(caption|image|video):(short|long):(single|multi)$/);
const outcomeSchema=z.object({attempt:z.number().int().min(1).max(6),status:z.enum(['FAILED','SUCCEEDED','NEEDS_REVIEW']),code:placesFailureSchema.optional(),strategy:strategySchema}).strict();
const stateSchema=z.object({version:z.literal(1),shape:shapeSchema,outcomes:z.array(outcomeSchema).max(3)}).strict();
export const placesLearningContextSchema=z.object({version:z.literal(1),strategy:strategySchema,recent:z.object({examined:z.number().int().min(0).max(100),formatFailures:z.number().int().min(0).max(100),evidenceFailures:z.number().int().min(0).max(100),successes:z.number().int().min(0).max(100)}).strict()}).strict();
export type PlacesLearningContext=z.infer<typeof placesLearningContextSchema>;
export type PlacesLearningState=z.infer<typeof stateSchema>;
export type PlacesLearningOutcome=z.infer<typeof outcomeSchema>;
export function readPlacesLearning(value:unknown):PlacesLearningState|null{
 const parsed=stateSchema.safeParse(value);return parsed.success?parsed.data:null;
}
export function placesInputShape(caption:string,media:ReadonlyArray<{kind:string}>){
 return `${media.some(m=>m.kind==='VIDEO')?'video':media.length?'image':'caption'}:${caption.length>1200?'long':'short'}:${media.length>1?'multi':'single'}`;
}
export function appendPlacesOutcome(previous:unknown,input:{shape:string}&Omit<PlacesLearningOutcome,'code'>&{code?:string}):PlacesLearningState{
 const {shape,...outcome}=input;
 const old=readPlacesLearning(previous);
 return stateSchema.parse({version:1,shape,outcomes:[...(old?.shape===shape?old.outcomes.filter(o=>o.attempt!==outcome.attempt):[]),outcome].slice(-3)});
}
export function selectPlacesLearning(shape:string,previous:unknown,recentValues:unknown[]):PlacesLearningContext{
 const recent={examined:0,formatFailures:0,evidenceFailures:0,successes:0};
 for(const value of recentValues.slice(0,100)){
  const state=readPlacesLearning(value);if(!state||state.shape!==shape)continue;
  const outcome=state.outcomes.at(-1);if(!outcome)continue;
  recent.examined++;
  if(outcome.status==='SUCCEEDED')recent.successes++;
  else if(outcome.status==='FAILED'){
   if(outcome.code==='INVALID_RESULT')recent.formatFailures++;
   if(outcome.code==='PLACES_EVIDENCE_INVALID')recent.evidenceFailures++;
  }
 }
 const prior=readPlacesLearning(previous),last=prior?.shape===shape?prior.outcomes.at(-1):undefined;
 const strategy=last?.status==='FAILED'&&last.code==='PLACES_EVIDENCE_INVALID'?'evidence_guidance'
  :last?.status==='FAILED'&&last.code==='INVALID_RESULT'?'format_guidance'
  :recent.evidenceFailures>=2&&recent.evidenceFailures>recent.successes?'evidence_guidance'
  :recent.formatFailures>=2&&recent.formatFailures>recent.successes?'format_guidance':'standard';
 return {version:1,strategy,recent};
}
export function placesLearningInstructions(context?:PlacesLearningContext):string{
 if(context?.strategy==='evidence_guidance')return 'Previous comparable analyses failed evidence validation. Check each candidate against the current original sources before returning it: literal contiguous caption excerpts, supplied media IDs, and actual transcript segment timestamps. Historical examples and inferred geography cannot serve as evidence. Do not invent or silently drop supported recommendations to pass validation.';
 if(context?.strategy==='format_guidance')return 'Previous comparable analyses returned invalid JSON. Before returning, check every field against the supplied JSON schema: no extra properties, no coordinates, all required fields, bounded strings and arrays. Preserve all supported recommendations; never truncate an itinerary to fit the response.';
 return '';
}
