/**
 * Node half of scripts/production-operator.py. Runs one operator change on a client connected
 * through the wrapper's SSH tunnel (PG* environment, loopback only); refuses to run any other way.
 */
import {lstat, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Pool, type PoolClient} from 'pg';
import {createGroupCategory} from './create-group-category';
import {applyIdentityCorrections} from './apply-identity-corrections';
import {runtimeRole} from './provision-runtime-role';

export type Operation = 'category' | 'apply-plan';

export async function readPrivateJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.mode & 0o077 || info.size > 2 * 1024 * 1024) throw new Error('Input must be a regular 0600 file under 2 MiB');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function runOperation(client: PoolClient, operation: Operation, input: unknown, apply: boolean) {
  if (operation === 'category') {
    // Least privilege: the insert runs as the app's runtime role, so it can do only what the app itself could.
    await client.query(`SET ROLE ${runtimeRole}`);
    try { return await createGroupCategory(client, input, {apply}); } finally { await client.query('RESET ROLE'); }
  }
  // The applicator reads its own audit receipts, which the runtime role cannot, so it runs as the operator.
  return applyIdentityCorrections(client, input, {apply});
}

export function assertTunnelEnvironment(env: Record<string, string | undefined>): void {
  if (env.PGHOST !== '127.0.0.1' || !/^\d{2,5}$/.test(env.PGPORT ?? '') || env.PGSSLMODE !== 'disable' || !env.PGPASSFILE || env.PGPASSWORD)
    throw new Error('Run this through scripts/production-operator.py');
}

async function main(): Promise<void> {
  const [operation, ...args] = process.argv.slice(2);
  const flag = operation === 'category' ? '--spec=' : operation === 'apply-plan' ? '--plan=' : null;
  const file = flag && args.find(arg => arg.startsWith(flag))?.slice(flag.length);
  if (!flag || !file || args.some(arg => arg !== '--apply' && !arg.startsWith(flag))) throw new Error('Usage: category --spec=<file> | apply-plan --plan=<file> [--apply]');
  assertTunnelEnvironment(process.env);
  const input = await readPrivateJson(file);
  const pool = new Pool({max: 1, connectionTimeoutMillis: 10000, ssl: false});
  try {
    const client = await pool.connect();
    try { console.log(JSON.stringify(await runOperation(client, operation as Operation, input, args.includes('--apply')))); }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    const known = /^(Usage: .*|Run this through scripts\/production-operator\.py|Input must be a regular 0600 file under 2 MiB|Group not found|A category with this name already exists with a different template|A dedicated idle client is required.*)$/;
    console.error(`Operator change stopped (${error instanceof Error && known.test(error.message) ? error.message : 'failed; nothing was committed unless a result line was printed'}); no credentials were printed.`);
    process.exitCode = 1;
  });
}
