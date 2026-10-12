// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const tx=vi.hoisted(()=>({$queryRaw:vi.fn(),$executeRaw:vi.fn(),auditEvent:{count:vi.fn(async()=>0)},
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
