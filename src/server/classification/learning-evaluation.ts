import 'server-only';
import {prisma} from '@/server/db';
export async function evaluateWorkerLearning(ownerId:string){
 const since=new Date(Date.now()-7*86400_000);
 const rows=await prisma.workerLearningObservation.findMany({where:{ownerId,createdAt:{gte:since}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1001});
 const truncated=rows.length>1000;const observations=rows.slice(0,1000);
 const domains=['classification','translation'].map(domain=>{
  const attempts=observations.filter(o=>o.domain===domain),latest=[...new Map([...attempts].reverse().map(o=>[o.jobId,o])).values()];
  const strategies=[...new Set(attempts.map(o=>o.strategy))].map(strategy=>{
   const group=attempts.filter(o=>o.strategy===strategy),durations=group.map(o=>o.elapsedMs).sort((a,b)=>a-b);
   return {strategy,attempts:group.length,successes:group.filter(o=>o.outcome==='SUCCEEDED').length,p95ElapsedMs:durations[Math.max(0,Math.ceil(durations.length*.95)-1)]??0,inputTokens:group.reduce((sum,o)=>sum+o.inputTokens,0),outputTokens:group.reduce((sum,o)=>sum+o.outputTokens,0)};
  });
  return {domain,attempts:attempts.length,jobs:latest.length,latestOutcomes:Object.fromEntries(['SUCCEEDED','NEEDS_REVIEW','FAILED','RETRY'].map(s=>[s,latest.filter(o=>o.outcome===s).length])),failureFamilies:Object.fromEntries([...new Set(attempts.flatMap(o=>o.signals))].map(s=>[s,attempts.filter(o=>o.signals.includes(s)).length])),strategies};
 });
 const verifiedExamples=await prisma.workerLearningExample.groupBy({by:['domain'],where:{ownerId,enabled:true},_count:true});
 return {version:1,since:since.toISOString(),evaluatedAt:new Date().toISOString(),limit:1000,truncated,domains,verifiedExamples:verifiedExamples.map(g=>({domain:g.domain,count:g._count})),semanticAccuracy:'UNKNOWN_REQUIRES_VERIFIED_EVALUATION',interpretation:'Operational outcomes only; strategy groups are not randomized and must not be treated as causal quality comparisons.'};
}
