import 'server-only';
import {prisma} from '@/server/db';
import {setAuditAction} from '@/server/audit-log';
import {Prisma} from '@prisma/client';
import {lockCompletionAuthority,type CompletionAuthority} from '../completion-ownership';

const budgetErrors=new Set([
  'WEB_SEARCH_BUDGET_EXHAUSTED',
  'WEB_SEARCH_JOB_BUDGET_EXHAUSTED',
  'WEB_SEARCH_BUDGET_CONTEXT_REQUIRED',
  'PLACES_LEASE_LOST',
]);

// Reserve before spending. Failed requests consume budget, and append-only audit
// prevents retries, result replacement or job deletion from refunding requests.
export async function reserveWebSearchRequest(ownerId:string,postId:string,authority?:CompletionAuthority):Promise<void> {
  if(process.env.PLACES_WEB_SEARCH_ENABLED!=='1')throw Error('WEB_SEARCH_DISABLED');
  const cap=Number(process.env.PLACES_WEB_SEARCH_MONTHLY_CAP??100);
  if(!Number.isSafeInteger(cap)||cap<1||cap>1000)throw Error('WEB_SEARCH_BUDGET_INVALID');
  try{
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`places-web-search-budget:${ownerId}`},0))::text`;
      if(authority)await lockCompletionAuthority(ownerId,postId,authority,tx);
      const month=new Date().toISOString().slice(0,7);
      const auditScope={ownerId,action:'places.web_search.reserve',tableName:'place_analysis_jobs',operation:'UPDATE'};
      const monthlyUsed=await tx.auditEvent.count({where:{
        ...auditScope,occurredAt:{gte:new Date(month+'-01T00:00:00.000Z')},
      }});
      if(monthlyUsed>=cap)throw Error('WEB_SEARCH_BUDGET_EXHAUSTED');
      const job=authority?{id:authority.jobId}:await tx.placeAnalysisJob.findFirst({
        where:{ownerId,postId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true},
      });
      if(!job)throw Error('WEB_SEARCH_BUDGET_CONTEXT_REQUIRED');
      // The per-job allowance is lifetime-wide, independently of the UTC month.
      const jobUsed=await tx.auditEvent.count({where:{
        ...auditScope,recordKey:{path:['id'],equals:job.id},
      }});
      if(jobUsed>=2)throw Error('WEB_SEARCH_JOB_BUDGET_EXHAUSTED');
      await setAuditAction(tx,'places.web_search.reserve');
      const reserved=await tx.$executeRaw`UPDATE place_analysis_jobs SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{webSearchUsage}',
        jsonb_build_object('month',${month}::text,'requests',${jobUsed+1}::integer))
        WHERE id=${job.id} AND owner_id=${ownerId} AND post_id=${postId}
        ${authority?Prisma.sql`AND status='PROCESSING' AND lease_owner=${authority.leaseToken}
          AND lease_expires_at>clock_timestamp() AND result->'completionInProgress'->>'token'=${authority.completionToken}`:Prisma.empty}`;
      if(reserved!==1)throw Error(authority?'PLACES_LEASE_LOST':'WEB_SEARCH_BUDGET_CONTEXT_REQUIRED');
    });
  }catch(error){
    throw Error(error instanceof Error&&budgetErrors.has(error.message)?error.message:'WEB_SEARCH_BUDGET_UNAVAILABLE');
  }
}
