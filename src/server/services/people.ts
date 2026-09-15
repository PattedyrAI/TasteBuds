import {z} from 'zod';
import {ratingStatusColumns} from './rating-status';
import {transaction} from '../db';
import {parse,requireMembership,ServiceError,validId} from './common';
import type {Person,PersonRating,PersonRatingsPage} from '../../lib/contracts';

const pageSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(30),cursor:z.string().min(1).max(1024).optional()});
const cursorSchema=z.object({tastedAt:z.iso.datetime({offset:true}),createdAt:z.iso.datetime({offset:true}),id:z.uuid()});
type Cursor=z.infer<typeof cursorSchema>;
function decodeCursor(value?:string):Cursor|null {
  if(!value)return null;
  try {
    if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));
  } catch {throw new ServiceError(400,'Invalid history cursor');}
}

// Explicit public fields: account-provider identifiers never enter this response.
const personJson=`jsonb_build_object('id',u.id,'displayName',coalesce(u.nickname,u.display_name),'avatarUrl',u.avatar_url,
  'role',m.role,'joinedAt',m.joined_at,'ratingCount',s.rating_count,'itemCount',s.item_count,'lastRatedAt',s.last_rated_at)`;
export async function listPeople(userId:string,groupId:string):Promise<Person[]> {
  return transaction(async db=>{
    await requireMembership(db,userId,groupId);
    const result=await db.query(`SELECT ${personJson} AS person
      FROM everrate.memberships m JOIN everrate.users u ON u.id=m.user_id
      LEFT JOIN LATERAL (SELECT count(*) AS rating_count,count(DISTINCT r.item_id) AS item_count,max(r.tasted_at) AS last_rated_at
        FROM everrate.ratings r WHERE r.group_id=m.group_id AND r.user_id=m.user_id AND r.deleted_at IS NULL) s ON true
      WHERE m.group_id=$1 AND s.rating_count>0 ORDER BY lower(coalesce(u.nickname,u.display_name)),u.id`,[groupId]);
    return result.rows.map(row=>row.person as Person);
  });
}

export async function getPersonRatings(userId:string,groupId:string,personId:string,input:unknown={}):Promise<PersonRatingsPage> {
  validId(personId);
  const {limit,cursor:encoded}=parse(pageSchema,input),cursor=decodeCursor(encoded);
  return transaction(async db=>{
    await requireMembership(db,userId,groupId);
    // Counts and page use one statement snapshot. The group share lock also keeps
    // membership removal from racing this authorization check.
    const result=await db.query(`WITH history AS (
      SELECT ${ratingStatusColumns},r.id,r.item_id,r.score,r.note,r.photo_id,r.tasted_at,r.created_at,r.legacy_photo_missing,
        i.name AS item_name,b.name AS brand,i.variant
      FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id AND i.group_id=r.group_id
      LEFT JOIN everrate.brands b ON b.id=i.brand_id
      WHERE r.group_id=$1 AND r.user_id=$2 AND r.deleted_at IS NULL
    ) SELECT ${personJson} AS person,
      COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tasted_at DESC,p.created_at DESC,p.id DESC) FROM (
        SELECT * FROM history WHERE $3::timestamptz IS NULL OR (tasted_at,created_at,id)<($3::timestamptz,$4::timestamptz,$5::uuid)
        ORDER BY tasted_at DESC,created_at DESC,id DESC LIMIT $6
      ) p),'[]'::jsonb) AS ratings
      FROM everrate.memberships m JOIN everrate.users u ON u.id=m.user_id
      CROSS JOIN (SELECT count(*) AS rating_count,count(DISTINCT item_id) AS item_count,max(tasted_at) AS last_rated_at FROM history) s
      WHERE m.group_id=$1 AND m.user_id=$2`,[groupId,personId,cursor?.tastedAt??null,cursor?.createdAt??null,cursor?.id??null,limit+1]);
    if(!result.rowCount)throw new ServiceError(404,'Person not found in this group');
    type Row={is_rereview:boolean;counts_toward_average:boolean;id:string;item_id:string;item_name:string;brand:string|null;variant:string|null;score:number;note:string|null;photo_id:string|null;tasted_at:string;created_at:string;legacy_photo_missing:boolean};
    const rows=result.rows[0].ratings as Row[],page=rows.slice(0,limit),last=page.at(-1);
    // JSON timestamps retain PostgreSQL microseconds; converting through Date
    // would truncate the ordering boundary and could skip repeated tastings.
    const nextCursor=rows.length>limit&&last?Buffer.from(JSON.stringify({tastedAt:last.tasted_at,createdAt:last.created_at,id:last.id})).toString('base64url'):null;
    const ratings:PersonRating[]=page.map(r=>({isRereview:r.is_rereview,countsTowardAverage:r.counts_toward_average,id:r.id,itemId:r.item_id,itemName:r.item_name,brand:r.brand,variant:r.variant,score:Number(r.score),note:r.note,photoId:r.photo_id,tastedAt:r.tasted_at,legacyPhotoMissing:r.legacy_photo_missing}));
    return {person:result.rows[0].person as Person,ratings,nextCursor};
  });
}
