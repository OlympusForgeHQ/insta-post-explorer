// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import type {Prisma} from '@prisma/client';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('server-only',()=>({}));
const harness=vi.hoisted(()=>({
  transaction:vi.fn(),
  tx:{
    $queryRaw:vi.fn(),$executeRaw:vi.fn(),
    auditEvent:{count:vi.fn()},
    placeAnalysisJob:{findFirst:vi.fn()},
  },
}));
vi.mock('@/server/db',()=>({prisma:{$transaction:harness.transaction}}));
import {reserveWebSearchRequest} from '@/server/places/resolvers/web-search-budget';

beforeEach(()=>{
  vi.stubEnv('PLACES_WEB_SEARCH_ENABLED','1');
  vi.stubEnv('PLACES_WEB_SEARCH_MONTHLY_CAP',undefined);
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});

describe('web research budget guards',()=>{
  const {tx}=harness;
  beforeEach(()=>{
    vi.clearAllMocks();
    harness.transaction.mockImplementation(async(fn:(client:typeof tx)=>Promise<void>)=>fn(tx));
    tx.$queryRaw.mockResolvedValue([]);
    tx.$executeRaw.mockResolvedValue(1);
    tx.auditEvent.count.mockResolvedValue(0);
    tx.placeAnalysisJob.findFirst.mockResolvedValue({id:'job'});
  });
  it('fails closed for disabled research and invalid monthly caps before accessing the database',async()=>{
    for(const enabled of [undefined,'0','true']){
      vi.stubEnv('PLACES_WEB_SEARCH_ENABLED',enabled);
      await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_DISABLED');
    }
    vi.stubEnv('PLACES_WEB_SEARCH_ENABLED','1');
    for(const cap of ['0','1001','1.5','invalid','']){
      vi.stubEnv('PLACES_WEB_SEARCH_MONTHLY_CAP',cap);
      await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_BUDGET_INVALID');
    }
    expect(harness.transaction).not.toHaveBeenCalled();
  });
  it('enforces the default and configured UTC monthly allowance',async()=>{
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
    for(const [configured,cap] of [[undefined,100],['1',1],['1000',1000]] as const){
      vi.stubEnv('PLACES_WEB_SEARCH_MONTHLY_CAP',configured);
      tx.auditEvent.count.mockReset().mockResolvedValueOnce(cap-1).mockResolvedValueOnce(0);
      await expect(reserveWebSearchRequest('owner','post')).resolves.toBeUndefined();
      expect(tx.auditEvent.count.mock.calls[0][0]).toMatchObject({where:{
        ownerId:'owner',action:'places.web_search.reserve',tableName:'place_analysis_jobs',
        operation:'UPDATE',occurredAt:{gte:new Date('2026-11-01T00:00:00Z')},
      }});
      tx.auditEvent.count.mockReset().mockResolvedValueOnce(cap);
      await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_BUDGET_EXHAUSTED');
    }
  });
  it('caps a job at two reservations across all months',async()=>{
    tx.auditEvent.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_JOB_BUDGET_EXHAUSTED');
    expect(tx.auditEvent.count.mock.calls[1][0]).toEqual({where:{
      ownerId:'owner',action:'places.web_search.reserve',tableName:'place_analysis_jobs',
      operation:'UPDATE',recordKey:{path:['id'],equals:'job'},
    }});
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('requires an owner-scoped job and refuses a reservation lost to concurrent deletion',async()=>{
    tx.placeAnalysisJob.findFirst.mockResolvedValueOnce(null);
    await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_BUDGET_CONTEXT_REQUIRED');
    expect(tx.placeAnalysisJob.findFirst).toHaveBeenCalledWith({
      where:{ownerId:'owner',postId:'post'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true},
    });
    tx.$executeRaw.mockResolvedValueOnce(0);
    await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow('WEB_SEARCH_BUDGET_CONTEXT_REQUIRED');
  });
  it('sanitizes database failures instead of exposing connection or query details',async()=>{
    harness.transaction.mockRejectedValueOnce(Error('private connection detail'));
    await expect(reserveWebSearchRequest('owner','post')).rejects.toThrow(/^WEB_SEARCH_BUDGET_UNAVAILABLE$/);
  });
});

const url=process.env.TEST_DATABASE_URL?.trim();
(url?describe:describe.skip)('web research durable PostgreSQL reservations',()=>{
  let db:PrismaClient;
  let owner:string;
  beforeAll(()=>{db=new PrismaClient({datasources:{db:{url}}});});
  beforeEach(()=>{
    owner=`web-budget-${randomUUID()}`;
    harness.transaction.mockImplementation((fn:(tx:Prisma.TransactionClient)=>Promise<void>)=>db.$transaction(fn));
  });
  afterEach(async()=>{await db.post.deleteMany({where:{ownerId:owner}});});
  afterAll(async()=>{await db.$disconnect();});
  async function seed(){
    const post=await db.post.create({data:{
      ownerId:owner,postUrl:`https://instagram.com/p/${randomUUID()}`,
      thumbnailUrl:'https://example.test/image.jpg',authorUsername:'example',
      authorSortKey:'example',caption:'Example Cafe',searchText:'example cafe',
      contentType:'IMAGE',mainTheme:'Restaurant',
    }});
    const job=await db.placeAnalysisJob.create({data:{
      ownerId:owner,postId:post.id,inputHash:randomUUID(),analysisVersion:'budget-test',
      sourceTheme:'Restaurant',status:'PROCESSING',depth:'DEEP',
      result:{automation:{origin:'sync'},googleUsage:{month:'2026-10',requests:1}},
    }});
    return {post,job};
  }
  const reservations=()=>db.auditEvent.findMany({where:{ownerId:owner,action:'places.web_search.reserve'}});
  it('serializes two calls per job and cannot refund them through retries, JSON rewrites or a new month',async()=>{
    const {post,job}=await seed();
    const outcomes=await Promise.allSettled(Array.from({length:4},()=>reserveWebSearchRequest(owner,post.id)));
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(2);
    expect(outcomes.filter(result=>result.status==='rejected').map(result=>result.reason.message))
      .toEqual(['WEB_SEARCH_JOB_BUDGET_EXHAUSTED','WEB_SEARCH_JOB_BUDGET_EXHAUSTED']);
    expect(await reservations()).toHaveLength(2);
    expect((await db.placeAnalysisJob.findUniqueOrThrow({where:{id:job.id}})).result).toMatchObject({
      automation:{origin:'sync'},googleUsage:{month:'2026-10',requests:1},webSearchUsage:{requests:2},
    });
    await db.placeAnalysisJob.update({where:{id:job.id},data:{attemptCount:1,result:{completion:{requestHash:'receipt'}}}});
    const nextMonth=new Date();nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1,1);
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(nextMonth);
    await expect(reserveWebSearchRequest(owner,post.id)).rejects.toThrow('WEB_SEARCH_JOB_BUDGET_EXHAUSTED');
    expect(await reservations()).toHaveLength(2);
  });
  it('serializes the monthly owner cap across jobs and retains spending after job deletion',async()=>{
    vi.stubEnv('PLACES_WEB_SEARCH_MONTHLY_CAP','1');
    const first=await seed(),second=await seed();
    const outcomes=await Promise.allSettled([first,second].map(({post})=>reserveWebSearchRequest(owner,post.id)));
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result=>result.status==='rejected').map(result=>result.reason.message))
      .toEqual(['WEB_SEARCH_BUDGET_EXHAUSTED']);
    await db.post.deleteMany({where:{ownerId:owner}});
    const replacement=await seed();
    await expect(reserveWebSearchRequest(owner,replacement.post.id)).rejects.toThrow('WEB_SEARCH_BUDGET_EXHAUSTED');
    expect(await reservations()).toHaveLength(1);
  });
});
