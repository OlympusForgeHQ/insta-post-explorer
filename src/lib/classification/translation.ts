// The pure JSON contract is shared with the independently packaged consumer.
export * from '../../../services/worker/src/classification/translation-contract';

import {z} from 'zod';
import {translationResultSchema} from '../../../services/worker/src/classification/translation-contract';
const lease={jobId:z.string().min(1).max(256),leaseToken:z.string().uuid()};
export const translationCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('claim')}).strict(),
 z.object({action:z.literal('heartbeat'),...lease}).strict(),
 z.object({action:z.literal('complete'),...lease,result:translationResultSchema}).strict(),
 z.object({action:z.literal('fail'),...lease,code:z.enum(['INFERENCE_FAILED','INFERENCE_BUSY','INVALID_RESULT','CAPTION_LIMIT','WORKER_STOPPING','WORKER_TIMEOUT'])}).strict(),
]);
