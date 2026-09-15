import { Pool, type PoolClient, type QueryResultRow } from 'pg';
let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not configured');
    pool = new Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, statement_timeout: 20_000, application_name: 'tastebuds' });
  }
  return pool;
}
export type Db = Pick<PoolClient, 'query'>;
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) { return getPool().query<T>(sql, values); }
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
