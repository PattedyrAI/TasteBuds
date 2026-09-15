import type { z } from 'zod';
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
  await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR SHARE', [groupId]);
  const result = await db.query(`SELECT m.role, g.owner_id FROM everrate.memberships m JOIN everrate.groups g ON g.id=m.group_id WHERE m.user_id=$1 AND m.group_id=$2`, [userId, groupId]);
  if (!result.rowCount) throw new ServiceError(404, 'Group not found');
  if (owner && result.rows[0].role !== 'owner') throw new ServiceError(403, 'Only the group owner can do this');
  return result.rows[0] as { role: 'owner'|'member'; owner_id: string };
}
export async function audit(db: Db, userId: string, groupId: string, action: string, resourceId: string, details: unknown = {}) {
  await db.query('INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5)', [userId,groupId,action,resourceId,JSON.stringify(details)]);
}
export function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : value; }
export function user(row: Record<string, any>): User { return { id: row.user_id || row.id, discordId: row.discord_id || null, displayName: row.display_name, avatarUrl: row.avatar_url || null }; }
export const userColumns = 'u.id AS user_id,u.discord_id,u.display_name,u.avatar_url';

export async function lookupLabel(db: Db, table: 'brands'|'item_types', groupId: string, name?: string|null): Promise<string|null> {
  if (!name) return null;
  if (table === 'item_types') name = canonicalItemType(name);
  const result = await db.query(`INSERT INTO everrate.${table}(group_id,name) VALUES($1,$2) ON CONFLICT(group_id,lower(name)) DO UPDATE SET name=everrate.${table}.name RETURNING id`,[groupId,name]);
  return result.rows[0].id;
}
