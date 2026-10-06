import type {MediaExtractionLimits} from '../places/media.js';

export const CLASSIFICATION_JOB_TIMEOUT_MS=5_400_000;
export const CLASSIFICATION_MEDIA_LIMITS:Readonly<MediaExtractionLimits>={
 maxVideoBytes:600*1024*1024,
 maxDurationMs:3_600_000,
 downloadTimeoutMs:600_000,
 processTimeoutMs:CLASSIFICATION_JOB_TIMEOUT_MS,
};
