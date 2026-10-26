// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const tx=vi.hoisted(()=>({$queryRaw:vi.fn(),$executeRaw:vi.fn(),auditEvent:{count:vi.fn<(args:unknown)=>Promise<number>>(async()=>0)},
  placeAnalysisJob:{findFirst:vi.fn(async()=>({id:'deleted-between-selection-and-reservation'}))}}));
vi.mock('@/server/db',()=>({prisma:{$transaction:async(fn:(client:typeof tx)=>Promise<void>)=>fn(tx)}}));
vi.mock('@/server/audit-log',()=>({setAuditAction:vi.fn()}));
import {reserveGoogleRequest} from '@/server/places/resolvers/google-budget';
it('refuses to spend when concurrent deletion prevents writing the reservation',async()=>{
  tx.$executeRaw.mockResolvedValueOnce(0);
  await expect(reserveGoogleRequest('owner','post')).rejects.toThrow('GOOGLE_PLACES_BUDGET_CONTEXT_REQUIRED');
  tx.$executeRaw.mockResolvedValueOnce(1);
  await expect(reserveGoogleRequest('owner','post')).resolves.toBeUndefined();
});
it('refuses a worker reservation after its exact job is terminal',async()=>{
 tx.$executeRaw.mockClear().mockResolvedValue(1);
 tx.auditEvent.count.mockResolvedValue(0);
 tx.placeAnalysisJob.findFirst.mockResolvedValueOnce({id:'claimed-job',status:'NEEDS_REVIEW'} as never);
 await expect(reserveGoogleRequest('owner','post',{jobId:'claimed-job',leaseToken:'lease',completionToken:'completion'}))
  .rejects.toThrow('PLACES_LEASE_LOST');
 expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it('does not reset Pacific allowance when the UTC calendar month changes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
  tx.auditEvent.count.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(4000);
  try{
    await expect(reserveGoogleRequest('owner','post')).rejects.toThrow('GOOGLE_PLACES_BUDGET_EXHAUSTED');
    expect(tx.auditEvent.count.mock.calls[1][0]).toMatchObject({where:{occurredAt:{gte:new Date('2026-10-01T07:00:00Z')}}});
  }finally{vi.useRealTimers();}
});
