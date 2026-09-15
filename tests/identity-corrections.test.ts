import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {migrate} from '../scripts/migrate';
import {applyIdentityCorrections,captureIdentitySnapshots,identitySnapshotSha256,identityPlanSha256} from '../scripts/apply-identity-corrections';

const url=process.env.TEST_DATABASE_URL;
if(url&&(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local test database required');

describe('correction hashes',()=>{
  it('canonicalizes object keys while preserving array order and exact text',()=>{
    expect(identitySnapshotSha256({b:2,a:{z:null,y:'Name'}})).toBe(identitySnapshotSha256({a:{y:'Name',z:null},b:2}));
    expect(identitySnapshotSha256({name:'Name'})).not.toBe(identitySnapshotSha256({name:'name'}));
    expect(identitySnapshotSha256([1,2])).not.toBe(identitySnapshotSha256([2,1]));
    expect(identitySnapshotSha256({a:1})).toBe(createHash('sha256').update('{"a":1}').digest('hex'));
  });
});

describe.skipIf(!url)('reviewed corrections in disposable PostgreSQL fixtures',()=>{
  let admin:Pool,pool:Pool,client:PoolClient,database:string;
  beforeAll(async()=>{
    admin=new Pool({connectionString:url});database='everrate_identity_'+randomUUID().replaceAll('-','')+'_test';
    await admin.query(`CREATE DATABASE "${database}"`);
    const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());
    pool=new Pool({connectionString:target.toString(),max:3});client=await pool.connect();
  });
  afterAll(async()=>{client?.release();await pool?.end();if(database)await admin.query(`DROP DATABASE "${database}"`);await admin?.end();});
  async function fixture(){
    const user=randomUUID(),group=randomUUID(),item=randomUUID(),destination=randomUUID(),fork=randomUUID();
    const ratings=[randomUUID(),randomUUID(),randomUUID()],photos=[randomUUID(),randomUUID(),randomUUID()];
    await client.query('INSERT INTO everrate.users(id,display_name) VALUES($1,$2)',[user,'Private fixture author']);
    await client.query('INSERT INTO everrate.groups(id,owner_id,name,invite_code) VALUES($1,$2,$3,$4)',[group,user,'Fixture',randomUUID()]);
    for(const id of [item,destination])await client.query('INSERT INTO everrate.items(id,group_id,name,identity_key,created_by,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,group,id===item?'Monster Mixed':'Lando Norris','old',user,{id:'legacy-'+id}]);
    for(let n=0;n<3;n++){
      const bytes=Buffer.from('photo fixture '+n),sha=createHash('sha256').update(bytes).digest('hex');
      await client.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',1,1)",[photos[n],group,user,bytes,sha]);
      await client.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,photo_id,source,source_message_id,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6,'2026-01-02T03:04:05.123456Z',$7,'import',$8,$9)",[ratings[n],group,item,user,7+n,'Private original note '+n,photos[n],'source-'+ratings[n],{original:true}]);
    }
    await client.query('INSERT INTO everrate.comments(group_id,rating_id,user_id,body) VALUES($1,$2,$3,$4)',[group,ratings[0],user,'Preserved comment']);
    await client.query("INSERT INTO everrate.rating_revisions(rating_id,actor_id,action,previous_value) VALUES($1,NULL,'update',$2)",[ratings[0],{original:'Preserved revision'}]);
    const source=randomUUID(),raw={original:'Archived source, unchanged'},sourceHash=identitySnapshotSha256(raw),blob=Buffer.from('Original archived file '+item),blobHash=createHash('sha256').update(blob).digest('hex');
    await client.query("INSERT INTO everrate.import_sources(id,source_key,source_type) VALUES($1,$2,'fixture')",[source,'identity-fixture:'+item]);
    await client.query("INSERT INTO everrate.legacy_records(source_id,table_name,record_key,sha256,raw_record,captured_at) VALUES($1,'ratings',$2,$3,$4,now())",[source,ratings[0],sourceHash,raw]);
    await client.query("INSERT INTO everrate.legacy_import_links(source_id,table_name,record_key,target_table,target_id,source_sha256) VALUES($1,'ratings',$2::text,'ratings',$2::uuid,$3)",[source,ratings[0],sourceHash]);
    await client.query('INSERT INTO everrate.archive_blobs(sha256,byte_size,data) VALUES($1,$2,$3)',[blobHash,blob.length,blob]);
    await client.query("INSERT INTO everrate.archive_files(source_id,relative_path,sha256,byte_size,blob_sha256) VALUES($1,'original.txt',$2,$3,$2)",[source,blobHash,blob.length]);
    await client.query("INSERT INTO everrate.archive_proposals(source_id,source_file,record_key,sha256,raw_record,disposition,linked_rating_id) VALUES($1,'original.json',$2::text,$3,$4,'applied',$2::uuid)",[source,ratings[0],sourceHash,raw]);
    const snapshots=await captureIdentitySnapshots(client,{itemIds:[item,destination],ratingIds:ratings,photoIds:photos});
    const plan={version:1,planId:randomUUID(),groupId:group,evidence:'Reviewed three distinct photo editions; no inferred authorship.',items:snapshots.items.map(row=>({id:row.id,expectedSha256:row.sha256})),photos:snapshots.photos.map(row=>({id:row.id,expectedSha256:row.sha256})),updates:[{itemId:item,set:{name:'Zero Sugar',brand:'Monster',variant:null,type:'Energy drinks'}}],forks:[{newItemId:fork,sourceItemId:item,set:{name:'Lewis Hamilton',brand:'Monster',variant:null,type:'Energy drinks',broadCategory:'Food & Drink'},photoId:photos[2]}],moves:[{ratingId:ratings[0],fromItemId:item,toItemId:destination,expectedSha256:snapshots.ratings[0]?.sha256,photoId:photos[0],photoSha256:snapshots.photos.find(row=>row.id===photos[0])?.sha256},{ratingId:ratings[2],fromItemId:item,toItemId:fork,expectedSha256:snapshots.ratings[2]?.sha256,photoId:photos[2],photoSha256:snapshots.photos.find(row=>row.id===photos[2])?.sha256}]};
    // Helpers return UUID-sorted arrays; bind each rating by its ID, not incidental order.
    for(const move of plan.moves)move.expectedSha256=snapshots.ratings.find(row=>row.id===move.ratingId)!.sha256;
    return {user,group,item,destination,fork,ratings,photos,plan,snapshots};
  }
  async function related(group:string){
    const values:Record<string,unknown>={};
    for(const table of ['comments','rating_revisions','legacy_import_links','legacy_records','archive_blobs','archive_files','archive_proposals','discord_outbox']){
      const where=table==='rating_revisions'?'WHERE rating_id IN (SELECT id FROM everrate.ratings WHERE group_id=$1)':table==='comments'||table==='discord_outbox'?'WHERE group_id=$1':'';
      values[table]=(await client.query(`SELECT to_jsonb(t) row FROM everrate.${table} t ${where} ORDER BY to_jsonb(t)::text`,where?[group]:[])).rows;
    }
    return values;
  }
  it('dry-run validates without changes, apply preserves rating details/history, rerun is a no-op',async()=>{
    const f=await fixture(),before=await related(f.group);
    expect(f.snapshots.photos[0]).not.toHaveProperty('data');
    const dry=await applyIdentityCorrections(client,f.plan);
    expect(dry).toMatchObject({applied:false,updates:1,forks:1,moves:2});
    expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[f.fork])).rowCount).toBe(0);
    const report=await applyIdentityCorrections(client,f.plan,{apply:true});expect(report).toMatchObject({applied:true,alreadyApplied:false,updates:1,forks:1,moves:2});
    const after=await captureIdentitySnapshots(client,{itemIds:[f.item,f.fork],ratingIds:f.ratings,photoIds:f.photos});
    for(const rating of after.ratings){
      const old=f.snapshots.ratings.find(row=>row.id===rating.id)!.snapshot;
      expect({...rating.snapshot,item_id:old.item_id}).toEqual(old);
      expect(rating.snapshot.tasted_at).toContain('123456');
    }
    expect(after.ratings.find(row=>row.id===f.ratings[0])?.snapshot.item_id).toBe(f.destination);
    expect(after.ratings.find(row=>row.id===f.ratings[1])?.snapshot.item_id).toBe(f.item);
    expect(after.ratings.find(row=>row.id===f.ratings[2])?.snapshot.item_id).toBe(f.fork);
    expect(after.items.find(row=>row.id===f.fork)?.snapshot.row.legacy_metadata).toEqual({});
    expect(await related(f.group)).toEqual(before);
    const audit=await client.query("SELECT actor_id,details FROM everrate.audit_events WHERE action='identity-correction.plan' AND resource_id=$1",[f.plan.planId]);
    expect(audit.rows).toHaveLength(1);expect(audit.rows[0].actor_id).toBeNull();expect(audit.rows[0].details.planSha256).toBe(identityPlanSha256(f.plan));
    expect(await applyIdentityCorrections(client,f.plan,{apply:true})).toMatchObject({alreadyApplied:true,updates:0,forks:0,moves:0});
    await expect(applyIdentityCorrections(client,{...f.plan,evidence:'Changed plan'}, {apply:true})).rejects.toThrow();
  });
  it('rejects stale item and rating snapshots before any fork or metadata update',async()=>{
    for(const change of ['item','rating']){
      const f=await fixture();
      if(change==='item')await client.query('UPDATE everrate.items SET name=$2 WHERE id=$1',[f.item,'Concurrent correction']);
      else await client.query('UPDATE everrate.ratings SET note=$2 WHERE id=$1',[f.ratings[0],'Concurrent note']);
      await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow();
      expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[f.fork])).rowCount).toBe(0);
      expect((await client.query('SELECT brand_id FROM everrate.items WHERE id=$1',[f.item])).rows[0].brand_id).toBeNull();
    }
  });
  it('checks actual photo bytes as well as the stored digest',async()=>{
    const f=await fixture();await client.query('UPDATE everrate.photos SET data=$2 WHERE id=$1',[f.photos[0],Buffer.from('changed without updating stored digest')]);
    await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow();
    expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[f.fork])).rowCount).toBe(0);
  });
  it('rejects cross-group destinations and preexisting fork UUIDs',async()=>{
    const f=await fixture(),other=await fixture();
    const cross=structuredClone(f.plan);cross.moves[0].toItemId=other.item;cross.items.push(other.plan.items.find(row=>row.id===other.item)!);
    await expect(applyIdentityCorrections(client,cross,{apply:true})).rejects.toThrow();
    await client.query('INSERT INTO everrate.items(id,group_id,name,identity_key,created_by) VALUES($1,$2,$3,$4,$5)',[f.fork,f.group,'Already present','existing',f.user]);
    await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow();
    expect((await client.query('SELECT name FROM everrate.items WHERE id=$1',[f.item])).rows[0].name).toBe('Monster Mixed');
  });
  it('serializes concurrent copies of the same plan into one apply and one no-op',async()=>{
    const f=await fixture(),second=await pool.connect();
    try{
      const results=await Promise.all([applyIdentityCorrections(client,f.plan,{apply:true}),applyIdentityCorrections(second,f.plan,{apply:true})]);
      expect(results.filter(result=>result.applied)).toHaveLength(1);
      expect(results.filter(result=>result.alreadyApplied)).toHaveLength(1);
      expect((await client.query("SELECT id FROM everrate.audit_events WHERE action='identity-correction.plan' AND resource_id=$1",[f.plan.planId])).rowCount).toBe(1);
    }finally{second.release();}
  });
  it('rejects an existing caller transaction even when warnings are suppressed and leaves it untouched',async()=>{
    const f=await fixture();await client.query('BEGIN');
    try{
      await client.query("SET LOCAL client_min_messages='error'");
      await client.query('UPDATE everrate.items SET name=$2 WHERE id=$1',[f.destination,'Uncommitted caller edit']);
      await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow('dedicated idle client');
      expect((await client.query('SELECT name FROM everrate.items WHERE id=$1',[f.destination])).rows[0].name).toBe('Uncommitted caller edit');
    }finally{await client.query('ROLLBACK');}
    expect((await client.query('SELECT name FROM everrate.items WHERE id=$1',[f.destination])).rows[0].name).toBe('Lando Norris');
  });
  it('rejects a one-microsecond timestamp change and a wrong stored photo digest',async()=>{
    for(const change of ['timestamp','digest']){
      const f=await fixture();
      if(change==='timestamp')await client.query("UPDATE everrate.ratings SET tasted_at=tasted_at+interval '1 microsecond' WHERE id=$1",[f.ratings[0]]);
      else await client.query('UPDATE everrate.photos SET sha256=$2 WHERE id=$1',[f.photos[0],'0'.repeat(64)]);
      await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow();
      expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[f.fork])).rowCount).toBe(0);
    }
  });
  it('updates a cover photo only with explicit same-group byte evidence and preserves other item fields',async()=>{
    const f=await fixture(),old=f.snapshots.items.find(row=>row.id===f.item)!;
    const cover={...f.plan,updates:[{itemId:f.item,photoId:f.photos[1]}],forks:[],moves:[]};
    const missing={...cover,photos:[]};
    await expect(applyIdentityCorrections(client,missing,{apply:true})).rejects.toThrow();
    const other=await fixture(),cross={...cover,updates:[{itemId:f.item,photoId:other.photos[0]}],photos:[...cover.photos,other.plan.photos.find(row=>row.id===other.photos[0])!]};
    await expect(applyIdentityCorrections(client,cross,{apply:true})).rejects.toThrow();
    expect(await applyIdentityCorrections(client,cover,{apply:true})).toMatchObject({applied:true,updates:1});
    const current=(await captureIdentitySnapshots(client,{itemIds:[f.item]})).items[0];
    expect(current.snapshot.row.legacy_photo_id).toBe(f.photos[1]);
    expect({...current.snapshot.row,legacy_photo_id:old.snapshot.row.legacy_photo_id}).toEqual(old.snapshot.row);
    const clear={...cover,planId:randomUUID(),items:[{id:f.item,expectedSha256:current.sha256}],photos:[],updates:[{itemId:f.item,photoId:null}]};
    await applyIdentityCorrections(client,clear,{apply:true});
    expect((await client.query('SELECT legacy_photo_id FROM everrate.items WHERE id=$1',[f.item])).rows[0].legacy_photo_id).toBeNull();
  });
  it('rejects a new tasting or changed remaining tasting after the item was reviewed',async()=>{
    for(const change of ['new','remaining']){
      const f=await fixture();
      if(change==='new')await client.query("INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id,source) VALUES($1,$2,$3,5,$4,'app')",[f.group,f.item,f.user,f.photos[1]]);
      else await client.query('UPDATE everrate.ratings SET photo_id=$2 WHERE id=$1',[f.ratings[1],f.photos[0]]);
      await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow('snapshot changed');
      expect((await client.query('SELECT name FROM everrate.items WHERE id=$1',[f.item])).rows[0].name).toBe('Monster Mixed');
    }
  });
  it('rolls back unexpected trigger changes to item provenance',async()=>{
    const f=await fixture();
    await client.query("CREATE FUNCTION everrate.fixture_change_provenance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.legacy_metadata='{}'::jsonb; RETURN NEW; END $$");
    await client.query('CREATE TRIGGER fixture_item_provenance BEFORE UPDATE ON everrate.items FOR EACH ROW EXECUTE FUNCTION everrate.fixture_change_provenance()');
    try{await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow('outside the reviewed correction');}
    finally{await client.query('DROP TRIGGER fixture_item_provenance ON everrate.items');await client.query('DROP FUNCTION everrate.fixture_change_provenance()');}
    expect((await captureIdentitySnapshots(client,{itemIds:[f.item]})).items[0].sha256).toBe(f.snapshots.items.find(row=>row.id===f.item)!.sha256);
  });
  it('rolls back the entire plan on a later SQL failure',async()=>{
    const f=await fixture();
    await client.query(`CREATE FUNCTION everrate.fixture_reject_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.ratings[2]}'::uuid THEN RAISE EXCEPTION 'fixture refusal'; END IF; RETURN NEW; END $$`);
    await client.query('CREATE TRIGGER fixture_move_failure BEFORE UPDATE ON everrate.ratings FOR EACH ROW EXECUTE FUNCTION everrate.fixture_reject_move()');
    try{await expect(applyIdentityCorrections(client,f.plan,{apply:true})).rejects.toThrow();}finally{await client.query('DROP TRIGGER fixture_move_failure ON everrate.ratings');await client.query('DROP FUNCTION everrate.fixture_reject_move()');}
    expect((await client.query('SELECT name FROM everrate.items WHERE id=$1',[f.item])).rows[0].name).toBe('Monster Mixed');
    expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[f.fork])).rowCount).toBe(0);
    expect((await client.query('SELECT item_id FROM everrate.ratings WHERE id=$1',[f.ratings[0]])).rows[0].item_id).toBe(f.item);
  });
});
