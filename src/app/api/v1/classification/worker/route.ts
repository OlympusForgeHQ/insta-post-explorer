import {requireExternalApiKey} from '@/auth/api-key';
import {getConfiguredOwnerId} from '@/auth/config';
import {classificationCommandSchema} from '@/lib/classification/contract';
import {externalApiJson,externalApiError,externalApiErrorResponse} from '@/contracts/api/error';
import {readBoundedJsonBody,RequestBodyTooLargeError,UnsupportedMediaTypeError} from '@/server/http';
import {claimClassification,heartbeatClassification,completeClassification,failClassification} from '@/server/classification/jobs';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 try{
  requireExternalApiKey(request,'classification-worker');const owner=getConfiguredOwnerId();const c=classificationCommandSchema.parse(await readBoundedJsonBody(request,128*1024));
  switch(c.action){
   case 'claim':return externalApiJson(c.protocol===2?await (c.learning?claimClassification(owner,{learning:true}):claimClassification(owner)):null);
   case 'heartbeat':return externalApiJson(await heartbeatClassification(owner,c));
   case 'complete':return externalApiJson(await completeClassification(owner,c));
   case 'fail':return externalApiJson(await failClassification(owner,c));
  }
 }catch(error){
  if(error instanceof RequestBodyTooLargeError)return externalApiError('BAD_REQUEST','Request body too large',413);
  if(error instanceof UnsupportedMediaTypeError||error instanceof SyntaxError)return externalApiError('BAD_REQUEST','Invalid JSON',400);
  const code=error instanceof Error?error.message:'';
  if(code==='CLASSIFICATION_JOB_NOT_FOUND')return externalApiError('NOT_FOUND','Job not found',404);
  if(['CLASSIFICATION_INPUT_STALE','CLASSIFICATION_LEASE_LOST'].includes(code))return externalApiJson({error:{code,message:'The input or claim is no longer current'}},{status:409});
  if(code==='CLASSIFICATION_MEDIA_INCOMPLETE')return externalApiError('BAD_REQUEST','Incomplete media coverage',400);
  return externalApiErrorResponse(error);
 }
}
