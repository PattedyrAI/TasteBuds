import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
export async function migrate(connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('everrate:migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS everrate');
    await client.query('REVOKE ALL ON SCHEMA everrate FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS everrate.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = resolve(process.cwd(), 'db/migrations');
    for (const name of (await readdir(folder)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(resolve(folder, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = await client.query('SELECT checksum FROM everrate.schema_migrations WHERE name=$1', [name]);
      if (old.rowCount) { if (old.rows[0].checksum !== checksum) throw new Error(`Applied migration checksum changed: ${name}`); continue; }
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO everrate.schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log(`Applied ${name}`);
    }
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('everrate:migrations'))"); client.release(); await pool.end(); }
}
if (process.argv[1]?.endsWith('migrate.ts')) migrate().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
