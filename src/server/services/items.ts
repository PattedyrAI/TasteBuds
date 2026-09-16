import {ratingPhotoColumns} from './rating-photos';
import { z } from 'zod';
import {ratingStatusColumns} from './rating-status';
import type { Comment, FeedEntry, Item, ItemDetail, ItemFilters, Rating, UpdateItemInput } from '../../lib/contracts';
import { transaction, type Db } from '../db';
import { updateItemSchema } from '../../domain/validation';
import { identityKey } from '../../domain/ratings';
import { audit, iso, lookupLabel, lookupCategory, parse, requireMembership, ServiceError, user, userColumns, validId } from './common';
export const itemSelect = `SELECT i.*,b.name AS brand,t.name AS type,
 (SELECT r.custom_fields FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC LIMIT 1) custom_fields,
 (SELECT r.category_fields FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC LIMIT 1) category_fields,
 (SELECT rp.place_id FROM everrate.restaurant_places rp WHERE rp.group_id=i.group_id AND rp.item_id=i.id) place_id,
 coalesce((SELECT photo_id FROM everrate.ratings p WHERE p.item_id=i.id AND p.deleted_at IS NULL AND p.photo_id IS NOT NULL ORDER BY p.tasted_at DESC,p.created_at DESC,p.id DESC LIMIT 1),i.legacy_photo_id) photo_id,
 (SELECT avg(latest.score) FROM (SELECT DISTINCT ON(r.user_id) r.score FROM everrate.ratings r JOIN everrate.memberships m ON m.user_id=r.user_id AND m.group_id=r.group_id WHERE r.item_id=i.id AND r.deleted_at IS NULL ORDER BY r.user_id,r.tasted_at DESC,r.created_at DESC,r.id DESC) latest) average,
 (SELECT count(DISTINCT r.user_id) FROM everrate.ratings r JOIN everrate.memberships m ON m.user_id=r.user_id AND m.group_id=r.group_id WHERE r.item_id=i.id AND r.deleted_at IS NULL) rater_count,
 (SELECT coalesce(jsonb_agg(reviewer ORDER BY reviewer."displayName",reviewer.id),'[]'::jsonb) FROM (
   SELECT u.id,coalesce(u.nickname,u.display_name) AS "displayName",u.avatar_url AS "avatarUrl"
   FROM everrate.users u JOIN everrate.memberships m ON m.user_id=u.id AND m.group_id=i.group_id
   WHERE EXISTS(SELECT 1 FROM everrate.ratings r WHERE r.item_id=i.id AND r.user_id=u.id AND r.deleted_at IS NULL)
   ORDER BY coalesce(u.nickname,u.display_name),u.id LIMIT 4
 ) reviewer) reviewers,
 (SELECT count(*) FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL) tasting_count,
 (SELECT max(tasted_at) FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL) last_rated_at
 FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id`;
export function item(row: Record<string, any>): Item { return { customFields:row.custom_fields??{},categoryFields:row.category_fields??[],placeId:row.place_id??null,reviewers:row.reviewers??[],id:row.id,groupId:row.group_id,createdBy:row.created_by,name:row.name,brand:row.brand || null,variant:row.variant || null,type:row.type || null,broadCategory:row.broad_category || null,photoId:row.photo_id || null,average:row.average === null ? null : Number(row.average),raterCount:Number(row.rater_count),tastingCount:Number(row.tasting_count),lastRatedAt:row.last_rated_at ? iso(row.last_rated_at) : null }; }
/** Enrich in one batch using only the authenticated canonical user. */
async function personalItems(db: Db, rows: Record<string, any>[], userId: string): Promise<Item[]> {
  if (!rows.length) return [];
  const personal = await db.query(`SELECT i.id,
    (SELECT r.score FROM everrate.ratings r WHERE r.item_id=i.id AND r.user_id=$2 AND r.deleted_at IS NULL
      ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC LIMIT 1) my_score,
    EXISTS(SELECT 1 FROM everrate.saved_items s WHERE s.item_id=i.id AND s.user_id=$2 AND s.removed_at IS NULL) saved
    FROM everrate.items i WHERE i.id=ANY($1::uuid[])`,[rows.map(row=>row.id),userId]);
  const byId = new Map(personal.rows.map(row=>[row.id,row]));
  return rows.map(row=>{const own=byId.get(row.id)!;return {...item(row),myScore:own.my_score===null?null:Number(own.my_score),saved:own.saved};});
}
export const ratingSelect = `SELECT r.*,${ratingPhotoColumns},${ratingStatusColumns},${userColumns},i.name item_name,b.name brand,i.variant FROM everrate.ratings r JOIN everrate.users u ON u.id=r.user_id JOIN everrate.items i ON i.id=r.item_id LEFT JOIN everrate.brands b ON b.id=i.brand_id`;
export function comment(row: Record<string, any>): Comment { return {id:row.id,ratingId:row.rating_id,author:user(row),body:row.body,createdAt:iso(row.created_at)}; }
export async function ratingRows(db: Db, rows: Record<string, any>[]): Promise<FeedEntry[]> {
  if (!rows.length) return [];
  const comments = await db.query(`SELECT c.*,${userColumns} FROM everrate.comments c JOIN everrate.users u ON u.id=c.user_id WHERE c.rating_id=ANY($1::uuid[]) AND c.deleted_at IS NULL ORDER BY c.created_at,c.id`,[rows.map(row=>row.id)]);
  const byRating = new Map<string, Comment[]>();
  for (const row of comments.rows) {
    let list = byRating.get(row.rating_id);
    if (!list) { list = []; byRating.set(row.rating_id,list); }
    list.push(comment(row));
  }
  return rows.map(row=>({customFields:row.custom_fields??{},categoryFields:row.category_fields??[],isRereview:row.is_rereview,countsTowardAverage:row.counts_toward_average,id:row.id,groupId:row.group_id,itemId:row.item_id,author:user(row),score:Number(row.score),note:row.note,tastedAt:iso(row.tasted_at),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),photoId:row.photo_id,photoIds:row.photo_ids,legacyPhotoMissing:row.legacy_photo_missing,comments:byRating.get(row.id)||[],itemName:row.item_name,brand:row.brand,variant:row.variant}));
}
export async function getRatingRecord(db: Db, ratingId: string): Promise<Rating> {
  const result = await db.query(`${ratingSelect} WHERE r.id=$1 AND r.deleted_at IS NULL`,[ratingId]);
  if (!result.rowCount) throw new ServiceError(404,'Rating not found');
  return (await ratingRows(db,result.rows))[0];
}
export async function listItems(userId: string, groupId: string, filters: ItemFilters = {}): Promise<Item[]> {
  const filter = parse(z.object({search:z.string().max(200).optional(),brand:z.string().max(200).optional(),type:z.string().max(200).optional(),sort:z.enum(['recent','score','name','most-rated']).optional(),limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().min(0).max(100000).default(0)}),filters);
  return transaction(async db=> {
    await requireMembership(db,userId,groupId);
    const values: unknown[] = [groupId,userId]; let where = ' WHERE i.group_id=$1 AND (EXISTS (SELECT 1 FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL) OR EXISTS (SELECT 1 FROM everrate.saved_items s WHERE s.item_id=i.id AND s.user_id=$2 AND s.removed_at IS NULL))';
    if (filter.search) { values.push('%'+filter.search.replace(/[\\%_]/g,'\\$&')+'%'); where += ` AND concat_ws(' ',i.name,b.name,i.variant,t.name) ILIKE $${values.length}`; }
    if (filter.brand) { values.push(filter.brand); where += ` AND b.name=$${values.length}`; }
    if (filter.type) { values.push(filter.type); where += ` AND t.name=$${values.length}`; }
    const orders = {recent:'last_rated_at DESC NULLS LAST',score:'average DESC NULLS LAST',name:'lower(i.name)', 'most-rated':'tasting_count DESC'};
    values.push(filter.limit,filter.offset);
    const result = await db.query(`${itemSelect}${where} ORDER BY ${orders[filter.sort || 'recent']},i.id LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return personalItems(db,result.rows,userId);
  });
}
export async function getItem(userId: string, itemId: string): Promise<ItemDetail> {
  validId(itemId); return transaction(async db=> {
    const found = await db.query('SELECT group_id FROM everrate.items WHERE id=$1',[itemId]);
    if (!found.rowCount) throw new ServiceError(404,'Item not found');
    await requireMembership(db,userId,found.rows[0].group_id);
    const result = await db.query(`${itemSelect} WHERE i.id=$1`,[itemId]);
    const ratings = await db.query(`${ratingSelect} WHERE r.item_id=$1 AND r.deleted_at IS NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC`,[itemId]);
    return {...(await personalItems(db,result.rows,userId))[0],ratings:await ratingRows(db,ratings.rows)};
  });
}
export async function getFeed(userId: string, groupId: string, input: {limit?:number;offset?:number} = {}): Promise<FeedEntry[]> {
  const filters = parse(z.object({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)}),input);
  return transaction(async db=> { await requireMembership(db,userId,groupId); const result = await db.query(`${ratingSelect} WHERE r.group_id=$1 AND r.deleted_at IS NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,[groupId,filters.limit,filters.offset]); return ratingRows(db,result.rows); });
}
export async function updateItem(userId: string, itemId: string, input: UpdateItemInput): Promise<ItemDetail> {
  validId(itemId); const patch = parse(updateItemSchema,input);
  return transaction(async db => {
    // Lock only the item, then read joined labels in a fresh statement. A joined
    // locking SELECT can pair a refreshed item row with stale brand/type snapshots.
    const locked = await db.query('SELECT group_id FROM everrate.items WHERE id=$1 FOR UPDATE',[itemId]);
    if (!locked.rowCount) throw new ServiceError(404,'Item not found');
    const membership = await requireMembership(db,userId,locked.rows[0].group_id);
    const found = await db.query('SELECT i.*,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=$1',[itemId]);
    const row = found.rows[0];
    if (row.created_by !== userId && membership.role !== 'owner') throw new ServiceError(403,'Only the item creator or group owner can change this item');
    const previous = {name:row.name,brand:row.brand,variant:row.variant,type:row.type,broadCategory:row.broad_category,identityKey:row.identity_key};
    const updated = {
      name:patch.name ?? row.name, brand:patch.brand === undefined ? row.brand : patch.brand,
      variant:patch.variant === undefined ? row.variant : patch.variant,
      type:patch.type === undefined ? row.type : patch.type,
      broadCategory:patch.broadCategory === undefined ? row.broad_category : patch.broadCategory,
    };
    const brandId = patch.brand === undefined ? row.brand_id : await lookupLabel(db,'brands',row.group_id,updated.brand);
    const typeId = patch.type === undefined ? row.type_id : await lookupCategory(db,userId,row.group_id,updated.type);
    await db.query('UPDATE everrate.items SET name=$1,brand_id=$2,variant=$3,type_id=$4,broad_category=$5,identity_key=$6 WHERE id=$7',[updated.name,brandId,updated.variant,typeId,updated.broadCategory,identityKey(updated.name,updated.brand,updated.variant),itemId]);
    await audit(db,userId,row.group_id,'item.update',itemId,{previous,updated});
    const result = await db.query(`${itemSelect} WHERE i.id=$1`,[itemId]);
    const ratings = await db.query(`${ratingSelect} WHERE r.item_id=$1 AND r.deleted_at IS NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC`,[itemId]);
    return {...(await personalItems(db,result.rows,userId))[0],ratings:await ratingRows(db,ratings.rows)};
  });
}

export async function saveItem(userId: string, itemId: string, saved: boolean): Promise<{saved:boolean}> {
  validId(itemId);
  return transaction(async db=>{
    const found=await db.query('SELECT group_id FROM everrate.items WHERE id=$1',[itemId]);
    if (!found.rowCount) throw new ServiceError(404,'Item not found');
    const groupId=found.rows[0].group_id;
    await requireMembership(db,userId,groupId);
    if (saved) await db.query(`INSERT INTO everrate.saved_items(group_id,item_id,user_id) VALUES($1,$2,$3)
      ON CONFLICT(user_id,item_id) DO UPDATE SET removed_at=NULL`,[groupId,itemId,userId]);
    else await db.query('UPDATE everrate.saved_items SET removed_at=coalesce(removed_at,now()) WHERE user_id=$1 AND item_id=$2',[userId,itemId]);
    return {saved};
  });
}
