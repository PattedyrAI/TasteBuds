import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {query,transaction} from './db';
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
  const member=await query('SELECT 1 FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[groupId,userId]);
  if(!member.rowCount)throw new HttpError('Group not found.',404);
  let data:Buffer,width:number,height:number;
  try {
    const image=sharp(input,{limitInputPixels:40_000_000,failOn:'error'});
    const metadata=await image.metadata();
    if(!metadata.format||!['jpeg','png','webp','heif'].includes(metadata.format))throw new Error('Unsupported photo format');
    const output=await image.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
    data=output.data;width=output.info.width;height=output.info.height;
  }catch{throw new HttpError('This photo could not be read. Try a JPEG or PNG.',400);}
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
  const r=await query('SELECT p.* FROM everrate.photos p JOIN everrate.memberships m ON m.group_id=p.group_id AND m.user_id=$2 WHERE p.id=$1',[photoId,userId]);
  if(!r.rowCount)throw new HttpError('Photo not found.',404);
  return r.rows[0] as {id:string;group_id:string;owner_id:string;data:Buffer;mime_type:string;sha256:string};
}
