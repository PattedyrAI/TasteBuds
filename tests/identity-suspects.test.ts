import {describe, expect, it} from 'vitest';
import {identitySuspectFlags, IDENTITY_CONFIDENCE_THRESHOLD} from '../src/domain/identity-suspects';
import {assertIdentitySuspectsTarget, parseIdentityAnalysis, confidentIdentityPatch} from '../scripts/report-identity-suspects';
import type {PhotoIdentity} from '../scripts/analyze-photo-identities';

const item=(name:string, brand:string|null=null, type:string|null=null)=>({name,brand,type});
const photo=(patch:Partial<PhotoIdentity>={}):PhotoIdentity=>({visibleText:[],brand:'Monster',name:'Ultra White',variant:null,type:'Energy drinks',brandConfidence:.99,nameConfidence:.99,variantConfidence:.99,typeConfidence:.99,multipleProducts:false,ambiguity:null,...patch});
const codes=(name:string)=>identitySuspectFlags(item(name)).map(flag=>flag.code);

describe('identity suspect heuristics',()=>{
  it.each(['Lena','Yuvy','Bob'])('flags non-product identity %s',name=>expect(codes(name)).toContain('non_product_token'));
  it.each(['Pho','Taco','Ramen','Kvikk Lunsj','Monster Ultra White','Pepsi Max'])('does not suspect known product %s',name=>expect(identitySuspectFlags(item(name))).toEqual([]));
  it('does not treat real person-named brands/products as high severity',()=>{
    for(const value of [item('Ben',"Ben & Jerry's"),item('Dr Pepper'),item('Bob','Acme')])expect(identitySuspectFlags(value).some(flag=>flag.severity==='high')).toBe(false);
  });
  it('uses exact normalized member collisions, not substring matches',()=>{
    expect(identitySuspectFlags(item('  NOVA '),{memberNames:['Nova']})).toContainEqual({code:'member_name_collision',severity:'high'});
    expect(identitySuspectFlags(item('Nova Cola'),{memberNames:['Nova']})).toEqual([]);
  });
  it('exempts a declared type label without treating arbitrary unknown words as food',()=>{
    expect(identitySuspectFlags(item('Wine'),{knownTypeNames:['Wine']})).toEqual([]);
    expect(identitySuspectFlags(item('Yuvy'),{knownTypeNames:['Wine']})).toContainEqual({code:'non_product_token',severity:'medium'});
  });
  it('makes the incomplete energy-brand dictionary a medium review signal',()=>{
    expect(identitySuspectFlags(item('Ultra','Acme','Energy drinks'))).toContainEqual({code:'energy_brand_unrecognized',severity:'medium'});
    expect(identitySuspectFlags(item('Ultra White','monster','energy drink'))).toEqual([]);
    expect(identitySuspectFlags(item('Monster Ultra White',null,'Energy drinks'))).toEqual([]);
  });
  it('flags confident missing brands and name disagreement',()=>{
    expect(identitySuspectFlags(item('Lena'),{analysis:photo()})).toEqual(expect.arrayContaining([{code:'photo_brand_missing',severity:'high'},{code:'photo_name_disagreement',severity:'high'}]));
    expect(identitySuspectFlags(item('Monster Ultra White',null,'Energy drinks'),{analysis:photo()})).toEqual([{code:'photo_brand_missing',severity:'high'}]);
  });
  it('compares exact canonical brands without merging different brands',()=>{
    expect(identitySuspectFlags(item('Red-Bull Original','Red-Bull','Energy drinks'),{analysis:photo({brand:'Red Bull',name:'Original'})})).toEqual([]);
    expect(identitySuspectFlags(item('Ultra White','Monster','Energy drinks'),{analysis:photo({brand:'Pepsi'})})).toContainEqual({code:'photo_brand_disagreement',severity:'high'});
    expect(identitySuspectFlags(item('Pepsi Max','Pepsi','Soft drinks'),{analysis:photo({brand:'Pepsi',name:'Max',type:'Soft drinks'})})).toEqual([]);
  });
  it('requires independent confidence and no ambiguity for photo disagreement',()=>{
    expect(IDENTITY_CONFIDENCE_THRESHOLD).toBe(.9);
    for(const patch of [{nameConfidence:.899,brandConfidence:.899},{multipleProducts:true},{ambiguity:'Unreadable label'}])expect(identitySuspectFlags(item('Normal Product','Other'),{analysis:photo(patch)})).toEqual([]);
    expect(identitySuspectFlags(item('Normal Product','Other'),{analysis:photo({nameConfidence:.9,brandConfidence:.9})}).filter(flag=>flag.code.startsWith('photo_'))).toHaveLength(2);
    expect(identitySuspectFlags(item('Normal Product','Other'),{analysis:photo({nameConfidence:.4})})).toContainEqual({code:'photo_brand_disagreement',severity:'high'});
  });
});

describe('read-only report guards and draft eligibility',()=>{
  it('refuses remote URLs without an explicit flag and rejects host override options',()=>{
    expect(()=>assertIdentitySuspectsTarget('postgresql://remote/db')).toThrow();
    expect(()=>assertIdentitySuspectsTarget('postgresql://remote/db',true)).not.toThrow();
    for(const url of ['postgresql://127.0.0.1/db?host=remote','file:///tmp/db','postgresql:///db'])expect(()=>assertIdentitySuspectsTarget(url,true)).toThrow();
  });
  it('reads actual proposals_only format and normalizes photo identity',()=>{
    const id='11111111-1111-4111-8111-111111111111';
    const parsed=parseIdentityAnalysis({status:'proposals_only',version:'photo-identity-v1',items:[{itemId:id,evidence:[{itemId:id,photoHash:'a'.repeat(64),photoIds:[id],identity:photo({name:'Monster Ultra White'})}]}]});
    expect(parsed.get(id)?.[0].identity?.name).toBe('Ultra White');
    expect(()=>parseIdentityAnalysis({items:[]})).toThrow();
    expect(()=>parseIdentityAnalysis({status:'proposals_only',version:'photo-identity-v1',items:[{itemId:id,evidence:[{itemId:id,photoHash:'bad',identity:photo()}]}]})).toThrow();
  });
  it('never proposes low-confidence, ambiguous or cross-photo conflicting identities',()=>{
    for(const evidence of [[photo({nameConfidence:.89})],[photo({brandConfidence:.89})],[photo({multipleProducts:true})],[photo({ambiguity:'unclear'})],[null],[photo(),photo({brand:'Pepsi'})],[photo(),photo({variant:'Lemon'})]])expect(confidentIdentityPatch(item('Lena'),evidence)).toBeNull();
    expect(confidentIdentityPatch(item('Lena'),[photo()])).toEqual({name:'Ultra White',brand:'Monster'});
  });
  it('preserves unknown brand/variant/type rather than fabricating removal',()=>{
    expect(confidentIdentityPatch(item('Lena','Old Brand'),[photo({brand:null,brandConfidence:0,variant:null,variantConfidence:0})])).toEqual({name:'Ultra White'});
    expect(confidentIdentityPatch(item('Ultra White','Monster'),[photo()])).toBeNull();
  });
  it('removes the old brand from the title when proposing a different brand',()=>{
    expect(confidentIdentityPatch(item('Monster Ultra White','Monster','Energy drinks'),[photo({brand:'Pepsi'})])).toEqual({name:'Ultra White',brand:'Pepsi'});
  });
});

// Opt-in fixture integration: never fall back to app/production credentials.
import {afterAll,beforeAll} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {reportIdentitySuspects} from '../scripts/report-identity-suspects';
import {applyIdentityCorrections} from '../scripts/apply-identity-corrections';
const fixtureUrl=process.env.IDENTITY_SUSPECTS_TEST_DATABASE_URL;
describe.skipIf(!fixtureUrl)('disposable identity suspect report',()=>{
  let pool:Pool,client:PoolClient;
  const group='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
  const photoId='33333333-3333-4333-8333-333333333333',bytes=Buffer.from('local synthetic photo bytes'),hash=createHash('sha256').update(bytes).digest('hex');
  const fixtureNames=['Lena','Yuvy','Pho','Taco','Ramen','Kvikk Lunsj','Monster Ultra White','Pepsi Max','Nova','Bob'];
  const ids=fixtureNames.map((_,i)=>`44444444-4444-4444-8444-${String(i+1).padStart(12,'0')}`);
  const analysis=()=>parseIdentityAnalysis({status:'proposals_only',version:'photo-identity-v1',items:[{itemId:ids[0],evidence:[{itemId:ids[0],photoHash:hash,photoIds:[photoId],identity:photo()}]}]});
  beforeAll(async()=>{
    assertIdentitySuspectsTarget(fixtureUrl!);
    const target=new URL(fixtureUrl!);
    if(target.hostname!=='127.0.0.1'||target.port!=='55440'||!/^\/everrate_suspects_test(?:_[a-z0-9]+)?$/.test(target.pathname))throw new Error('Only the explicitly disposable fixture DB is allowed');
    pool=new Pool({connectionString:fixtureUrl,max:1});client=await pool.connect();
    expect((await client.query('SELECT id FROM everrate.items')).rows).toEqual([]);
    await client.query('INSERT INTO everrate.users(id,display_name,nickname) VALUES($1,$2,$3)',[user,'Private display name','Nova']);
    await client.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Synthetic fixture group',user,'suspects-fixture']);
    await client.query("INSERT INTO everrate.memberships(group_id,user_id,role) VALUES($1,$2,'owner')",[group,user]);
    await client.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',1,1)",[photoId,group,user,bytes,hash]);
    for(let i=0;i<ids.length;i++)await client.query('INSERT INTO everrate.items(id,group_id,name,identity_key,created_by,legacy_photo_id) VALUES($1,$2,$3,$4,$5,$6)',[ids[i],group,fixtureNames[i],fixtureNames[i].toLowerCase(),user,i===0?photoId:null]);
  });
  afterAll(async()=>{client?.release();await pool?.end();});
  async function values(){
    const result:Record<string,unknown>={};
    for(const table of ['items','users','groups','memberships','photos','ratings','audit_events','discord_outbox'])result[table]=(await client.query(`SELECT to_jsonb(t) value FROM everrate.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    return result;
  }
  it('inventories every item, detects fixture identities and leaves actual values unchanged',async()=>{
    const before=await values(),report=await reportIdentitySuspects(client);
    expect(report.summary.items).toBe(10);expect(report.summary.suspects).toBe(4);
    expect(report.rows.filter(row=>row.flags.length).map(row=>row.name)).toEqual(['Lena','Yuvy','Nova','Bob']);
    expect(report.summary.reasonCounts).toEqual({first_name_token:2,non_product_token:4,member_name_collision:1});
    expect(report.plans).toEqual([]);expect(await values()).toEqual(before);
  });
  it('drafts only linked confident evidence, validates applicator guards and remains read-only',async()=>{
    const before=await values(),report=await reportIdentitySuspects(client,analysis());
    expect(report.plans).toHaveLength(1);expect(report.plans[0].updates).toEqual([{itemId:ids[0],set:{name:'Ultra White',brand:'Monster'}}]);
    expect(report.plans[0].photos).toEqual([{id:photoId,expectedSha256:hash}]);
    expect(await applyIdentityCorrections(client,report.plans[0])).toMatchObject({applied:false,updates:1});
    expect(await values()).toEqual(before);
    await mkdir('.private/identity-suspects-fixture',{recursive:true,mode:0o700});
    await writeFile('.private/identity-suspects-fixture/proposals.json',JSON.stringify({status:'proposals_only',version:'photo-identity-v1',items:[{itemId:ids[0],evidence:analysis().get(ids[0])}]}),{mode:0o600});
  });
  it('refuses caller transactions without consuming the caller transaction',async()=>{
    await client.query('BEGIN');
    try{await expect(reportIdentitySuspects(client)).rejects.toThrow('dedicated idle');expect((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('read committed');}
    finally{await client.query('ROLLBACK');}
  });
  it('retains stale/unlinked evidence as flagged review rows rather than drafting',async()=>{
    const supplied=analysis();supplied.get(ids[0])![0].photoIds=[user];
    const report=await reportIdentitySuspects(client,supplied);
    expect(report.plans).toEqual([]);expect(report.rows[0].flags.map(flag=>flag.code)).toContain('photo_evidence_unverified');
  });
  it('checks actual pixels rather than trusting the stored photo hash',async()=>{
    await client.query('UPDATE everrate.photos SET data=$2 WHERE id=$1',[photoId,Buffer.from('different pixels')]);
    try{const report=await reportIdentitySuspects(client,analysis());expect(report.plans).toEqual([]);expect(report.rows[0].flags.map(flag=>flag.code)).toContain('photo_evidence_unverified');}
    finally{await client.query('UPDATE everrate.photos SET data=$2 WHERE id=$1',[photoId,bytes]);}
  });
  it('uses a repeatable-read, read-only transaction on the real connection',async()=>{
    const query=client.query.bind(client),observed:string[]=[];
    client.query=(async(...args:Parameters<typeof query>)=>{
      const sql=String(args[0]);
      if(sql.startsWith('SELECT i.id')){
        observed.push((await query('SHOW transaction_isolation')).rows[0].transaction_isolation);
        observed.push((await query('SHOW transaction_read_only')).rows[0].transaction_read_only);
      }
      return query(...args);
    }) as typeof client.query;
    try{await reportIdentitySuspects(client);expect(observed).toEqual(['repeatable read','on']);}finally{client.query=query;}
  });
});
