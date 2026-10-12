import 'server-only';
import {prisma} from '@/server/db';
import {setAuditAction} from '@/server/audit-log';

// Reservations are counted from append-only audit, with a job JSON receipt.
// Reserve before spending; failed requests still consume budget.
export async function reserveGoogleRequest(ownerId:string,postId:string):Promise<void> {
  const month=new Date().toISOString().slice(0,7);
  const cap=Number(process.env.PLACES_GOOGLE_MONTHLY_CAP??4000);
  const baseline=process.env.PLACES_GOOGLE_BASELINE_MONTH===month?Number(process.env.PLACES_GOOGLE_BASELINE_REQUESTS??0):0;
  if(!Number.isSafeInteger(cap)||cap<1||cap>4000||!Number.isSafeInteger(baseline)||baseline<0)throw Error('GOOGLE_PLACES_BUDGET_INVALID');
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-google-budget:${ownerId}`},0))::text`;
    // The append-only audit survives deletion of posts/jobs and records exactly
    // one reservation update. Job counters alone would refund deleted spending.
    const used=await tx.auditEvent.count({where:{ownerId,action:'places.google.reserve',tableName:'place_analysis_jobs',operation:'UPDATE',
      occurredAt:{gte:new Date(month+'-01T00:00:00.000Z')}}});
    if(used+baseline>=cap)throw Error('GOOGLE_PLACES_BUDGET_EXHAUSTED');
    const job=await tx.placeAnalysisJob.findFirst({where:{ownerId,postId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
    if(!job)throw Error('GOOGLE_PLACES_BUDGET_CONTEXT_REQUIRED');
    await setAuditAction(tx,'places.google.reserve');
    // JSONB patch is atomic with other writers and preserves existing receipts.
    const reserved=await tx.$executeRaw`UPDATE place_analysis_jobs SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{googleUsage}',
      jsonb_build_object('month',${month}::text,'requests',CASE WHEN result->'googleUsage'->>'month'=${month}
      THEN COALESCE((result->'googleUsage'->>'requests')::integer,0)+1 ELSE 1 END))
      WHERE id=${job.id} AND owner_id=${ownerId}`;
    if(reserved!==1)throw Error('GOOGLE_PLACES_BUDGET_CONTEXT_REQUIRED');
  });
}
