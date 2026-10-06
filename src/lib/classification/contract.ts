import {z} from 'zod';
import {SYNC_MAIN_THEMES} from '@/lib/sync/enrich-post';
import {tagSlug} from '@/lib/import/normalize';
export const CLASSIFICATION_VERSION='post-classification-v1';
export const CLASSIFICATION_MODEL='deepseek/deepseek-v4.1-flash';
export const CLASSIFICATION_LEASE_MS=90_000;
export const CLASSIFICATION_MAX_VIDEO_BYTES=600*1024*1024;
export const CLASSIFICATION_MAX_DURATION_MS=3_600_000;
export const CLASSIFICATION_JOB_TIMEOUT_MS=5_400_000;
export const CLASSIFICATION_SIGNED_URL_SECONDS=7_200;
const id=z.string().min(1).max(256);
export const classificationCoverageSchema=z.object({mediaId:id,kind:z.enum(['IMAGE','VIDEO']),durationMs:z.number().int().positive().max(CLASSIFICATION_MAX_DURATION_MS).nullable(),frameCount:z.number().int().min(1).max(12),audio:z.enum(['transcribed','absent','not_applicable'])}).strict();
const tag=z.string().trim().min(2).max(80).refine(s=>tagSlug(s).length>0);
export const classificationOutputSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('SUCCEEDED'),mainTheme:z.enum(SYNC_MAIN_THEMES).describe('Choose the most specific existing theme supported by the actual content. Divers covers clearly understood subjects outside the other seven themes, including animals, adoption, culture or personal stories; it is a valid classification, not a filler tag or a fallback for unknown content. Cuisine includes ingredient and culinary product information, equipment and general cooking, including posts without a recipe. Sucré and Salé cover sweet and savoury recipes; Restaurant covers recommendations of dining venues; Voyages covers travel; Sport covers exercise; Astuce covers practical advice.'),tags:z.array(tag).min(3).max(5).describe('Choose three to five precise French tags for any actual subject, including subjects classified as Divers. The catalog is not restricted to food or lifestyle. Reuse relevant existing names, and create descriptive tags when necessary. Ground every tag in the evidence; never fill the list with generic words or repeat the theme.'),reason:z.string().trim().min(1).max(1000)}).strict(),
 z.object({status:z.literal('NEEDS_REVIEW').describe('Use only when the available evidence cannot support a reliable theme and three meaningful tags. A clearly understood subject outside the other seven themes belongs in Divers; an ingredient presentation may belong in Cuisine even without a recipe.'),mainTheme:z.null(),tags:z.array(tag).max(0),reason:z.string().trim().min(1).max(1000)}).strict(),
]).superRefine((result,ctx)=>{
 if(result.status==='SUCCEEDED'){
  const keys=result.tags.map(tagSlug);
  if(new Set(keys).size!==keys.length||keys.includes(tagSlug(result.mainTheme)))ctx.addIssue({code:'custom',message:'Tags must be distinct and must not repeat the theme'});
 }
});
export const classificationResultSchema=z.object({
 status:z.enum(['SUCCEEDED','NEEDS_REVIEW']),mainTheme:z.enum(SYNC_MAIN_THEMES).nullable(),tags:z.array(tag).max(5),reason:z.string().trim().min(1).max(1000),
 media:z.array(classificationCoverageSchema).min(1).max(20),model:z.literal(CLASSIFICATION_MODEL),usage:z.object({inputTokens:z.number().int().nonnegative().max(2_000_000),outputTokens:z.number().int().nonnegative().max(100_000)}).strict(),elapsedMs:z.number().int().nonnegative().max(CLASSIFICATION_JOB_TIMEOUT_MS),
}).strict().superRefine((result,ctx)=>{if(!classificationOutputSchema.safeParse({status:result.status,mainTheme:result.mainTheme,tags:result.tags,reason:result.reason}).success)ctx.addIssue({code:'custom',message:'Invalid classification'});});
const lease={jobId:id,leaseToken:z.string().uuid()};
export const classificationCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('claim')}).strict(),
 z.object({action:z.literal('heartbeat'),...lease}).strict(),
 z.object({action:z.literal('complete'),...lease,result:classificationResultSchema}).strict(),
 z.object({action:z.literal('fail'),...lease,code:z.enum(['MEDIA_UNAVAILABLE','MEDIA_LIMIT','INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT','WORKER_STOPPING','WORKER_TIMEOUT'])}).strict(),
]);
export type ClassificationResult=z.infer<typeof classificationResultSchema>;
