import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {preflightAsr,runProcess} from './media.js';
import {createTempWorkdirManager} from '../runtime/temp-workdir.js';
import {PlacesHttpApi} from './api.js';
import {createPlacesAnalyzer} from './analyze.js';
import {parsePlacesConfig} from './config.js';
import {runPlacesPipeline} from './pipeline.js';
import {runPlacesLoop} from './loop.js';

async function main(){
 const config=parsePlacesConfig(process.env),stop=new AbortController();
 process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 const log=(event:Record<string,unknown>)=>process.stdout.write(JSON.stringify(event)+'\n');
 const workdirs=createTempWorkdirManager({root:config.tempRoot,maxAgeMs:21_600_000});

 const deps={api:new PlacesHttpApi(config.origin,config.apiKey),workdirs,analyze:createPlacesAnalyzer(config,log),log};
 const learning=process.env.PLACES_LEARNING_ENABLED!=='0';
 log({stage:'places_consumer_started',scope:'automatic',learning});
 const checkRuntime=async(signal:AbortSignal)=>{
  try{await Promise.all(['/usr/bin/ffmpeg','/usr/bin/ffprobe'].map(file=>runProcess(file,['-version'],signal,5000)));}catch{throw Error('MEDIA_TOOLS_UNAVAILABLE');}
  let probe:string|undefined;try{await workdirs.cleanupStale();probe=await workdirs.create('preflight');await writeFile(path.join(probe,'probe'),'ready',{mode:0o600});await workdirs.remove(probe);probe=undefined;}catch{throw Error('TEMP_STORAGE_UNAVAILABLE');}finally{if(probe)await workdirs.remove(probe).catch(()=>undefined);}
  await preflightAsr(config,signal);
 };
 await runPlacesLoop({checkRuntime,runOnce:signal=>runPlacesPipeline({limit:1,commit:true,scope:'automatic',learning,signal},deps),cleanup:()=>workdirs.cleanupStale(),log},stop.signal);
 log({stage:'places_consumer_stopped'});
}
main().catch(()=>{process.stderr.write('PLACES_CONSUMER_FAILED\n');process.exitCode=1;});
