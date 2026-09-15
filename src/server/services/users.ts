import {z} from 'zod';
import type {User} from '../../lib/contracts';
import {idSchema,nameSchema} from '../../domain/validation';
import {transaction} from '../db';
import {parse,ServiceError,user,validId} from './common';

const nicknameSchema=z.object({nickname:z.string().trim().min(1,'Choose a nickname.').max(40,'Use at most 40 characters.').refine(value=>!/[\p{Cc}\u2028\u2029]/u.test(value),'Use a single-line nickname without control characters.')}).strict();

/** The actor comes only from the authenticated session; input cannot select another user. */
export async function updateNickname(userId:string,input:unknown):Promise<User>{
 validId(userId);const {nickname}=parse(nicknameSchema,input);
 return transaction(async db=>{
  const result=await db.query('UPDATE everrate.users SET nickname=$2 WHERE id=$1 RETURNING *',[userId,nickname]);
  if(!result.rowCount)throw new ServiceError(404,'Person not found');
  return user(result.rows[0]);
 });
}

/** Identity inputs must come from a server-validated provider session, never profile text. */
export async function ensureUser(input:{id:string;discordId?:string|null;displayName:string;avatarUrl?:string|null}):Promise<User>{
 const value=parse(z.object({id:idSchema,discordId:z.string().regex(/^\d{1,30}$/).nullable().optional(),displayName:nameSchema,avatarUrl:z.string().url().max(2000).nullable().optional()}),input);
 return transaction(async db=>{
  // Serialize account resolution, including first logins whose rows do not exist yet.
  // This short transaction never changes historical foreign keys or archived aliases.
  await db.query('SELECT pg_advisory_xact_lock(1702258036,1)');
  const byAuth=(await db.query('SELECT * FROM everrate.users WHERE id=$1 FOR UPDATE',[value.id])).rows[0];
  let account=byAuth;
  if(value.discordId){
   const ids=(await db.query(`SELECT id FROM everrate.users WHERE discord_id=$1
    UNION SELECT user_id AS id FROM everrate.legacy_aliases WHERE discord_id=$1`,[value.discordId])).rows.map(row=>row.id);
   if(ids.length>1||(byAuth&&ids.length===1&&ids[0]!==byAuth.id))throw new ServiceError(403,'Account identities conflict. Contact the group owner.');
   if(ids.length===1)account=(await db.query('SELECT * FROM everrate.users WHERE id=$1 FOR UPDATE',[ids[0]])).rows[0];
   else if(byAuth?.discord_id&&byAuth.discord_id!==value.discordId)throw new ServiceError(403,'Account identities conflict. Contact the group owner.');
  }
  if(account){
   const result=await db.query(`UPDATE everrate.users SET discord_id=coalesce(discord_id,$2),display_name=$3,avatar_url=$4 WHERE id=$1 RETURNING *`,[account.id,value.discordId||null,value.displayName,value.avatarUrl||null]);
   return user(result.rows[0]);
  }
  const result=await db.query('INSERT INTO everrate.users(id,discord_id,display_name,avatar_url) VALUES($1,$2,$3,$4) RETURNING *',[value.id,value.discordId||null,value.displayName,value.avatarUrl||null]);
  return user(result.rows[0]);
 });
}
