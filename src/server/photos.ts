import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {transaction} from './db';
import {HttpError} from './auth';
import {z} from 'zod';
import {requireMembership} from './service';

export async function readImageBody(request:Request) {
  const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'';
  // Some file pickers report JPG aliases or no MIME type. Decoded bytes remain authoritative.
  if(!['image/jpeg','image/jpg','image/pjpeg','image/png','image/webp','image/heic','image/heif','application/octet-stream',''].includes(type))throw new HttpError('Choose a JPEG, PNG, WebP or HEIC photo.',400);
  const reader=request.body?.getReader();if(!reader)throw new HttpError('Choose a photo.',400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new HttpError('Choose a photo smaller than 10 MB.',413);}chunks.push(value);}
  return Buffer.concat(chunks);
}
export async function uploadPhoto(userId:string,groupId:string,input:Buffer){
  z.uuid().parse(groupId);
  await transaction(tx=>requireMembership(tx,userId,groupId));
  let data:Buffer,width:number,height:number;
  try {
    // Full-resolution 48 MP phone photos exceed 40 MP even when the JPG is under 10 MB.
    const image=sharp(input,{limitInputPixels:64_000_000,failOn:'error'});
    const metadata=await image.metadata();
    if(!metadata.format||!['jpeg','png','webp','heif'].includes(metadata.format))throw new Error('Unsupported photo format');
    const output=await image.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
    data=output.data;width=output.info.width;height=output.info.height;
  }catch(error){
    const pixelLimit=error instanceof Error&&error.message.includes('Input image exceeds pixel limit');
    console.warn('Photo decoding rejected',{reason:pixelLimit?'pixel-limit':'invalid-image',bytes:input.length});
    throw new HttpError(pixelLimit?'This photo is over 64 megapixels. Export a smaller copy and try again.':'This photo could not be read. Try exporting it as a new JPEG or PNG.',400);
  }
  const sha=createHash('sha256').update(data).digest('hex');
  return transaction(async tx=>{
    await requireMembership(tx,userId,groupId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`uploads:${userId}`]);
    const count=await tx.query("SELECT count(*)::int n FROM everrate.photos WHERE owner_id=$1 AND created_at>now()-interval '1 day'",[userId]);
    if(count.rows[0].n>=100)throw new HttpError('Daily photo limit reached. Try again tomorrow to add another photo.',429);
    const result=await tx.query('INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[groupId,userId,data,sha,'image/jpeg',width,height]);
    return {id:result.rows[0].id,mimeType:'image/jpeg',width,height};
  });
}
export async function getPhoto(userId:string,photoId:string){
  z.uuid().parse(photoId);
  return transaction(async tx=>{
    const found=await tx.query('SELECT group_id FROM everrate.photos WHERE id=$1',[photoId]);
    if(!found.rowCount)throw new HttpError('Photo not found.',404);
    await requireMembership(tx,userId,found.rows[0].group_id);
    const r=await tx.query('SELECT * FROM everrate.photos WHERE id=$1',[photoId]);
    if(!r.rowCount)throw new HttpError('Photo not found.',404);
    return r.rows[0] as {id:string;group_id:string;owner_id:string;data:Buffer;mime_type:string;sha256:string};
  });
}
