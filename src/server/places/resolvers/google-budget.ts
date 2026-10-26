import 'server-only';
import {prisma} from '@/server/db';
import {setAuditAction} from '@/server/audit-log';
import {Prisma} from '@prisma/client';
import {lockCompletionAuthority,type CompletionAuthority} from '../completion-ownership';

// Reservations are counted from append-only audit, with a job JSON receipt.
// Reserve before spending; failed requests still consume budget.
export async function reserveGoogleRequest(ownerId:string,postId:string,authority?:CompletionAuthority):Promise<void> {
  const now=new Date(),month=now.toISOString().slice(0,7);
  const pacificMonth=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'}).format(now);
  // Preserve the former guard's UTC and Pacific bounds. 07:00 UTC includes
  // the whole Pacific month in either DST regime (one extra hour in winter).
  const windows=[{month,start:new Date(month+'-01T00:00:00.000Z')},
    {month:pacificMonth,start:new Date(pacificMonth+'-01T07:00:00.000Z')}];
  const cap=Number(process.env.PLACES_GOOGLE_MONTHLY_CAP??4000);
  const baseline=Number(process.env.PLACES_GOOGLE_BASELINE_REQUESTS??0);
  if(!Number.isSafeInteger(cap)||cap<1||cap>4000||!Number.isSafeInteger(baseline)||baseline<0)throw Error('GOOGLE_PLACES_BUDGET_INVALID');
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-google-budget:${ownerId}`},0))::text`;
    if(authority)await lockCompletionAuthority(ownerId,postId,authority,tx);
    // The append-only audit survives deletion of posts/jobs and records exactly
    // one reservation update. Job counters alone would refund deleted spending.
    for(const window of windows){
      const used=await tx.auditEvent.count({where:{ownerId,action:'places.google.reserve',tableName:'place_analysis_jobs',operation:'UPDATE',occurredAt:{gte:window.start}}});
      if(used+(process.env.PLACES_GOOGLE_BASELINE_MONTH===window.month?baseline:0)>=cap)throw Error('GOOGLE_PLACES_BUDGET_EXHAUSTED');
    }
    const job=authority?{id:authority.jobId}:await tx.placeAnalysisJob.findFirst({where:{ownerId,postId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
    if(!job)throw Error('GOOGLE_PLACES_BUDGET_CONTEXT_REQUIRED');
    await setAuditAction(tx,'places.google.reserve');
    // JSONB patch is atomic with other writers and preserves existing receipts.
    const reserved=await tx.$executeRaw`UPDATE place_analysis_jobs SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{googleUsage}',
      jsonb_build_object('month',${month}::text,'requests',CASE WHEN result->'googleUsage'->>'month'=${month}
      THEN COALESCE((result->'googleUsage'->>'requests')::integer,0)+1 ELSE 1 END))
      WHERE id=${job.id} AND owner_id=${ownerId} AND post_id=${postId}
      ${authority?Prisma.sql`AND status='PROCESSING' AND lease_owner=${authority.leaseToken}
        AND lease_expires_at>clock_timestamp() AND result->'completionInProgress'->>'token'=${authority.completionToken}`:Prisma.empty}`;
    if(reserved!==1)throw Error(authority?'PLACES_LEASE_LOST':'GOOGLE_PLACES_BUDGET_CONTEXT_REQUIRED');
  });
}
