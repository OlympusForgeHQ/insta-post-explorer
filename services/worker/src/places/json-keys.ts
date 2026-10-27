// Scan before JSON.parse can silently discard repeated keys. Syntax remains the
// responsibility of JSON.parse; strings are consumed whole, including escapes.
export function rejectDuplicateJsonKeys(text:string):void{
 const containers:Array<Set<string>|null>=[];
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==='"'){
   const start=index++;
   for(;index<text.length;index++){
    if(text[index]==='\\'){index++;continue;}
    if(text[index]==='"')break;
   }
   let next=index+1;
   while(next<text.length&&/\s/u.test(text[next]))next++;
   if(text[next]===':'){
    const keys=containers.at(-1);
    if(!keys)throw Error('INVALID_RESULT');
    const key:string=JSON.parse(text.slice(start,index+1));
    if(keys.has(key))throw Error('INVALID_RESULT');
    keys.add(key);
   }
  }else if(char==='{'||char==='['){
   if(containers.length>=128)throw Error('INVALID_RESULT');
   containers.push(char==='{'?new Set():null);
  }else if(char==='}'||char===']')containers.pop();
 }
}
