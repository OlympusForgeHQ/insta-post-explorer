// @vitest-environment node
import {it,expect,vi,beforeEach} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),review:vi.fn(),revoke:vi.fn()}));
vi.mock('@/auth/session',()=>({requireSession:mocks.session}));
vi.mock('@/auth/http',()=>({authErrorResponse:()=>new Response(null,{status:401})}));
vi.mock('@/server/classification/learning',()=>({getLearningReview:mocks.get,reviewWorkerLearning:mocks.review,revokeWorkerLearning:mocks.revoke}));
import {GET,POST,DELETE} from '@/app/api/posts/[id]/learning/route';
const context={params:Promise.resolve({id:'post'})};
const request=(body:unknown)=>new Request('https://example.test/api/posts/post/learning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({ownerId:'authenticated-owner'});mocks.get.mockResolvedValue({classificationSourceHash:'hash'});});
it('requires authentication and derives owner exclusively from the session',async()=>{
 mocks.session.mockRejectedValueOnce(Error('UNAUTHORIZED'));expect((await POST(request({}),context)).status).toBe(401);expect(mocks.review).not.toHaveBeenCalled();
 const response=await GET(request({}),context);expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');expect(mocks.get).toHaveBeenCalledWith('authenticated-owner','post');
 expect((await DELETE(request({domain:'classification',ownerId:'foreign'}),context)).status).toBe(400);expect(mocks.revoke).not.toHaveBeenCalled();
});
it('reports source conflicts without exposing internal failures',async()=>{mocks.review.mockRejectedValue(Error('LEARNING_SOURCE_STALE'));expect((await POST(request({}),context)).status).toBe(409);mocks.review.mockRejectedValue(Error('NOT_FOUND'));expect((await POST(request({}),context)).status).toBe(404);});
