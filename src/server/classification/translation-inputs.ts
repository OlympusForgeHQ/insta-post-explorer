import 'server-only';
import {createHash} from 'node:crypto';
import {CAPTION_TRANSLATION_VERSION,translationOutputSchema} from '@/lib/classification/translation';
export function captionSourceHash(ownerId:string,postId:string,caption:string){return createHash('sha256').update(JSON.stringify({version:CAPTION_TRANSLATION_VERSION,ownerId,postId,caption})).digest('hex');}
export function currentCaptionTranslation(post:{id:string;ownerId:string;caption:string;learningExamples?:{sourceHash:string;payload:unknown}[]},jobs:{ownerId:string;inputHash:string;result:unknown}[],compact=false){
 const manual=post.learningExamples?.find(e=>e.sourceHash===captionSourceHash(post.ownerId,post.id,post.caption));
 if(manual){const reviewed=translationOutputSchema.safeParse(manual.payload);if(reviewed.success)return reviewed.data.decision==='TRANSLATED'?{text:compact?reviewed.data.translatedCaption!.slice(0,500):reviewed.data.translatedCaption!,sourceLanguages:reviewed.data.sourceLanguages}:undefined;}
 const job=jobs.find(j=>j.ownerId===post.ownerId&&j.inputHash===captionSourceHash(post.ownerId,post.id,post.caption));
 if(!job||!job.result||typeof job.result!=='object')return undefined;
 const r=job.result as Record<string,unknown>;
 const parsed=translationOutputSchema.safeParse({decision:r.decision,sourceLanguages:r.sourceLanguages,translatedCaption:r.translatedCaption,reason:r.reason});
 if(!parsed.success||parsed.data.decision!=='TRANSLATED')return undefined;
 return {text:compact?parsed.data.translatedCaption!.slice(0,500):parsed.data.translatedCaption!,sourceLanguages:parsed.data.sourceLanguages};
}
