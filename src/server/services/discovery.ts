import type {TasteInsights} from '../../lib/contracts';
import {tasteInsights} from '../../domain/taste-insights';
import {transaction} from '../db';
import {requireMembership} from './common';
export async function getTasteInsights(userId:string,groupId:string):Promise<TasteInsights> {
  return transaction(async db=>{
    await requireMembership(db,userId,groupId);
    // A single statement provides one consistent snapshot for both comparisons
    // and divisive items; group lock prevents concurrent membership removal.
    const latest=await db.query(`SELECT DISTINCT ON(r.user_id,r.item_id)
      r.user_id,r.item_id,r.score,coalesce(u.nickname,u.display_name) display_name,u.avatar_url,i.name item_name,b.name brand
      FROM everrate.ratings r
      JOIN everrate.memberships m ON m.group_id=r.group_id AND m.user_id=r.user_id
      JOIN everrate.users u ON u.id=r.user_id
      JOIN everrate.items i ON i.id=r.item_id
      LEFT JOIN everrate.brands b ON b.id=i.brand_id
      WHERE r.group_id=$1 AND r.deleted_at IS NULL
      ORDER BY r.user_id,r.item_id,r.tasted_at DESC,r.created_at DESC,r.id DESC`,[groupId]);
    return tasteInsights(userId,latest.rows.map(row=>({userId:row.user_id,itemId:row.item_id,score:Number(row.score),displayName:row.display_name,avatarUrl:row.avatar_url,itemName:row.item_name,brand:row.brand})));
  });
}
