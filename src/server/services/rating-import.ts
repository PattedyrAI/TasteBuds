import {z} from 'zod';
import {idSchema} from '../../domain/validation';
import {transaction} from '../db';
import {audit,lookupLabel,parse,requireMembership,ServiceError,validId} from './common';
import {ratingPhotoColumns,replaceExtraPhotos} from './rating-photos';

const schema=z.object({sourceGroupId:idSchema,sourceCategoryId:idSchema,destinationCategoryId:idSchema}).strict();
/** Copies are private to the destination, including their photo bytes. No announcements. */
export async function importRatings(userId:string,groupId:string,input:unknown){
  validId(userId);validId(groupId);const value=parse(schema,input);
  if(groupId===value.sourceGroupId)throw new ServiceError(400,'Choose a different source group.');
  return transaction(async db=>{
    // Stable lock order also serializes opposite-direction imports and membership changes.
    await db.query('SELECT id FROM everrate.groups WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[groupId,value.sourceGroupId]]);
    for(const id of [groupId,value.sourceGroupId]){
      await requireMembership(db,userId,id);
      // Platform visibility alone must never grant cross-group copying rights.
      if(!(await db.query('SELECT 1 FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[id,userId])).rowCount)throw new ServiceError(403,'Join both groups before importing ratings.');
    }
    for(const [id,category] of [[groupId,value.destinationCategoryId],[value.sourceGroupId,value.sourceCategoryId]]){
      if(!(await db.query('SELECT id FROM everrate.item_types WHERE group_id=$1 AND id=$2 FOR SHARE',[id,category])).rowCount)throw new ServiceError(404,'Category not found.');
    }
    const source=await db.query(`SELECT r.*,i.name,i.variant,i.identity_key,i.broad_category,b.name AS brand,p.place_id,${ratingPhotoColumns}
      FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id
      LEFT JOIN everrate.brands b ON b.id=i.brand_id
      LEFT JOIN everrate.restaurant_places p ON p.group_id=i.group_id AND p.item_id=i.id
      WHERE r.group_id=$1 AND r.user_id=$2 AND i.type_id=$3 AND r.deleted_at IS NULL AND r.photo_id IS NOT NULL
      ORDER BY r.tasted_at,r.created_at,r.id FOR SHARE OF r,i`,[value.sourceGroupId,userId,value.sourceCategoryId]);
    let imported=0,skipped=0;
    for(const row of source.rows){
      const key=`group-import:${groupId}:${row.id}`;
      if((await db.query('SELECT id FROM everrate.ratings WHERE user_id=$1 AND idempotency_key=$2',[userId,key])).rowCount){skipped++;continue;}
      const brandId=await lookupLabel(db,'brands',groupId,row.brand);
      let itemId=(await db.query('SELECT id FROM everrate.items WHERE group_id=$1 AND type_id=$2 AND identity_key=$3 ORDER BY created_at,id LIMIT 1',[groupId,value.destinationCategoryId,row.identity_key])).rows[0]?.id;
      if(!itemId)itemId=(await db.query(`INSERT INTO everrate.items(group_id,name,brand_id,variant,type_id,broad_category,identity_key,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[groupId,row.name,brandId,row.variant,value.destinationCategoryId,row.broad_category,row.identity_key,userId])).rows[0].id;
      const photos:string[]=[];
      for(const photoId of row.photo_ids){
        const photo=await db.query(`INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height)
          SELECT $1,$2,data,sha256,mime_type,width,height FROM everrate.photos WHERE group_id=$3 AND id=$4 RETURNING id`,[groupId,userId,value.sourceGroupId,photoId]);
        if(!photo.rowCount)throw new ServiceError(409,'A source photo is no longer available. Try again.');
        photos.push(photo.rows[0].id);
      }
      if(row.place_id)await db.query(`INSERT INTO everrate.restaurant_places(group_id,item_id,place_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[groupId,itemId,row.place_id,userId]);
      const rating=await db.query(`INSERT INTO everrate.ratings(group_id,item_id,user_id,score,note,tasted_at,photo_id,source,idempotency_key,custom_fields,category_fields)
        VALUES($1,$2,$3,$4,$5,$6,$7,'import',$8,$9,$10) RETURNING id`,[groupId,itemId,userId,row.score,row.note,row.tasted_at,photos[0],key,JSON.stringify(row.custom_fields),JSON.stringify(row.category_fields)]);
      await replaceExtraPhotos(db,groupId,rating.rows[0].id,photos);imported++;
    }
    await audit(db,userId,groupId,'ratings.import',groupId,{...value,imported,skipped});
    return {imported,skipped};
  });
}
