import {ratingPhotoColumns,requireRatingPhotos,replaceExtraPhotos} from './rating-photos';
import { createHash } from 'node:crypto';
import type { Comment, CreateRatingInput, Rating, UpdateRatingInput, UpdateCommentInput } from '../../lib/contracts';
import { createRatingSchema, updateRatingSchema, commentSchema } from '../../domain/validation';
import { identityKey } from '../../domain/ratings';
import { transaction, type Db } from '../db';
import { audit, lookupLabel, parse, requireMembership, ServiceError, userColumns, validId } from './common';
import { comment, getRatingRecord } from './items';
export async function createRating(userId: string, input: CreateRatingInput): Promise<Rating> {
  validId(userId); const value = parse(createRatingSchema,input);
  const photoIds=value.photoIds??[value.photoId];
  const requestHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return transaction(async db=> {
    await requireMembership(db,userId,value.groupId);
    if (value.idempotencyKey) {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+value.idempotencyKey]);
      const prior = await db.query('SELECT id,request_hash,deleted_at FROM everrate.ratings WHERE user_id=$1 AND idempotency_key=$2',[userId,value.idempotencyKey]);
      if (prior.rowCount) {
        if (prior.rows[0].request_hash !== requestHash || prior.rows[0].deleted_at) throw new ServiceError(409,'This request key has already been used');
        return getRatingRecord(db,prior.rows[0].id);
      }
    }
    let sourcePhotos:string[]=[];
    if (value.rereviewOf) {
      // Lock the original while validating it so deletion/editing cannot change
      // the photo permission between this check and the new history row.
      const source = await db.query(`SELECT photo_id FROM everrate.ratings r
        WHERE id=$1 AND user_id=$2 AND item_id=$3 AND group_id=$4
        AND deleted_at IS NULL FOR SHARE`,
      [value.rereviewOf,userId,value.itemId,value.groupId]);
      if (!source.rowCount) throw new ServiceError(404,'Original rating not found');
      sourcePhotos = (await db.query(`SELECT ${ratingPhotoColumns} FROM everrate.ratings r WHERE r.id=$1`,[value.rereviewOf])).rows[0].photo_ids;
    }
    await requireRatingPhotos(db,userId,value.groupId,photoIds,sourcePhotos);
    let itemId = value.itemId;
    if (itemId) {
      if (!(await db.query('SELECT id FROM everrate.items WHERE id=$1 AND group_id=$2',[itemId,value.groupId])).rowCount) throw new ServiceError(404,'Item not found');
    } else {
      const brandId = await lookupLabel(db,'brands',value.groupId,value.brand);
      const typeId = await lookupLabel(db,'item_types',value.groupId,value.type);
      // Never silently link a candidate: only an explicit itemId selects an existing item.
      const result = await db.query('INSERT INTO everrate.items(group_id,name,brand_id,variant,type_id,broad_category,identity_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[value.groupId,value.name,brandId,value.variant,typeId,value.broadCategory,identityKey(value.name!,value.brand,value.variant),userId]);
      itemId = result.rows[0].id;
    }
    const result = await db.query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score,note,tasted_at,photo_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()),$7,$8,$9) RETURNING id',[value.groupId,itemId,userId,value.score,value.note || null,value.tastedAt || null,value.photoId || null,value.idempotencyKey || null,requestHash]);
    await replaceExtraPhotos(db,value.groupId,result.rows[0].id,photoIds);
    const rating = await getRatingRecord(db,result.rows[0].id);
    await db.query(`INSERT INTO everrate.discord_outbox(group_id,rating_id,payload)
      SELECT r.group_id,r.id,jsonb_build_object('ratingId',r.id,'itemId',i.id,'itemName',i.name,'brand',b.name,'score',r.score,'note',r.note,'authorName',coalesce(u.nickname,u.display_name),'groupName',g.name)
      FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id LEFT JOIN everrate.brands b ON b.id=i.brand_id JOIN everrate.users u ON u.id=r.user_id JOIN everrate.groups g ON g.id=r.group_id JOIN everrate.discord_connections d ON d.group_id=r.group_id AND d.enabled WHERE r.id=$1`,[rating.id]);
    return rating;
  });
}
async function mutableRating(db: Db,userId:string,ratingId:string) {
  validId(ratingId);
  const found = await db.query('SELECT * FROM everrate.ratings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[ratingId]);
  if (!found.rowCount) throw new ServiceError(404,'Rating not found');
  const row = found.rows[0]; const membership = await requireMembership(db,userId,row.group_id);
  if (row.user_id !== userId && membership.role !== 'owner') throw new ServiceError(403,'You can only change your own rating');
  row.photo_ids=(await db.query(`SELECT ${ratingPhotoColumns} FROM everrate.ratings r WHERE r.id=$1`,[ratingId])).rows[0].photo_ids;
  return row;
}
export async function updateRating(userId: string, ratingId: string, input: UpdateRatingInput): Promise<Rating> {
  const patch = parse(updateRatingSchema,input);
  return transaction(async db=> {
    const row = await mutableRating(db,userId,ratingId);
    const photoIds:string[]=patch.photoIds??(patch.photoId?[patch.photoId,...row.photo_ids.slice(1).filter((id:string)=>id!==patch.photoId)]:row.photo_ids);
    const photoId=photoIds[0];
    if (!photoId) throw new ServiceError(400,'Add a photo before correcting this historical rating');
    await requireRatingPhotos(db,userId,row.group_id,photoIds,row.photo_ids);
    await db.query("INSERT INTO everrate.rating_revisions(rating_id,actor_id,action,previous_value) VALUES($1,$2,'update',$3)",[ratingId,userId,JSON.stringify(row)]);
    await db.query('UPDATE everrate.ratings SET score=$1,note=$2,tasted_at=$3,photo_id=$4,legacy_photo_missing=false,updated_at=now() WHERE id=$5',[patch.score ?? row.score,patch.note === undefined ? row.note : patch.note,patch.tastedAt ?? row.tasted_at,photoId,ratingId]);
    await replaceExtraPhotos(db,row.group_id,ratingId,photoIds);
    await audit(db,userId,row.group_id,'rating.update',ratingId);
    return getRatingRecord(db,ratingId);
  });
}
export async function deleteRating(userId: string,ratingId:string): Promise<{deleted:true}> {
  return transaction(async db=> {
    const row = await mutableRating(db,userId,ratingId);
    await db.query("INSERT INTO everrate.rating_revisions(rating_id,actor_id,action,previous_value) VALUES($1,$2,'delete',$3)",[ratingId,userId,JSON.stringify(row)]);
    await db.query('UPDATE everrate.ratings SET deleted_at=now(),updated_at=now() WHERE id=$1',[ratingId]);
    await db.query("UPDATE everrate.discord_outbox SET status='cancelled' WHERE rating_id=$1 AND status IN ('pending','processing','failed')",[ratingId]);
    await audit(db,userId,row.group_id,'rating.delete',ratingId); return {deleted:true};
  });
}
export async function addComment(userId:string,ratingId:string,input:{body:string}): Promise<Comment> {
  validId(ratingId); const {body} = parse(commentSchema,input);
  return transaction(async db=> {
    const result = await db.query('SELECT group_id FROM everrate.ratings WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[ratingId]);
    if (!result.rowCount) throw new ServiceError(404,'Rating not found');
    const groupId = result.rows[0].group_id; await requireMembership(db,userId,groupId);
    const inserted = await db.query('INSERT INTO everrate.comments(group_id,rating_id,user_id,body) VALUES($1,$2,$3,$4) RETURNING id',[groupId,ratingId,userId,body]);
    const row = await db.query(`SELECT c.*,${userColumns} FROM everrate.comments c JOIN everrate.users u ON u.id=c.user_id WHERE c.id=$1`,[inserted.rows[0].id]); return comment(row.rows[0]);
  });
}
export async function deleteComment(userId:string,commentId:string): Promise<{deleted:true}> {
  validId(commentId); return transaction(async db=> {
    const found = await db.query('SELECT * FROM everrate.comments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[commentId]);
    if (!found.rowCount) throw new ServiceError(404,'Comment not found');
    const row = found.rows[0]; const membership = await requireMembership(db,userId,row.group_id);
    if (row.user_id !== userId && membership.role !== 'owner') throw new ServiceError(403,'You can only delete your own comment');
    await db.query('UPDATE everrate.comments SET deleted_at=now() WHERE id=$1',[commentId]);
    await audit(db,userId,row.group_id,'comment.delete',commentId,{previousBody:row.body}); return {deleted:true};
  });
}
export async function updateComment(userId: string, commentId: string, input: UpdateCommentInput): Promise<Comment> {
  validId(commentId); const {body} = parse(commentSchema,input);
  return transaction(async db => {
    const found = await db.query('SELECT * FROM everrate.comments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[commentId]);
    if (!found.rowCount) throw new ServiceError(404,'Comment not found');
    const row = found.rows[0]; const membership = await requireMembership(db,userId,row.group_id);
    if (row.user_id !== userId && membership.role !== 'owner') throw new ServiceError(403,'You can only change your own comment');
    await audit(db,userId,row.group_id,'comment.update',commentId,{previousBody:row.body});
    await db.query('UPDATE everrate.comments SET body=$1 WHERE id=$2',[body,commentId]);
    const updated = await db.query(`SELECT c.*,${userColumns} FROM everrate.comments c JOIN everrate.users u ON u.id=c.user_id WHERE c.id=$1`,[commentId]);
    return comment(updated.rows[0]);
  });
}
