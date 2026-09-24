import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';

export const runtimeRole='everrate_app';
const mutable=['users','groups','memberships','brands','item_types','items','photos','ratings','comments','recognition_jobs','discord_connections','discord_outbox','saved_items'];

/** Called only by the deployment operator, never the running app. */
export async function provisionRuntimeRole(connectionString:string,password:string,apply=false){
  if(!/^[a-f0-9]{64}$/.test(password))throw new Error('Expected a generated 32-byte hexadecimal password');
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:10000,statement_timeout:30000});
  const db=await pool.connect();
  try{
    const existing=await db.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[runtimeRole]);
    if(existing.rowCount)throw new Error('Runtime role already exists; inspect it instead of rotating credentials');
    if(!(await db.query("SELECT 1 FROM pg_namespace WHERE nspname='everrate'")).rowCount)throw new Error('TasteBuds schema must be restored first');
    if(!apply)return {applied:false,role:runtimeRole,mutableTables:mutable,readOnlyTables:['legacy_aliases'],appendOnlyTables:['rating_revisions','audit_events']};
    await db.query('BEGIN');
    // Role and password are fixed/validated identifiers, never arbitrary SQL input.
    await db.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20`);
    await db.query(`ALTER ROLE ${runtimeRole} SET search_path = pg_catalog, everrate`);
    await db.query('REVOKE ALL ON SCHEMA everrate FROM PUBLIC');
    await db.query('REVOKE ALL ON ALL TABLES IN SCHEMA everrate FROM PUBLIC');
    await db.query(`GRANT USAGE ON SCHEMA everrate TO ${runtimeRole}`);
    for(const table of mutable)await db.query(`GRANT SELECT,INSERT,UPDATE ON everrate.${table} TO ${runtimeRole}`);
    await db.query(`GRANT SELECT ON everrate.legacy_aliases TO ${runtimeRole}`);
    await db.query(`GRANT SELECT,INSERT,DELETE ON everrate.rating_photos TO ${runtimeRole}`);
    await db.query(`GRANT SELECT,INSERT,DELETE ON everrate.restaurant_places TO ${runtimeRole}`);
    await db.query(`GRANT SELECT,INSERT,UPDATE ON everrate.google_places_usage TO ${runtimeRole}`);
    await db.query(`GRANT DELETE ON everrate.memberships TO ${runtimeRole}`);
    await db.query(`GRANT INSERT ON everrate.rating_revisions,everrate.audit_events TO ${runtimeRole}`);
    await db.query('COMMIT');
    return {applied:true,role:runtimeRole,mutableTables:mutable,readOnlyTables:['legacy_aliases'],appendOnlyTables:['rating_revisions','audit_events']};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await pool.end();}
}

async function main(){
  const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'))throw new Error('Only --apply is supported');
  const url=process.env.MIGRATION_DATABASE_URL;if(!url)throw new Error('Set the reviewed migration connection');
  const folder=resolve('.private');await mkdir(folder,{recursive:true,mode:0o700});
  const file=resolve(folder,'runtime-role-password');let password:string;
  try{password=(await readFile(file,'utf8')).trim();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;password=randomBytes(32).toString('hex');await writeFile(file,password,{mode:0o600,flag:'wx'});}
  await chmod(file,0o600);
  console.log(JSON.stringify(await provisionRuntimeRole(url,password,args.includes('--apply'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Runtime role provisioning stopped. Inspect target state; no credentials were logged.');process.exitCode=1;});
