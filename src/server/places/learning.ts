import 'server-only';
import type {Prisma} from '@prisma/client';
import {PLACES_WORKER_VERSION} from '@/lib/places/worker-contract';
import {placesInputShape,selectPlacesLearning,appendPlacesOutcome,type PlacesLearningContext,type PlacesLearningOutcome} from '../../../services/worker/src/places/learning';

export function placesJobMetadata(result:Prisma.JsonValue|null):Prisma.JsonObject{
 return result&&typeof result==='object'&&!Array.isArray(result)?result:{};
}
export async function loadPlacesLearning(tx:Prisma.TransactionClient,ownerId:string,job:{id:string;postId:string;result:Prisma.JsonValue|null},caption:string,media:ReadonlyArray<{kind:string}>){
 const shape=placesInputShape(caption,media);
 const rows=await tx.placeAnalysisJob.findMany({where:{ownerId,status:{in:['PENDING','PROCESSING','FAILED','SUCCEEDED','NEEDS_REVIEW']},postId:{not:job.postId},id:{not:job.id},analysisVersion:PLACES_WORKER_VERSION,updatedAt:{gte:new Date(Date.now()-30*86400_000)},result:{path:['learning','shape'],equals:shape}},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:100,select:{postId:true,result:true}});
 const seen=new Set<string>();
 const samples=rows.filter(row=>{if(seen.has(row.postId))return false;seen.add(row.postId);return true;});
 return {shape,context:selectPlacesLearning(shape,placesJobMetadata(job.result).learning,samples.map(row=>placesJobMetadata(row.result).learning))};
}
export function recordPlacesOutcome(result:Prisma.JsonValue|null,outcome:Omit<PlacesLearningOutcome,'strategy'|'code'>&{code?:string}):Prisma.JsonObject{
 const metadata=placesJobMetadata(result);
 const claim=metadata.learningClaim as {shape?:string;context?:PlacesLearningContext}|undefined;
 if(!claim?.shape||!claim.context)return metadata;
 return {...metadata,learning:appendPlacesOutcome(metadata.learning,{...outcome,shape:claim.shape,strategy:claim.context.strategy})};
}
