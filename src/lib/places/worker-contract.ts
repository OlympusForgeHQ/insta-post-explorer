import { z } from 'zod';
import { placeCandidateSchema, MAX_CANDIDATES_PER_POST } from '@/lib/places/candidates';
import { PLACE_CATEGORY_KEYS } from '@/lib/places/categories';

export const PLACES_WORKER_VERSION = 'places-multimodal-v1';
export const PLACES_WORKER_MODEL = 'deepseek/deepseek-v4.1-flash';
export const PLACES_WORKER_LEASE_MS = 900_000;
export const PLACES_WORKER_MAX_BYTES = 250 * 1024 * 1024;
const id = z.string().trim().min(1).max(200);
export const workerCandidatesSchema = z.object({
  candidates: z.array(placeCandidateSchema.extend({
    category: z.enum(PLACE_CATEGORY_KEYS),
    categoryReason: z.string().trim().min(1).max(500),
    evidence: placeCandidateSchema.shape.evidence.min(1),
  })).max(MAX_CANDIDATES_PER_POST),
}).strict();
export const workerResultSchema = workerCandidatesSchema.extend({
  media: z.array(z.object({
    mediaId: id, kind: z.enum(['IMAGE','VIDEO']), durationMs: z.number().int().positive().max(300_000).nullable(),
    frameCount: z.number().int().min(1).max(12), audio: z.enum(['transcribed','absent','not_applicable']),
  }).strict()).max(20),
  model: z.literal(PLACES_WORKER_MODEL),
  usage: z.object({inputTokens:z.number().int().nonnegative().max(2_000_000),outputTokens:z.number().int().nonnegative().max(100_000)}).strict(),
  elapsedMs:z.number().int().nonnegative().max(1_200_000),
}).strict();
const lease={jobId:id,leaseToken:z.string().uuid()};
export const workerCommandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('prepare'),postId:id}).strict(),
  z.object({action:z.literal('enqueue'),postId:id.optional(),cursor:id.optional()}).strict(),
  z.object({action:z.literal('claim'),postId:id.optional()}).strict(),
  z.object({action:z.literal('heartbeat'),...lease}).strict(),
  z.object({action:z.literal('complete'),...lease,result:workerResultSchema}).strict(),
  z.object({action:z.literal('preview'),postId:id,inputHash:z.string().regex(/^[a-f0-9]{64}$/),result:workerResultSchema}).strict(),
  z.object({action:z.literal('fail'),...lease,code:z.enum(['MEDIA_UNAVAILABLE','MEDIA_LIMIT','INFERENCE_FAILED','INVALID_RESULT','WORKER_STOPPING','WORKER_TIMEOUT'])}).strict(),
]);
export type WorkerResult=z.infer<typeof workerResultSchema>;
export type WorkerCommand=z.infer<typeof workerCommandSchema>;
