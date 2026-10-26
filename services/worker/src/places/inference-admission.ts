// Hermes commits at most ten images in one API admission. Keep media extraction
// independent of this transport limit so later frames are never discarded.
export const HERMES_MAX_IMAGES=10;
export function frameBatches<T>(frames:readonly T[]):T[][]{
 const batches:T[][]=[];
 for(let index=0;index<frames.length;index+=HERMES_MAX_IMAGES)batches.push(frames.slice(index,index+HERMES_MAX_IMAGES));
 return batches;
}

type Diagnostic=(event:Record<string,unknown>)=>void;
const providerCodes=new Set(['invalid_params','invalid_request_error','context_length_exceeded','rate_limit_exceeded','rate_limit_error','server_error','model_not_found','authentication_error','insufficient_quota']);

export async function reportInferenceHttpFailure(response:Response,imageCount:number,log?:Diagnostic):Promise<void>{
 let providerCode='unknown';
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  reader=response.body?.getReader();
  if(log&&reader){
   // Error bodies are untrusted and can contain input or credentials. Read only
   // a small bounded envelope and emit a known code, never arbitrary text.
   const readCode=(async()=>{
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const part=await reader!.read();if(part.done)break;size+=part.value.byteLength;if(size>4096)return;chunks.push(part.value);}
    const raw:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const code=raw&&typeof raw==='object'&&'error' in raw&&raw.error&&typeof raw.error==='object'&&'code' in raw.error?raw.error.code:undefined;
    if(typeof code==='string'&&providerCodes.has(code))providerCode=code;
   })();
   await Promise.race([readCode,new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);
  }
 }catch{ /* Diagnostic parsing must not change the original failure. */ }
 finally{
  if(timer)clearTimeout(timer);
  if(reader)void reader.cancel().catch(()=>undefined);
 }
 try{log?.({stage:'inference_http_error',httpStatus:response.status,providerCode,imageCount});}catch{ /* Preserve the failure contract if a logger is unavailable. */ }
}
