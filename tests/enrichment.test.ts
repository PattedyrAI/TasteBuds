import {afterAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {chooseMetadataPatch,runEnrichment,requestEnrichment,retryDelayMilliseconds,deterministicType,replayEnrichment,type EnrichmentItem} from '../scripts/enrich-items';
const item:EnrichmentItem={id:randomUUID(),groupId:randomUUID(),name:'Unclassified Alpha Edition',brand:null,variant:null,type:null,photoId:null,photoHash:null,artifact:false,ratingCount:1,manualEdit:false};
const suggestion={name:'Unclassified Alpha Edition',brand:'Alpha',variant:'Edition',type:'Energy drinks',broadCategory:'Food & Drink',confidence:.98};
describe('conservative enrichment decisions',()=>{
  it('fills specific types and literal brand/variant without renaming',()=>expect(chooseMetadataPatch(item,suggestion)).toEqual({brand:'Alpha',variant:'Edition',type:'Energy drinks'}));
  it('preserves existing fields and rejects unknown brands and low confidence',()=>{
    expect(chooseMetadataPatch({...item,brand:'Existing',type:'Soda',variant:'Original'},suggestion)).toEqual({});
    expect(chooseMetadataPatch({...item,name:'Uncertain product'},{...suggestion,confidence:.5})).toEqual({});
    expect(chooseMetadataPatch({...item,name:'Lemonade'},{...suggestion,brand:'Invented',variant:'Mystery',type:'Drink'})).toEqual({});
  });
  it('does not infer from artifact names or attach one-photo identity to multiple historical ratings',()=>{
    expect(chooseMetadataPatch({...item,artifact:true},suggestion)).toEqual({});
    expect(chooseMetadataPatch({...item,name:'Pizza',photoId:randomUUID(),ratingCount:3},{...suggestion,brand:'Pizza brand',variant:'Deluxe',type:'Pizza'})).toEqual({type:'Pizza'});
    expect(chooseMetadataPatch({...item,manualEdit:true},suggestion)).toEqual({});
  });
});
describe('type confidence independent of brand certainty',()=>{
  it('categorizes a dish even when restaurant and brand confidence are zero',()=>{
    expect(chooseMetadataPatch({...item,name:'Penne arrabbiata'}, {...suggestion,name:'Penne arrabbiata',brand:null,variant:null,type:'Pasta',confidence:.1,typeConfidence:.99,brandConfidence:0,variantConfidence:0})).toEqual({type:'Pasta'});
  });
  it('uses safe named drink and dish evidence without confusing Monster food products',()=>{
    for(const name of ['Red Bull Juneberry','Monster Ultra White','Monster Mango Loco'])expect(deterministicType({...item,name})).toBe('Energy drinks');
    expect(deterministicType({...item,name:'Monster cookies'})).toBeNull();
    expect(deterministicType({...item,name:'Monster Hard Beast'})).toBeNull();
    expect(deterministicType({...item,name:'Burger Cake'})).toBeNull();
    expect(deterministicType({...item,name:'Burger King Fries'})).toBeNull();
    expect(deterministicType({...item,name:'Mac and Cheese Stuffed Pretzel'})).toBeNull();
  });
});
describe('bounded Gemini response handling with mocked HTTP',()=>{
  it('parses bounded retry headers and Google retry details',()=>{
    const now=Date.parse('2026-09-15T12:00:00Z');
    expect(retryDelayMilliseconds({})).toBe(15000);
    expect(retryDelayMilliseconds({retryAfter:'32'})).toBe(32000);
    expect(retryDelayMilliseconds({retryAfter:'Tue, 15 Sep 2026 12:00:22 GMT',now})).toBe(22000);
    expect(retryDelayMilliseconds({body:{error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'23.5s'}]}}})).toBe(23500);
    expect(retryDelayMilliseconds({retryAfter:'10',body:{error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:{seconds:'20',nanos:500000000}}]}}})).toBe(20500);
    expect(retryDelayMilliseconds({retryAfter:'9999'})).toBe(60000);
    expect(retryDelayMilliseconds({retryAfter:'invalid',body:{error:{details:'wrong'}}})).toBe(15000);
  });
  it('waits for a quota hint before retrying and stops immediately on another client error',async()=>{
    const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='fake-enrichment-only';vi.useFakeTimers();
    const value={...suggestion,typeConfidence:1,brandConfidence:1,variantConfidence:1};
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'25s'}]}},{status:429})).mockResolvedValueOnce(Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]}));vi.stubGlobal('fetch',fetcher);
    try{
      const pending=requestEnrichment({itemName:'Fixture',model:'gemini-3.1-flash-lite'});
      await vi.advanceTimersByTimeAsync(24999);expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);expect((await pending).providerCalls).toBe(2);
      fetcher.mockReset().mockResolvedValue(Response.json({error:{message:'private'}},{status:400}));
      await expect(requestEnrichment({itemName:'Fixture',model:'gemini-3.1-flash-lite'})).rejects.toMatchObject({failureClass:'provider_400',calls:1});
      expect(fetcher).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();vi.unstubAllGlobals();if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;}
  });
  it('requests separate field confidence and includes established metadata context',async()=>{
    const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='fake-enrichment-only';
    const result={...suggestion,confidence:.1,typeConfidence:.99,brandConfidence:0,variantConfidence:0,brand:null,variant:null};
    const fetcher=vi.fn(async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}}));vi.stubGlobal('fetch',fetcher);
    try{
      const actual=await requestEnrichment({itemName:'Penne arrabbiata',existingBrand:null,existingType:'Pasta',broadCategory:'Food & Drink',model:'gemini-3.1-flash-lite'});
      expect(actual.suggestion).toMatchObject({typeConfidence:.99,brandConfidence:0,confidence:.1});
      const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
      expect(body.generationConfig.responseJsonSchema.required).toContain('typeConfidence');
      expect(body.contents[0].parts[0].text).toContain('"type":"Pasta"');
      expect(body.contents[0].parts[0].text).toContain('Unknown brand or restaurant must not reduce typeConfidence');
    }finally{vi.unstubAllGlobals();if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;}
  });
  it('retains billed usage on a malformed structured response',async()=>{
    const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='fake-enrichment-only';
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({candidates:[{content:{parts:[{text:'not json'}]}}],usageMetadata:{promptTokenCount:99,candidatesTokenCount:12,thoughtsTokenCount:4}})));
    try{await expect(requestEnrichment({itemName:'Tea',model:'gemini-3.1-flash-lite'})).rejects.toMatchObject({failureClass:'invalid_response',calls:1,inputTokens:99,outputTokens:16});}
    finally{vi.unstubAllGlobals();if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;}
  });
});
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local _test database required');
describe.skipIf(!url)('resumable local enrichment with a fake provider',()=>{
  const db=new Pool({connectionString:url}),ids={user:randomUUID(),group:randomUUID(),item:randomUUID()};
  afterAll(async()=>{await db.end();});
  it('dry-run makes zero calls, apply records evidence and rerun avoids duplicate calls',async()=>{
    await db.query('INSERT INTO everrate.users(id,display_name) VALUES($1,$2)',[ids.user,'Enrichment fixture']);
    await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[ids.group,'Enrichment fixture',ids.user,randomUUID()]);
    await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[ids.item,ids.group,item.name,ids.user,'legacy',JSON.stringify({id:ids.item})]);
    const provider=vi.fn(async()=>({suggestion,rawSuggestion:suggestion,inputTokens:123,outputTokens:45,providerCalls:1}));
    const dry=await runEnrichment({connectionString:url!,groupId:ids.group,provider});expect(dry.applied).toBe(false);expect(provider).not.toHaveBeenCalled();
    const first=await runEnrichment({connectionString:url!,groupId:ids.group,provider,apply:true});expect(first.updated).toBe(1);expect(provider).toHaveBeenCalledTimes(1);
    const current=await db.query('SELECT i.name,i.variant,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=$1',[ids.item]);
    expect(current.rows[0]).toEqual({name:item.name,brand:'Alpha',variant:'Edition',type:'Energy drinks'});
    const record=await db.query("SELECT raw_record FROM everrate.archive_proposals WHERE record_key=$1 AND source_file='gemini-item-enrichment:v2'",[ids.item]);
    expect(record.rows[0].raw_record).toMatchObject({jobKind:'bulk_item_metadata',usage:{inputTokens:123,outputTokens:45},suggestion});
    await runEnrichment({connectionString:url!,groupId:ids.group,provider,apply:true});expect(provider).toHaveBeenCalledTimes(1);
    expect((await db.query('SELECT count(*)::int n FROM everrate.recognition_jobs WHERE group_id=$1',[ids.group])).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM everrate.discord_outbox WHERE group_id=$1',[ids.group])).rows[0].n).toBe(0);
  });
  it('resumes unprocessed work and retries a failed attempt only when explicitly requested',async()=>{
    const failedId=randomUUID();
    await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[failedId,ids.group,'Coffee',ids.user,'legacy',JSON.stringify({id:failedId})]);
    const failing=vi.fn(async()=>{throw new Error('offline');});
    expect((await runEnrichment({connectionString:url!,groupId:ids.group,provider:failing,apply:true})).failed).toBe(1);
    const succeeding=vi.fn(async()=>({suggestion:{...suggestion,name:'Coffee',brand:null,variant:null,type:'Coffee'},rawSuggestion:{type:'Coffee'},inputTokens:10,outputTokens:10,providerCalls:1}));
    await runEnrichment({connectionString:url!,groupId:ids.group,provider:succeeding,apply:true});expect(succeeding).not.toHaveBeenCalled();
    expect((await runEnrichment({connectionString:url!,groupId:ids.group,provider:succeeding,apply:true,retryFailed:true})).updated).toBe(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it('types-only preserves brand fields and permits later full metadata enrichment',async()=>{
    const group=randomUUID(),id=randomUUID();
    await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Modes fixture',ids.user,randomUUID()]);
    await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,group,item.name,ids.user,'legacy',JSON.stringify({id})]);
    const provider=vi.fn(async(_input:unknown)=>({suggestion:{...suggestion,confidence:.1,typeConfidence:.99,brandConfidence:.99,variantConfidence:.99},rawSuggestion:suggestion,inputTokens:1,outputTokens:1,providerCalls:1}));
    const first=await runEnrichment({connectionString:url!,groupId:group,provider,apply:true,typesOnly:true});
    expect(first.fieldsFilled).toEqual({brand:0,variant:0,type:1});
    expect((await db.query('SELECT brand_id,variant FROM everrate.items WHERE id=$1',[id])).rows[0]).toEqual({brand_id:null,variant:null});
    await runEnrichment({connectionString:url!,groupId:group,provider,apply:true});
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0]).toMatchObject({existingType:'Energy drinks',existingBrand:null});
  });
  it('deterministic named drinks require no provider calls, including flagged literal names',async()=>{
    const group=randomUUID(),id=randomUUID();
    await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Rules fixture',ids.user,randomUUID()]);
    await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,group,'Red Bull Juneberry',ids.user,'legacy',JSON.stringify({id})]);
    const provider=vi.fn(async()=>{throw new Error('Provider should not be called');});
    const report=await runEnrichment({connectionString:url!,groupId:group,provider,apply:true,typesOnly:true});
    expect(report.fieldsFilled.type).toBe(1);expect(report.providerCalls).toBe(0);expect(provider).not.toHaveBeenCalled();
    expect(deterministicType({...item,name:'Red Bull Juneberry',artifact:true})).toBe('Energy drinks');
    expect(deterministicType({...item,name:'Deleted entry',artifact:true})).toBeNull();
  });
  it('advances a limited batch beyond archived uncertain rows',async()=>{
    const group=randomUUID();await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Batch fixture',ids.user,randomUUID()]);
    for(let n=0;n<3;n++){const id=randomUUID();await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,group,'Uncertain '+n,ids.user,'legacy',JSON.stringify({id})]);}
    const provider=vi.fn(async()=>({suggestion:{...suggestion,confidence:0,brand:null,variant:null,type:null},rawSuggestion:{},inputTokens:1,outputTokens:1,providerCalls:1}));
    for(let n=0;n<3;n++)expect((await runEnrichment({connectionString:url!,groupId:group,provider,typesOnly:true,apply:true,limit:1})).completed).toBe(1);
    expect(provider).toHaveBeenCalledTimes(3);
  });
  it('limits concurrent provider calls to three',async()=>{
    for(let n=0;n<4;n++){const id=randomUUID();await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,ids.group,'Tea '+n,ids.user,'legacy',JSON.stringify({id})]);}
    let active=0,peak=0;
    const provider=vi.fn(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return {suggestion:{...suggestion,brand:null,variant:null,type:'Tea'},rawSuggestion:{type:'Tea'},inputTokens:1,outputTokens:1,providerCalls:1};});
    const report=await runEnrichment({connectionString:url!,groupId:ids.group,provider,apply:true,concurrency:3});
    expect(report.updated).toBe(4);expect(peak).toBe(3);
    await expect(runEnrichment({connectionString:url!,concurrency:4,provider})).rejects.toThrow();
    await expect(runEnrichment({connectionString:url!,limit:341,provider})).rejects.toThrow();
  });
  it('does not apply a response if the item name changes while the provider is working',async()=>{
    const id=randomUUID();await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[id,ids.group,'Original tea',ids.user,'legacy',JSON.stringify({id})]);
    const provider=vi.fn(async()=>{await db.query('UPDATE everrate.items SET name=$2 WHERE id=$1',[id,'User corrected name']);return {suggestion:{...suggestion,brand:null,variant:null,type:'Tea'},rawSuggestion:{type:'Tea'},inputTokens:1,outputTokens:1,providerCalls:1};});
    expect((await runEnrichment({connectionString:url!,groupId:ids.group,provider,apply:true})).reviewRequired).toBe(1);
    expect((await db.query('SELECT name,type_id FROM everrate.items WHERE id=$1',[id])).rows[0]).toEqual({name:'User corrected name',type_id:null});
  });

});

describe.skipIf(!url)('local archived metadata replay',()=>{
  it('replays verified missing fields, refuses changed identity, and never pays twice',async()=>{
    const source=new Pool({connectionString:url}),database=`everrate_replay_${randomUUID().replaceAll('-','')}_test`;
    const targetUrl=new URL(url!);targetUrl.pathname='/'+database;
    let target:Pool|undefined;
    try{
      await source.query(`CREATE DATABASE "${database}"`);await migrate(targetUrl.toString());
      target=new Pool({connectionString:targetUrl.toString()});
      const user=randomUUID(),group=randomUUID(),id=randomUUID(),other=randomUUID();
      for(const db of [source,target]){
        await db.query('INSERT INTO everrate.users(id,display_name) VALUES($1,$2)',[user,'Replay fixture']);
        await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Replay fixture',user,randomUUID()]);
        for(const itemId of [id,other])await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[itemId,group,item.name,user,'legacy',JSON.stringify({id:itemId})]);
      }
      const provider=vi.fn(async()=>({suggestion,rawSuggestion:suggestion,inputTokens:123,outputTokens:45,providerCalls:1}));
      await runEnrichment({connectionString:url!,groupId:group,provider,apply:true});
      await target.query('UPDATE everrate.items SET name=$2 WHERE id=$1',[other,'Manually corrected identity']);
      const options={sourceConnectionString:url!,targetConnectionString:targetUrl.toString(),groupId:group};
      vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Replay must not call provider');}));
      expect(await replayEnrichment(options)).toMatchObject({applied:false,eligible:1,conflicts:1,updated:0,providerCalls:0});
      await target.query("INSERT INTO everrate.audit_events(group_id,resource_id,action,details) VALUES($1,$2,'item.update','{}')",[group,id]);
      expect(await replayEnrichment(options)).toMatchObject({eligible:0,conflicts:2});
      await target.query("DELETE FROM everrate.audit_events WHERE resource_id=$1 AND action='item.update'",[id]);
      await source.query('UPDATE everrate.items SET variant=$2 WHERE id=$1',[id,'Changed after approval']);
      expect(await replayEnrichment(options)).toMatchObject({eligible:0,conflicts:2});
      await source.query('UPDATE everrate.items SET variant=$2 WHERE id=$1',[id,'Edition']);
      const flaggedIssue=randomUUID();
      const archivedSource=(await source.query('SELECT source_id FROM everrate.archive_proposals WHERE record_key=$1 LIMIT 1',[id])).rows[0].source_id;
      await source.query("INSERT INTO everrate.import_issues(id,source_id,source_record_id,reason,raw_record) VALUES($1,$2,$3,'legacy_item_requires_reconciliation','{}')",[flaggedIssue,archivedSource,'item:'+id]);
      expect(await replayEnrichment(options)).toMatchObject({eligible:0,conflicts:2});
      await source.query('DELETE FROM everrate.import_issues WHERE id=$1',[flaggedIssue]);
      const first=await replayEnrichment({...options,apply:true});expect(first).toMatchObject({updated:1,conflicts:1,providerCalls:0});
      expect((await target.query('SELECT i.name,i.variant,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=$1',[id])).rows[0]).toEqual({name:item.name,variant:'Edition',brand:'Alpha',type:'Energy drinks'});
      expect(await replayEnrichment({...options,apply:true})).toMatchObject({updated:0,alreadyReplayed:1});
      expect((await target.query("SELECT count(*)::int n FROM everrate.audit_events WHERE action='legacy.enrichment.replay'")).rows[0].n).toBe(1);
      expect((await target.query('SELECT count(*)::int n FROM everrate.recognition_jobs')).rows[0].n).toBe(0);
      expect((await target.query('SELECT count(*)::int n FROM everrate.discord_outbox')).rows[0].n).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      // An image-only brand cannot be copied after the target acquired an extra tasting.
      vi.unstubAllGlobals();
      const imageItem=randomUUID(),photo=randomUUID();
      for(const db of [source,target]){
        await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[imageItem,group,'Mystery beverage',user,'legacy',JSON.stringify({id:imageItem})]);
        await db.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',1,1)",[photo,group,user,Buffer.from('fixture'),'a'.repeat(64)]);
        await db.query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id) VALUES($1,$2,$3,7,$4)',[group,imageItem,user,photo]);
      }
      const photoProvider=vi.fn(async()=>({suggestion:{...suggestion,name:'Mystery beverage',brand:'Visible Brand',variant:null},rawSuggestion:{},inputTokens:1,outputTokens:1,providerCalls:1}));
      await runEnrichment({connectionString:url!,groupId:group,provider:photoProvider,apply:true});
      await target.query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id) VALUES($1,$2,$3,8,$4)',[group,imageItem,user,photo]);
      expect(await replayEnrichment({...options,apply:true})).toMatchObject({updated:0,conflicts:2});
      expect((await target.query('SELECT brand_id FROM everrate.items WHERE id=$1',[imageItem])).rows[0].brand_id).toBeNull();
      await expect(replayEnrichment({...options,targetConnectionString:'postgresql://example.com/everrate'})).rejects.toThrow();
    }finally{vi.unstubAllGlobals();await target?.end();await source.query(`DROP DATABASE IF EXISTS "${database}"`);await source.end();}
  });
});
