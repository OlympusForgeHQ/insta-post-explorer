import {requireExternalApiKey} from '@/auth/api-key';
import {getConfiguredOwnerId} from '@/auth/config';
import {externalApiJson,externalApiErrorResponse} from '@/contracts/api/error';
import {evaluateWorkerLearning} from '@/server/classification/learning-evaluation';
export const runtime='nodejs';
export async function POST(request:Request){
 try{requireExternalApiKey(request,'classification-worker');return externalApiJson(await evaluateWorkerLearning(getConfiguredOwnerId()));}catch(error){return externalApiErrorResponse(error);}
}
