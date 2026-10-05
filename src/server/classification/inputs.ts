import 'server-only';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/server/db';
import {loadWorkerMedia,type MediaSigner} from '@/server/places/worker-media';
import {CLASSIFICATION_VERSION,classificationOutputSchema} from '@/lib/classification/contract';
import {SYNC_MAIN_THEMES} from '@/lib/sync/enrich-post';
import {z} from 'zod';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function classificationInputs(ownerId:string,postId:string,tx:Prisma.TransactionClient=prisma){
 const post=await tx.post.findFirst({where:{id:postId,ownerId},include:{postTags:{include:{tag:true},orderBy:{tagId:'asc'}},media:{orderBy:{position:'asc'}}}});
 if(!post)throw Error('POST_NOT_FOUND');
 // Only manual catalog changes invalidate queued classification. Automatic tag
 // creation must not invalidate every other post imported in the same sync.
 const catalogEdit=await tx.auditEvent.findFirst({where:{ownerId,action:{in:['admin.rename_tag','admin.merge_tags','admin.delete_tag']}},orderBy:{id:'desc'},select:{id:true}});
 const inputHash=digest({ownerId,id:post.id,caption:post.caption,author:post.authorUsername,theme:post.mainTheme,updatedAt:post.updatedAt,manualCatalogRevision:catalogEdit?.id.toString()??null,tags:post.postTags.map(t=>[t.tagId,t.isManual,t.tag.name,t.tag.slug]),media:post.media.map(m=>[m.id,m.type,m.position,m.objectKey,m.mimeType,m.byteSize,m.versionTag,m.identityState]),version:CLASSIFICATION_VERSION});
 return {post,inputHash};
}
export async function prepareClassification(ownerId:string,postId:string,signMedia:MediaSigner|undefined,tx:Prisma.TransactionClient=prisma){
 const {post,inputHash}=await classificationInputs(ownerId,postId,tx);
 const media=await loadWorkerMedia(ownerId,postId,signMedia,tx);
 const tags=await tx.tag.findMany({where:{ownerId},orderBy:[{postTags:{_count:'desc'}},{name:'asc'}],take:250,select:{name:true}});
 return {input:{post_id:post.id,input_hash:inputHash,caption:post.caption,author_username:post.authorUsername},media,existingTags:[...new Set([...post.postTags.map(t=>t.tag.name),...tags.map(t=>t.name)])].slice(0,300),themes:[...SYNC_MAIN_THEMES],outputSchema:z.toJSONSchema(classificationOutputSchema)};
}
