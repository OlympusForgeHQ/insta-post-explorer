import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireSession} from '@/auth/session';
import {authErrorResponse} from '@/auth/http';
import {readBoundedJsonBody,errorResponse} from '@/server/http';
import {getLearningReview,reviewWorkerLearning,revokeWorkerLearning} from '@/server/classification/learning';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
async function handle(request:Request,context:Context,method:'GET'|'POST'|'DELETE'){
 let owner:string;try{owner=(await requireSession()).ownerId;}catch(error){return authErrorResponse(error);}
 try{
  const id=z.string().min(1).max(256).parse((await context.params).id);
  if(method==='POST')await reviewWorkerLearning(owner,id,await readBoundedJsonBody(request,1024*1024));
  if(method==='DELETE'){const {domain}=z.object({domain:z.enum(['classification','translation'])}).strict().parse(await readBoundedJsonBody(request,4096));await revokeWorkerLearning(owner,id,domain);}
  return NextResponse.json(await getLearningReview(owner,id),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const code=error instanceof Error?error.message:'';if(['NOT_FOUND','LEARNING_SOURCE_STALE'].includes(code))return NextResponse.json({error:code},{status:code==='NOT_FOUND'?404:409});if(code.startsWith('TRANSLATION_'))return NextResponse.json({error:'INVALID_TRANSLATION'},{status:400});return errorResponse(error);}
}
export const GET=(r:Request,c:Context)=>handle(r,c,'GET');
export const POST=(r:Request,c:Context)=>handle(r,c,'POST');
export const DELETE=(r:Request,c:Context)=>handle(r,c,'DELETE');
