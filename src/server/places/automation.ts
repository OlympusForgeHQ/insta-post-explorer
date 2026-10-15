import 'server-only';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {canonicalPlacesTheme} from '@/lib/places/eligibility';
import {PLACES_WORKER_VERSION} from '@/lib/places/worker-contract';
import {loadAnalysisPostInputs} from './repository';
import {computePlacesInputHash} from './hash';
import {hasOwnerNoPlaceConfirmation} from './post-exclusion';

const admissionSchema=z.object({version:z.literal(1),syncJobId:z.string().min(1).max(200),state:z.literal('awaiting_classification')});
export const automaticPlacesEnabled=()=>process.env.PLACES_AUTO_ENABLED==='1';

// Only the new-import path may create this marker. Import replays retain the
// original marker, so enabling automation never opts historical posts in.
export function newSyncPlacesAdmission(syncJobId:string){
 return automaticPlacesEnabled()?{placesAutomation:{version:1,syncJobId,state:'awaiting_classification'}}:{};
}

// The caller owns the post lock and transaction (sync import or classification
// completion). Classification writes its final theme/tags before this admission.
export async function enqueueAutomaticPlaces(tx:Prisma.TransactionClient,ownerId:string,postId:string){
 const row=await tx.post.findFirst({where:{id:postId,ownerId},select:{metadata:true}});
 const metadata=row?.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)?row.metadata:{};
 const admission=admissionSchema.safeParse(metadata.placesAutomation);
 if(!admission.success)return;
 const post=await loadAnalysisPostInputs(ownerId,postId,tx);
 if(!post)return;
 const sourceTheme=canonicalPlacesTheme(post.mainTheme);
 const excluded=await hasOwnerNoPlaceConfirmation(ownerId,postId,tx);
 let jobId:string|undefined;
 if(sourceTheme&&!excluded){
  const inputHash=computePlacesInputHash({...post,postId,sourceTheme,analysisVersion:PLACES_WORKER_VERSION});
  const identity={ownerId,postId,inputHash,analysisVersion:PLACES_WORKER_VERSION};
  await tx.placeAnalysisJob.createMany({data:[{...identity,sourceTheme,depth:'DEEP',maxAttempts:3}],skipDuplicates:true});
  const job=await tx.placeAnalysisJob.findUniqueOrThrow({where:{ownerId_postId_inputHash_analysisVersion:identity}});
  jobId=job.id;
  if(job.status==='PENDING'){
   const prior=job.result&&typeof job.result==='object'&&!Array.isArray(job.result)?job.result:{};
   await tx.placeAnalysisJob.update({where:{id:job.id},data:{result:{...prior,automation:{version:1,source:'sync',syncJobId:admission.data.syncJobId}}}});
  }
 }
 await tx.post.update({where:{id:postId},data:{metadata:{...metadata,placesAutomation:{...admission.data,state:excluded?'excluded':sourceTheme?'queued':'ineligible',...(jobId?{jobId}:{})}}}});
}
