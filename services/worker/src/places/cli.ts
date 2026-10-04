import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createTempWorkdirManager } from '../runtime/temp-workdir.js';
import { PlacesHttpApi } from './api.js';
import { createPlacesAnalyzer } from './analyze.js';
import { parsePlacesConfig } from './config.js';
import { runPlacesPipeline } from './pipeline.js';

async function main(){
  const args=parseArgs({options:{post:{type:'string'},limit:{type:'string',default:'1'},commit:{type:'boolean',default:false},preview:{type:'boolean',default:false}}}).values;
  const limit=Number(args.limit);
  if(!Number.isInteger(limit)||limit<1||limit>50||(args.commit&&args.preview)||(!args.commit&&!args.post))throw Error('PLACES_OPTIONS_INVALID');
  const config=parsePlacesConfig(process.env),api=new PlacesHttpApi(config.origin,config.apiKey);
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  const workdirs=createTempWorkdirManager({root:config.tempRoot,maxAgeMs:21_600_000});await workdirs.cleanupStale();
  const log=(event:Record<string,unknown>)=>process.stdout.write(JSON.stringify(event)+'\n');
  if(args.commit){
    let cursor:string|null=null,queued=0;
    do{
      const page=z.object({queued:z.number().int(),nextCursor:z.string().nullable()}).parse(await api.call({action:'enqueue',...(args.post?{postId:args.post}:cursor?{cursor}:{})},abort.signal));
      queued+=page.queued;cursor=page.nextCursor;
    }while(cursor&&!args.post);
    log({stage:'enqueued',queued});
  }
  const result=await runPlacesPipeline({limit,commit:Boolean(args.commit),postId:args.post,signal:abort.signal},{api,workdirs,analyze:createPlacesAnalyzer(config,log),log});
  log({stage:'summary',succeeded:result.succeeded,failed:result.failed});if(result.failed)process.exitCode=1;
}
main().catch(()=>{process.stderr.write('PLACES_WORKER_FAILED\n');process.exitCode=1;});
