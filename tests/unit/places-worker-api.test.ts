// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { requireExternalApiKey } from '@/auth/api-key';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(()=>vi.unstubAllEnvs());
it('keeps Places writes separate from read and Instagram sync credentials and fails closed',()=>{
  vi.stubEnv('PLACES_WORKER_ENABLED','1');vi.stubEnv('PLACES_WORKER_API_KEY_SHA256',hash('worker'));
  vi.stubEnv('EXTERNAL_API_KEY_SHA256',hash('reader'));vi.stubEnv('INSTAGRAM_AUTO_SYNC_KEY_SHA256',hash('sync'));
  const request=(token:string)=>new Request('http://localhost/api/v1/places/worker',{headers:{Authorization:'Bearer '+token}});
  expect(()=>requireExternalApiKey(request('worker'),'places-worker')).not.toThrow();
  for(const token of ['reader','sync','wrong'])expect(()=>requireExternalApiKey(request(token),'places-worker')).toThrow();
  expect(()=>requireExternalApiKey(request('worker'))).toThrow();
  vi.stubEnv('PLACES_WORKER_ENABLED','0');expect(()=>requireExternalApiKey(request('worker'),'places-worker')).toThrow();
  vi.stubEnv('PLACES_WORKER_ENABLED','1');vi.stubEnv('PLACES_WORKER_API_KEY_SHA256',hash('reader'));
  expect(()=>requireExternalApiKey(request('reader'),'places-worker')).toThrow();
});

it('guards the real V1 route before handling malformed or oversized worker commands',async()=>{
  vi.stubEnv('PLACES_WORKER_ENABLED','1');vi.stubEnv('PLACES_WORKER_API_KEY_SHA256',hash('worker'));
  vi.stubEnv('EXTERNAL_API_KEY_SHA256',hash('reader'));vi.stubEnv('INSTAGRAM_AUTO_SYNC_KEY_SHA256',hash('sync'));vi.stubEnv('APP_OWNER_ID','route-owner');
  const {POST}=await import('@/app/api/v1/places/worker/route');
  const request=(token:string,body:string)=>new Request('http://localhost/api/v1/places/worker',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});
  expect((await POST(request('reader','{}'))).status).toBe(401);
  const invalid=await POST(request('worker',JSON.stringify({action:'claim',ownerId:'other'})));
  expect(invalid.status).toBe(400);expect(invalid.headers.get('cache-control')).toBe('private, no-store');
  expect((await POST(request('worker',' '.repeat(512*1024+1)))).status).toBe(413);
  vi.stubEnv('PLACES_WORKER_ENABLED','0');expect((await POST(request('worker','{}'))).status).toBe(503);
});
