/**
 * Creates one category template in one group as an operator change: the same validation and insert as
 * the app's createCategory, but the audit actor is null and the operator note says who asked for it
 * (the app's own path records a group manager, and an operator must not pose as one).
 * Validates and rolls back by default; `--apply` commits.
 */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool, type PoolClient} from 'pg';
import {z} from 'zod';
import {canonicalItemType} from '../src/domain/item-types';
import {categoryFieldsSchema} from '../src/domain/category-template';
import {nameSchema} from '../src/domain/validation';

export const categorySpecSchema = z.object({
  groupId: z.string().uuid(), name: nameSchema, fields: categoryFieldsSchema.default([]), // same default as createCategory
  note: z.string().trim().min(10).max(500),
}).strict();
export type CategorySpec = z.infer<typeof categorySpecSchema>;
// jsonb stores object keys in its own order, so compare with keys sorted.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const sameFields = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export async function createGroupCategory(client: PoolClient, input: unknown, {apply = false}: {apply?: boolean} = {}) {
  const spec = categorySpecSchema.parse(input), name = canonicalItemType(spec.name);
  let idle = false;
  try { await client.query('SAVEPOINT category_idle_probe'); }
  catch (error) { if ((error as {code?: string}).code === '25P01') idle = true; else throw error; }
  if (!idle) { await client.query('RELEASE SAVEPOINT category_idle_probe'); throw new Error('A dedicated idle client is required'); }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'"); await client.query("SET LOCAL statement_timeout='30s'");
    // Same lock and uniqueness rule as createCategory.
    if (!(await client.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE', [spec.groupId])).rowCount) throw new Error('Group not found');
    const existing = await client.query<{id: string; name: string; fields: unknown}>('SELECT id,name,fields FROM everrate.item_types WHERE group_id=$1 AND lower(name)=lower($2)', [spec.groupId, name]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      // A rerun with the same template is a no-op; a different template is never overwritten here.
      if (sameFields(existing.rows[0].fields, spec.fields)) return {status: 'already-exists' as const, categoryId: existing.rows[0].id, applied: false};
      throw new Error('A category with this name already exists with a different template');
    }
    const row = (await client.query<{id: string}>('INSERT INTO everrate.item_types(group_id,name,fields) VALUES($1,$2,$3) RETURNING id', [spec.groupId, name, JSON.stringify(spec.fields)])).rows[0];
    await client.query("INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES(NULL,$1,'category.create',$2,$3)",
      [spec.groupId, row.id, JSON.stringify({operator: true, note: spec.note, name, fields: spec.fields})]);
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {status: apply ? 'created' as const : 'validated' as const, categoryId: row.id, applied: apply};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), spec = args.find(arg => arg.startsWith('--spec='))?.slice(7);
  if (!spec || args.some(arg => !['--apply', '--allow-remote'].includes(arg) && !arg.startsWith('--spec='))) throw new Error('Usage: --spec=<file.json> [--apply] [--allow-remote]');
  const connectionString = process.env.CATEGORY_DATABASE_URL;
  if (!connectionString) throw new Error('CATEGORY_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) throw new Error('Use an explicit PostgreSQL URL without query options');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !args.includes('--allow-remote')) throw new Error('A non-loopback database needs --allow-remote');
  const pool = new Pool({connectionString, max: 1, connectionTimeoutMillis: 10000});
  try {
    const client = await pool.connect();
    try {
      const result = await createGroupCategory(client, JSON.parse(await readFile(resolve(spec), 'utf8')), {apply: args.includes('--apply')});
      console.log(JSON.stringify(result));
      if (result.status === 'validated') console.log('Validated and rolled back. Add --apply to create it.');
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    const known = /^(Usage: .*|CATEGORY_DATABASE_URL is required|Use an explicit PostgreSQL URL without query options|A non-loopback database needs --allow-remote|Group not found|A category with this name already exists with a different template|A dedicated idle client is required)$/;
    console.error(`Category creation stopped (${error instanceof Error && known.test(error.message) ? error.message : error instanceof z.ZodError ? 'invalid spec: ' + error.issues.map(i => i.message).join('; ') : 'failed'}); no credentials were printed.`);
    process.exitCode = 1;
  });
}
