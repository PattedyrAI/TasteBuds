import type { z } from 'zod';
import {isPlatformAdmin} from '../platform-admin';
import {canManageGroup,type GroupRole} from '../../domain/group-roles';
import { idSchema } from '../../domain/validation';
import type { Db } from '../db';
import type { User } from '../../lib/contracts';
import { canonicalItemType } from '../../domain/item-types';
export class ServiceError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'ServiceError'; } }
export function parse<T>(schema: z.ZodType<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new ServiceError(400, result.error.issues[0]?.message || 'Invalid request'); return result.data; }
export const validId = (id: string) => parse(idSchema, id);
export async function requireMembership(db: Db, userId: string, groupId: string, owner = false) {
  validId(userId); validId(groupId);
  // Acquire the group lock BEFORE the membership query: a single joined locking SELECT
  // can retain a stale membership snapshot while waiting for an owner to remove it.
  const group=await db.query('SELECT id,owner_id FROM everrate.groups WHERE id=$1 FOR SHARE', [groupId]);
  if(!group.rowCount)throw new ServiceError(404,'Group not found');
  if(isPlatformAdmin(userId)&&(await db.query('SELECT id FROM everrate.users WHERE id=$1',[userId])).rowCount)return {role:'admin' as const,owner_id:group.rows[0].owner_id as string};
  const result = await db.query(`SELECT m.role, g.owner_id FROM everrate.memberships m JOIN everrate.groups g ON g.id=m.group_id WHERE m.user_id=$1 AND m.group_id=$2`, [userId, groupId]);
  if (!result.rowCount) throw new ServiceError(404, 'Group not found');
  if (owner && !canManageGroup(result.rows[0].role)) throw new ServiceError(403, 'Only the group owner can do this');
  return result.rows[0] as { role: GroupRole; owner_id: string };
}
export async function audit(db: Db, userId: string, groupId: string, action: string, resourceId: string, details: unknown = {}) {
  await db.query('INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5)', [userId,groupId,action,resourceId,JSON.stringify(details)]);
}
export function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : value; }
export function user(row: Record<string, any>): User { return { id: row.user_id || row.id, discordId: row.discord_id || null, nickname: row.nickname ?? null, aiEnabled: row.ai_enabled === true, displayName: row.nickname ?? row.display_name, avatarUrl: row.avatar_url || null }; }
export const userColumns = 'u.id AS user_id,u.discord_id,u.nickname,u.ai_enabled,u.display_name,u.avatar_url';

export async function lookupLabel(db: Db, table: 'brands'|'item_types', groupId: string, name?: string|null): Promise<string|null> {
  if (!name) return null;
  if (table === 'item_types') name = canonicalItemType(name);
  const result = await db.query(`INSERT INTO everrate.${table}(group_id,name) VALUES($1,$2) ON CONFLICT(group_id,lower(name)) DO UPDATE SET name=everrate.${table}.name RETURNING id`,[groupId,name]);
  return result.rows[0].id;
}

export async function lookupCategory(db:Db,userId:string,groupId:string,name?:string|null):Promise<string|null>{
  if(!name)return null;
  const canonical=canonicalItemType(name);
  const found=await db.query('SELECT id FROM everrate.item_types WHERE group_id=$1 AND lower(name)=lower($2)',[groupId,canonical]);
  if(found.rowCount)return found.rows[0].id;
  await requireMembership(db,userId,groupId,true);
  return lookupLabel(db,'item_types',groupId,canonical);
}
