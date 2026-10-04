import 'server-only';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { PLACES_WORKER_MAX_BYTES } from '@/lib/places/worker-contract';

export type WorkerMedia={id:string;kind:'IMAGE'|'VIDEO';mimeType:string;byteSize:number;versionTag:string|null;url:string};
export type MediaSigner=(objectKey:string,versionTag:string|null)=>Promise<string>;
export async function signPlacesMedia(objectKey:string,versionTag:string|null):Promise<string>{
  const endpoint=process.env.R2_ENDPOINT,bucket=process.env.R2_BUCKET_NAME;
  if(!endpoint||!bucket||!process.env.R2_ACCESS_KEY_ID||!process.env.R2_SECRET_ACCESS_KEY)throw Error('PLACES_MEDIA_UNAVAILABLE');
  const parsed=new URL(endpoint);
  if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.r2.cloudflarestorage.com'))throw Error('PLACES_MEDIA_UNAVAILABLE');
  const s3=new S3Client({region:'auto',endpoint,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
  try{return await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:objectKey,...(versionTag?{IfMatch:versionTag}:{})}),{expiresIn:1800});}
  finally{s3.destroy();}
}
export async function loadWorkerMedia(ownerId:string,postId:string,sign:MediaSigner=signPlacesMedia,client:Prisma.TransactionClient=prisma):Promise<WorkerMedia[]>{
  const rows=await client.postMedia.findMany({where:{ownerId,postId},orderBy:{position:'asc'}});
  if(rows.length<1||rows.length>20)throw Error('PLACES_MEDIA_UNAVAILABLE');
  const prefix=(process.env.MEDIA_PATH_PREFIX||'originals').replace(/^\/+|\/+$/g,'')+'/';
  return Promise.all(rows.map(async row=>{
    if(row.identityState!=='VERIFIED'||!row.objectKey||!row.objectKey.startsWith(prefix)||row.objectKey.includes('\\')||row.objectKey.split('/').includes('..')||
      !row.mimeType||!['image/jpeg','image/png','image/webp','video/mp4'].includes(row.mimeType)||!row.byteSize||row.byteSize>PLACES_WORKER_MAX_BYTES||
      (row.type==='VIDEO')!==(row.mimeType==='video/mp4'))throw Error('PLACES_MEDIA_UNAVAILABLE');
    return {id:row.id,kind:row.type,mimeType:row.mimeType,byteSize:row.byteSize,versionTag:row.versionTag,url:await sign(row.objectKey,row.versionTag)};
  }));
}
