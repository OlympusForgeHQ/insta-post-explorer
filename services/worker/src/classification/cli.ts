import {parseClassificationConfig} from './config.js';
import {ClassificationHttpApi} from './api.js';
import {createClassificationAnalyzer} from './analyze.js';
import {runClassificationOnce} from './runner.js';
import {prepareClassificationWorkdirs} from './workdirs.js';
import {runCaptionTranslationOnce} from './translation-runner.js';
import {translateCaption} from './translation-inference.js';
import {runClassificationLoop} from './loop.js';
async function main(){
 const config=parseClassificationConfig(process.env);const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 const log=(event:Record<string,unknown>)=>process.stdout.write(JSON.stringify(event)+'\n');const workdirs=await prepareClassificationWorkdirs(config.tempRoot);
 const deps={api:new ClassificationHttpApi(config.origin,config.apiKey),workdirs,analyze:createClassificationAnalyzer(config,log),log};
 const translation={api:new ClassificationHttpApi(config.origin,config.apiKey,fetch,'/api/v1/classification/translation'),log,analyze:async(caption:string,signal:AbortSignal)=>{const started=Date.now();const result=await translateCaption(caption,config.hermesUrl,config.hermesKey,signal,fetch,log);return {...result,model:'deepseek/deepseek-v4.1-flash' as const,elapsedMs:Date.now()-started};}};
 await runClassificationLoop({runOnce:signal=>runClassificationOnce(deps,signal),translateOnce:signal=>runCaptionTranslationOnce(translation,signal),cleanup:()=>workdirs.cleanupStale(),log},stop.signal);
}
main().catch(()=>{process.stderr.write('CLASSIFICATION_WORKER_FAILED\n');process.exitCode=1;});
