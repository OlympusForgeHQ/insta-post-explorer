// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
const services=vi.hoisted(()=>({claimCaptionTranslation:vi.fn(),completeCaptionTranslation:vi.fn(),failCaptionTranslation:vi.fn()}));
vi.mock('@/server/classification/translation-jobs',()=>services);
vi.mock('@/server/classification/jobs',()=>({heartbeatClassification:vi.fn()}));
import {POST} from '@/app/api/v1/classification/translation/route';
const key='translation-api-private-key';
const send=(body:unknown,token=key)=>POST(new Request('https://example.test/api/v1/classification/translation',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));
describe('Translation endpoint capability and limits',()=>{
 beforeEach(()=>{vi.stubEnv('CLASSIFICATION_WORKER_ENABLED','1');vi.stubEnv('CLASSIFICATION_WORKER_API_KEY_SHA256',createHash('sha256').update(key).digest('hex'));vi.stubEnv('APP_OWNER_ID','translation-owner');services.claimCaptionTranslation.mockResolvedValue(null);});
 afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
 it('fails closed, gates admission and derives ownership exclusively from configuration',async()=>{
  expect((await send({action:'claim'},'wrong')).status).toBe(401);
  expect((await send({action:'claim'})).status).toBe(200);expect(services.claimCaptionTranslation).not.toHaveBeenCalled();
  vi.stubEnv('CAPTION_TRANSLATION_ENABLED','1');expect((await send({action:'claim'})).status).toBe(200);expect(services.claimCaptionTranslation).toHaveBeenCalledWith('translation-owner');
  expect((await send({action:'claim',ownerId:'other'})).status).toBe(400);expect((await send(' '.repeat(1024*1024+1))).status).toBe(413);
 });
});
