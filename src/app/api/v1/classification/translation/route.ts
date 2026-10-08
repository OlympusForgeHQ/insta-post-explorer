import {requireExternalApiKey} from '@/auth/api-key';
import {getConfiguredOwnerId} from '@/auth/config';
import {translationCommandSchema} from '@/lib/classification/translation';
import {externalApiJson,externalApiError,externalApiErrorResponse} from '@/contracts/api/error';
import {readBoundedJsonBody,RequestBodyTooLargeError,UnsupportedMediaTypeError} from '@/server/http';
import {heartbeatClassification} from '@/server/classification/jobs';
import {claimCaptionTranslation,completeCaptionTranslation,failCaptionTranslation} from '@/server/classification/translation-jobs';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 try{
  requireExternalApiKey(request,'classification-worker');const owner=getConfiguredOwnerId();const c=translationCommandSchema.parse(await readBoundedJsonBody(request,1024*1024));
  switch(c.action){
   case 'claim':return externalApiJson(process.env.CAPTION_TRANSLATION_ENABLED==='1'?await claimCaptionTranslation(owner):null);
   case 'heartbeat':return externalApiJson(await heartbeatClassification(owner,c));
   case 'complete':return externalApiJson(await completeCaptionTranslation(owner,c));
   case 'fail':return externalApiJson(await failCaptionTranslation(owner,c));
  }
 }catch(error){
  if(error instanceof RequestBodyTooLargeError)return externalApiError('BAD_REQUEST','Request body too large',413);
  if(error instanceof UnsupportedMediaTypeError||error instanceof SyntaxError)return externalApiError('BAD_REQUEST','Invalid JSON',400);
  const code=error instanceof Error?error.message:'';
  if(code==='CLASSIFICATION_JOB_NOT_FOUND')return externalApiError('NOT_FOUND','Job not found',404);
  if(['CLASSIFICATION_INPUT_STALE','CLASSIFICATION_LEASE_LOST'].includes(code))return externalApiJson({error:{code,message:'The input or claim is no longer current'}},{status:409});
  if(['TRANSLATION_TOKENS_CHANGED','TRANSLATION_STRUCTURE_CHANGED'].includes(code))return externalApiError('BAD_REQUEST','Protected source tokens changed',400);
  return externalApiErrorResponse(error);
 }
}
