import 'server-only';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/server/db';
import {PLACES_WORKER_VERSION} from '@/lib/places/worker-contract';
import {placesJobMetadata} from './learning';
import {setAuditAction} from '@/server/audit-log';

export type CompletionAuthority={jobId:string;leaseToken:string;completionToken:string};
export type CompletionInProgress={requestHash:string;leaseHash:string;token:string};
export function withoutCompletionInProgress(result:Prisma.JsonValue|null):Prisma.JsonObject{
  const metadata={...placesJobMetadata(result)};
  delete metadata.completionInProgress;
  return metadata;
}
// The comparison time is evaluated after the row has been read (and, for
// reservations, after its lock). An older producer must not borrow a new lease.
export async function assertCompletionAuthority(ownerId:string,postId:string,authority:CompletionAuthority,client:Prisma.TransactionClient=prisma):Promise<void>{
  const job=await client.placeAnalysisJob.findFirst({where:{id:authority.jobId,ownerId,postId,analysisVersion:PLACES_WORKER_VERSION}});
  const marker=placesJobMetadata(job?.result??null).completionInProgress as CompletionInProgress|undefined;
  const leaseHash=createHash('sha256').update(JSON.stringify(authority.leaseToken)).digest('hex');
  if(!job||job.status!=='PROCESSING'||job.leaseOwner!==authority.leaseToken||!job.leaseExpiresAt||job.leaseExpiresAt<=new Date()||
    marker?.token!==authority.completionToken||marker.leaseHash!==leaseHash)throw Error('PLACES_LEASE_LOST');
}
export async function lockCompletionAuthority(ownerId:string,postId:string,authority:CompletionAuthority,tx:Prisma.TransactionClient):Promise<void>{
  await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${authority.jobId} AND owner_id=${ownerId} AND post_id=${postId} FOR UPDATE`;
  await assertCompletionAuthority(ownerId,postId,authority,tx);
}

// A caught failure has no producer left to wait for. Release only that producer;
// a committed receipt or a replacement lease/token must remain untouched.
export async function releaseCompletionAuthority(ownerId:string,postId:string,authority:CompletionAuthority):Promise<void>{
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${authority.jobId} AND owner_id=${ownerId} AND post_id=${postId} FOR UPDATE`;
    await setAuditAction(tx,'places.worker.completion_release');
    await tx.$executeRaw`UPDATE place_analysis_jobs SET result=result-'completionInProgress'
      WHERE id=${authority.jobId} AND owner_id=${ownerId} AND post_id=${postId}
        AND analysis_version=${PLACES_WORKER_VERSION} AND status='PROCESSING'
        AND lease_owner=${authority.leaseToken} AND lease_expires_at>clock_timestamp()
        AND result->'completionInProgress'->>'token'=${authority.completionToken}`;
  });
}
