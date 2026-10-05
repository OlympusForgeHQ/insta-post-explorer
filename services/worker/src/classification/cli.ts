import {setTimeout as delay} from 'node:timers/promises';
import {parseClassificationConfig} from './config.js';
import {ClassificationHttpApi} from './api.js';
import {createClassificationAnalyzer} from './analyze.js';
import {runClassificationOnce} from './runner.js';
import {prepareClassificationWorkdirs} from './workdirs.js';
async function main(){
 const config=parseClassificationConfig(process.env);const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 const log=(event:Record<string,unknown>)=>process.stdout.write(JSON.stringify(event)+'\n');const workdirs=await prepareClassificationWorkdirs(config.tempRoot);
 const deps={api:new ClassificationHttpApi(config.origin,config.apiKey),workdirs,analyze:createClassificationAnalyzer(config,log),log};
 while(!stop.signal.aborted){let wait=15_000;try{await runClassificationOnce(deps,stop.signal);await workdirs.cleanupStale();}catch{if(!stop.signal.aborted){log({stage:'classification_poll_failed'});wait=60_000;}}
  if(!stop.signal.aborted)await delay(wait,undefined,{signal:stop.signal}).catch(()=>undefined);
 }
}
main().catch(()=>{process.stderr.write('CLASSIFICATION_WORKER_FAILED\n');process.exitCode=1;});
