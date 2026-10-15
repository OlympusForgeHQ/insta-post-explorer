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
 await workdirs.cleanupStale();
 const deps={api:new PlacesHttpApi(config.origin,config.apiKey),workdirs,analyze:createPlacesAnalyzer(config,log),log};
 const learning=process.env.PLACES_LEARNING_ENABLED!=='0';
 log({stage:'places_consumer_started',scope:'automatic',learning});
 await runPlacesLoop({runOnce:signal=>runPlacesPipeline({limit:1,commit:true,scope:'automatic',learning,signal},deps),cleanup:()=>workdirs.cleanupStale(),log},stop.signal);
 log({stage:'places_consumer_stopped'});
}
main().catch(()=>{process.stderr.write('PLACES_CONSUMER_FAILED\n');process.exitCode=1;});
