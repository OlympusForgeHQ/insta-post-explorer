import path from 'node:path';
import { z } from 'zod';
const origin=z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)));});
const schema=z.object({origin,apiKey:z.string().min(20).max(256),hermesUrl:z.string().url().refine(value=>{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/v1'&&!u.username&&!u.password&&!u.search&&!u.hash;}),hermesKey:z.string().min(20).max(256),tempRoot:z.string().refine(v=>path.isAbsolute(v)&&v!=='/'),python:z.string().refine(path.isAbsolute),transcribeScript:z.string().refine(path.isAbsolute),modelCache:z.string().refine(path.isAbsolute)});
export function parsePlacesConfig(env:NodeJS.ProcessEnv){
 const parsed=schema.safeParse({origin:env.PLACES_APP_ORIGIN,apiKey:env.PLACES_WORKER_API_KEY,hermesUrl:env.PLACES_HERMES_URL||'http://127.0.0.1:8645/v1',hermesKey:env.PLACES_HERMES_KEY,tempRoot:env.PLACES_TEMP_ROOT,python:env.PLACES_ASR_PYTHON,transcribeScript:env.PLACES_ASR_SCRIPT,modelCache:env.PLACES_ASR_CACHE});
 if(!parsed.success)throw Error('PLACES_CONFIG_INVALID:'+parsed.error.issues.map(i=>i.path.join('.')).join(','));
 return parsed.data;
}
export type PlacesConfig=ReturnType<typeof parsePlacesConfig>;
