import { requireExternalApiKey } from '@/auth/api-key';
import { getConfiguredOwnerId } from '@/auth/config';
import { externalApiError, externalApiErrorResponse, externalApiJson } from '@/contracts/api/error';
import { workerCommandSchema } from '@/lib/places/worker-contract';
import { readBoundedJsonBody, RequestBodyTooLargeError, UnsupportedMediaTypeError } from '@/server/http';
import { claimPlacesJob, completePlacesJob, enqueuePlacesPosts, failPlacesJob, heartbeatPlacesJob, preparePlacesPost, previewPlacesResult } from '@/server/places/worker';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){
  try{
    requireExternalApiKey(request,'places-worker');
    const ownerId=getConfiguredOwnerId();
    const command=workerCommandSchema.parse(await readBoundedJsonBody(request,512*1024));
    switch(command.action){
      case 'prepare':return externalApiJson(await preparePlacesPost(ownerId,command.postId));
      case 'enqueue':return externalApiJson(await enqueuePlacesPosts(ownerId,command));
      case 'claim':return externalApiJson(await claimPlacesJob(ownerId,command));
      case 'heartbeat':return externalApiJson(await heartbeatPlacesJob(ownerId,command));
      case 'complete':return externalApiJson(await completePlacesJob(ownerId,command));
      case 'preview':return externalApiJson(await previewPlacesResult(ownerId,command));
      case 'fail':return externalApiJson(await failPlacesJob(ownerId,command));
    }
  }catch(error){
    if(error instanceof RequestBodyTooLargeError)return externalApiError('BAD_REQUEST','Request body too large',413);
    if(error instanceof UnsupportedMediaTypeError||error instanceof SyntaxError)return externalApiError('BAD_REQUEST','Invalid JSON request',400);
    const code=error instanceof Error?error.message:'';
    if(['POST_NOT_FOUND','PLACES_JOB_NOT_FOUND'].includes(code))return externalApiError('NOT_FOUND','Resource not found',404);
    if(['PLACES_LEASE_LOST','PLACES_INPUT_STALE','POST_NOT_PLACES_ELIGIBLE'].includes(code))return externalApiJson({error:{code,message:'The post or claim is no longer current'}},{status:409});
    if(['PLACES_MEDIA_INCOMPLETE','PLACES_EVIDENCE_INVALID'].includes(code))return externalApiJson({error:{code,message:'Analysis evidence is incomplete or invalid'}},{status:400});
    if(code==='PLACES_MEDIA_UNAVAILABLE')return externalApiError('SERVICE_UNAVAILABLE','Verified media unavailable',503);
    return externalApiErrorResponse(error);
  }
}
