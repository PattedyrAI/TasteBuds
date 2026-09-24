import type {Db} from '../db';
import {ServiceError} from './common';
// All callers select ratings as r; legacy single-photo rows need no backfill.
export const ratingPhotoColumns=`array_remove(ARRAY[r.photo_id],NULL) || ARRAY(SELECT p.photo_id FROM everrate.rating_photos p WHERE p.rating_id=r.id ORDER BY p.position) AS photo_ids`;
export async function requireRatingPhotos(db:Db,userId:string,groupId:string,photoIds:string[],reusable:string[]=[]){
  const fresh=photoIds.filter(id=>!reusable.includes(id));
  if(!fresh.length)return;
  const found=await db.query('SELECT id FROM everrate.photos WHERE id=ANY($1::uuid[]) AND group_id=$2 AND owner_id=$3',[fresh,groupId,userId]);
  if(found.rowCount!==fresh.length)throw new ServiceError(404,'Photo not found');
}
export async function replaceExtraPhotos(db:Db,groupId:string,ratingId:string,photoIds:string[]){
  await db.query('DELETE FROM everrate.rating_photos WHERE rating_id=$1',[ratingId]);
  if(photoIds.length>1)await db.query(`INSERT INTO everrate.rating_photos(group_id,rating_id,photo_id,position)
    SELECT $1,$2,photo_id,position FROM unnest($3::uuid[]) WITH ORDINALITY AS photos(photo_id,position)`,[groupId,ratingId,photoIds.slice(1)]);
}
