import {isPlatformAdmin} from '../platform-admin';
import {canManageGroup} from '../../domain/group-roles';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Bootstrap, Group, GroupDetail, GroupPatch } from '../../lib/contracts';
import { groupPatchSchema, nameSchema } from '../../domain/validation';
import { getPool, transaction, type Db } from '../db';
import { audit, iso, parse, requireMembership, ServiceError, user, validId } from './common';
const invite = () => randomBytes(24).toString('base64url');
export {ensureUser} from './users';
function group(row: Record<string, any>): Group { return { mapsEnabled:row.maps_enabled===true,id: row.id,name: row.name,ownerId: row.owner_id,role: row.role,memberCount: Number(row.member_count),createdAt: iso(row.created_at) }; }
export async function bootstrap(userId: string): Promise<Bootstrap> {
  validId(userId);
  const account = await getPool().query('SELECT * FROM everrate.users WHERE id=$1', [userId]);
  if (!account.rowCount) throw new ServiceError(401,'Sign in to continue');
  const groups = await getPool().query(`SELECT g.*,EXISTS(SELECT 1 FROM everrate.item_types t WHERE t.group_id=g.id AND t.fields @> '[{"type":"location"}]'::jsonb) maps_enabled,CASE WHEN $2::boolean THEN 'admin' ELSE m.role END AS role,(SELECT count(*) FROM everrate.memberships members WHERE members.group_id=g.id AND EXISTS(SELECT 1 FROM everrate.ratings r WHERE r.group_id=g.id AND r.user_id=members.user_id AND r.deleted_at IS NULL)) AS member_count FROM everrate.groups g LEFT JOIN everrate.memberships m ON m.group_id=g.id AND m.user_id=$1 WHERE m.user_id=$1 OR $2::boolean ORDER BY g.created_at`, [userId,isPlatformAdmin(userId)]);
  return { user: user(account.rows[0]), groups: groups.rows.map(group) };
}
async function detail(db: Db, userId: string, groupId: string): Promise<GroupDetail> {
  const membership = await requireMembership(db,userId,groupId);
  const result = await db.query(`SELECT g.*,EXISTS(SELECT 1 FROM everrate.item_types t WHERE t.group_id=g.id AND t.fields @> '[{"type":"location"}]'::jsonb) maps_enabled, (SELECT count(*) FROM everrate.memberships members WHERE members.group_id=g.id AND EXISTS(SELECT 1 FROM everrate.ratings r WHERE r.group_id=g.id AND r.user_id=members.user_id AND r.deleted_at IS NULL)) member_count, EXISTS(SELECT 1 FROM everrate.discord_connections WHERE group_id=g.id AND enabled) discord_connected FROM everrate.groups g WHERE id=$1`,[groupId]);
  const members = await db.query('SELECT u.*,m.role,m.joined_at FROM everrate.memberships m JOIN everrate.users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY m.joined_at,u.id',[groupId]);
  const stats = await db.query(`SELECT count(DISTINCT r.item_id) item_count,count(*) tasting_count,count(DISTINCT r.user_id) FILTER (WHERE EXISTS (SELECT 1 FROM everrate.memberships m WHERE m.group_id=r.group_id AND m.user_id=r.user_id)) active_members FROM everrate.ratings r WHERE r.group_id=$1 AND r.deleted_at IS NULL`,[groupId]);
  const categories=await db.query('SELECT id,name,fields FROM everrate.item_types WHERE group_id=$1 ORDER BY lower(name)',[groupId]);
  const row = result.rows[0]; const s = stats.rows[0];
  return { categories:categories.rows.map(c=>({id:c.id,name:c.name,fields:c.fields})),...group({...row,role:membership.role}),inviteCode: canManageGroup(membership.role) ? row.invite_code : null,discordConnected: row.discord_connected,members: members.rows.map(row=>({...user(row),role:isPlatformAdmin(row.id)?'admin':row.role,joinedAt:iso(row.joined_at)})),stats:{ itemCount:Number(s.item_count),tastingCount:Number(s.tasting_count),activeMembers:Number(s.active_members) } };
}
export async function getGroup(userId: string, groupId: string): Promise<GroupDetail> { return transaction(db=>detail(db,userId,groupId)); }
export async function createGroup(userId: string, input: { name: string }): Promise<GroupDetail> {
  validId(userId); const { name } = parse(z.object({name:nameSchema}),input);
  return transaction(async db => {
    if (!(await db.query('SELECT id FROM everrate.users WHERE id=$1',[userId])).rowCount) throw new ServiceError(401,'Sign in to continue');
    const result = await db.query('INSERT INTO everrate.groups(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id',[name,userId,invite()]);
    const id = result.rows[0].id;
    await db.query("INSERT INTO everrate.memberships(group_id,user_id,role) VALUES($1,$2,'owner')",[id,userId]);
    await audit(db,userId,id,'group.create',id); return detail(db,userId,id);
  });
}
export async function joinGroup(userId: string, input: { code: string }): Promise<GroupDetail> {
  validId(userId); const { code } = parse(z.object({code:z.string().trim().min(20).max(100)}),input);
  return transaction(async db=> {
    const result = await db.query('SELECT id FROM everrate.groups WHERE invite_code=$1 FOR UPDATE',[code]);
    if (!result.rowCount) throw new ServiceError(404,'Invite not found');
    const id = result.rows[0].id;
    await db.query("INSERT INTO everrate.memberships(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[id,userId]);
    return detail(db,userId,id);
  });
}
export async function updateGroup(userId: string, groupId: string, input: GroupPatch): Promise<GroupDetail | { left: true }> {
  const patch = parse(groupPatchSchema,input); validId(groupId);
  return transaction(async db=> {
    await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[groupId]);
    const membership = await requireMembership(db,userId,groupId,!patch.leave);
    if (patch.leave) {
      if (membership.owner_id === userId) throw new ServiceError(409,'Transfer ownership before leaving');
      await db.query('DELETE FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[groupId,userId]);
      await audit(db,userId,groupId,'group.leave',groupId); return {left:true};
    }
    if (patch.name) await db.query('UPDATE everrate.groups SET name=$1 WHERE id=$2',[patch.name,groupId]);
    if (patch.ownerId && patch.ownerId !== membership.owner_id) {
      if (!(await db.query('SELECT user_id FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[groupId,patch.ownerId])).rowCount) throw new ServiceError(400,'New owner must be a group member');
      await db.query("UPDATE everrate.memberships SET role='member' WHERE group_id=$1 AND user_id=$2",[groupId,membership.owner_id]);
      await db.query("UPDATE everrate.memberships SET role='owner' WHERE group_id=$1 AND user_id=$2",[groupId,patch.ownerId]);
      await db.query('UPDATE everrate.groups SET owner_id=$1 WHERE id=$2',[patch.ownerId,groupId]);
    }
    await audit(db,userId,groupId,'group.update',groupId,patch); return detail(db,userId,groupId);
  });
}
export async function rotateInvite(userId: string, groupId: string): Promise<{ inviteCode: string }> {
  validId(groupId); return transaction(async db=> {
    await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[groupId]); await requireMembership(db,userId,groupId,true);
    const code = invite(); await db.query('UPDATE everrate.groups SET invite_code=$1 WHERE id=$2',[code,groupId]);
    await audit(db,userId,groupId,'group.rotate_invite',groupId); return {inviteCode:code};
  });
}
export async function removeMember(userId: string, groupId: string, memberId: string): Promise<{ deleted: true }> {
  validId(memberId); validId(groupId); return transaction(async db=> {
    await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[groupId]); const membership=await requireMembership(db,userId,groupId,true);
    if (membership.owner_id === memberId) throw new ServiceError(409,'Transfer ownership before leaving');
    if(isPlatformAdmin(memberId))throw new ServiceError(409,'The platform administrator retains access to every group');
    if (!(await db.query('DELETE FROM everrate.memberships WHERE group_id=$1 AND user_id=$2 RETURNING user_id',[groupId,memberId])).rowCount) throw new ServiceError(404,'Member not found');
    await audit(db,userId,groupId,'group.remove_member',memberId); return {deleted:true};
  });
}
