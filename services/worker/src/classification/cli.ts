import {parseClassificationConfig} from './config.js';
import {ClassificationHttpApi} from './api.js';
import {createClassificationAnalyzer} from './analyze.js';
import {runClassificationOnce} from './runner.js';
import {prepareClassificationWorkdirs} from './workdirs.js';
import {runClassificationLoop} from './loop.js';
async function main(){
 const config=parseClassificationConfig(process.env);const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 const log=(event:Record<string,unknown>)=>process.stdout.write(JSON.stringify(event)+'\n');const workdirs=await prepareClassificationWorkdirs(config.tempRoot);
 const deps={api:new ClassificationHttpApi(config.origin,config.apiKey),workdirs,analyze:createClassificationAnalyzer(config,log),log};
 await runClassificationLoop({runOnce:signal=>runClassificationOnce(deps,signal),cleanup:()=>workdirs.cleanupStale(),log},stop.signal);
}
main().catch(()=>{process.stderr.write('CLASSIFICATION_WORKER_FAILED\n');process.exitCode=1;});
