// @vitest-environment node
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
const services=vi.hoisted(()=>({claimClassification:vi.fn(),heartbeatClassification:vi.fn(),completeClassification:vi.fn(),failClassification:vi.fn()}));
vi.mock('@/server/classification/jobs',()=>services);
import {requireExternalApiKey} from '@/auth/api-key';
import {POST} from '@/app/api/v1/classification/worker/route';
const key='classification-test-token-123456789';const hash=createHash('sha256').update(key).digest('hex');
const request=new Request('https://example.test',{headers:{Authorization:'Bearer '+key}});
describe('Classification worker authentication',()=>{
 beforeEach(()=>{vi.unstubAllEnvs();vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','1');vi.stubEnv('CLASSIFICATION_WORKER_API_KEY_SHA256',hash);});
 afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
 it('accepts only its dedicated capability',()=>expect(()=>requireExternalApiKey(request,'classification-worker')).not.toThrow());
 it.each(['EXTERNAL_API_KEY_SHA256','PLACES_WORKER_API_KEY_SHA256','INSTAGRAM_AUTO_SYNC_KEY_SHA256'])('refuses shared %s credentials',name=>{vi.stubEnv(name,hash);expect(()=>requireExternalApiKey(request,'classification-worker')).toThrow('EXTERNAL_API_UNAVAILABLE');});
 it('fails closed when disabled or the supplied key is incorrect',()=>{vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','0');expect(()=>requireExternalApiKey(request,'classification-worker')).toThrow('EXTERNAL_API_UNAVAILABLE');vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','1');expect(()=>requireExternalApiKey(new Request('https://example.test'),'classification-worker')).toThrow('EXTERNAL_API_UNAUTHORIZED');});
 it('bounds and validates commands, derives ownership, and fences stale responses without exposing internals',async()=>{
  vi.stubEnv('APP_OWNER_ID','classification-owner');services.claimClassification.mockResolvedValue(null);
  const send=(body:string,headers:Record<string,string>={})=>POST(new Request('https://example.test/api/v1/classification/worker',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...headers},body}));
  const accepted=await send(JSON.stringify({action:'claim'}));expect(accepted.status).toBe(200);expect(accepted.headers.get('Cache-Control')).toContain('no-store');expect(services.claimClassification).toHaveBeenCalledWith('classification-owner');
  for(const body of ['{',JSON.stringify({action:'claim',ownerId:'other'}),JSON.stringify({action:'enqueue',postId:'old'})])expect((await send(body)).status).toBe(400);
  expect((await send(' '.repeat(128*1024+1))).status).toBe(413);
  services.heartbeatClassification.mockRejectedValue(Error('CLASSIFICATION_LEASE_LOST'));
  const conflict=await send(JSON.stringify({action:'heartbeat',jobId:'job',leaseToken:'c31dc4f4-2e82-4926-88f2-1b0875d28a5b'}));expect(conflict.status).toBe(409);expect((await conflict.json()).error.code).toBe('CLASSIFICATION_LEASE_LOST');
 });
});
