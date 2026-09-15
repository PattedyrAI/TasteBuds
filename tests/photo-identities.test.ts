import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {analyzeCachedPhoto,buildPhotoEvidence,groupPhotoEvidence,requestPhotoIdentity,normalizePhotoIdentity,runPhotoIdentityAnalysis,revalidateCachedPhotoRecord,type PhotoIdentity} from '../scripts/analyze-photo-identities';
const identity:PhotoIdentity={visibleText:['MONSTER','ULTRA WHITE'],brand:'Monster',name:'Ultra White',variant:null,type:'Energy drinks',typeConfidence:.99,brandConfidence:.99,nameConfidence:.98,variantConfidence:0,multipleProducts:false,ambiguity:null};
const photo={sha256:createHash('sha256').update('test').digest('hex'),data:Buffer.from('test'),mimeType:'image/jpeg',model:'gemini-3.1-flash-lite'};
describe('image-only identity proposals',()=>{
  it('accepts long OCR entries within a bounded combined text budget',()=>{
    const text='Ingredients and nutrition information. '.repeat(50);
    expect(normalizePhotoIdentity({...identity,visibleText:[text]}).visibleText).toEqual([text]);
    expect(()=>normalizePhotoIdentity({...identity,visibleText:['a'.repeat(8001),'b'.repeat(8000)]})).toThrow();
    expect(()=>normalizePhotoIdentity({...identity,visibleText:Array(81).fill('text')})).toThrow();
  });
  it('revalidates cached OCR failures purely while retaining original usage and history',()=>{
    const original={version:'photo-identity-v1',photoHash:photo.sha256,model:photo.model,status:'failed' as const,startedAt:'2026-09-15T12:00:00Z',completedAt:'2026-09-15T12:00:10Z',failureClass:'invalid_response',rawSuggestion:{...identity,visibleText:['Nutrition. '.repeat(200)]},usage:{inputTokens:120,outputTokens:200,providerCalls:1}};
    const snapshot=structuredClone(original),result=revalidateCachedPhotoRecord(original);
    expect(result).toMatchObject({status:'completed',identity:{visibleText:original.rawSuggestion.visibleText},usage:original.usage,revalidation:{kind:'schema_revalidation',providerCalls:0},previousAttempts:[original]});
    expect(result.failureClass).toBeUndefined();expect(original).toEqual(snapshot);
    expect(revalidateCachedPhotoRecord(result)).toBe(result);
    expect(()=>revalidateCachedPhotoRecord({...original,failureClass:'provider_429'})).toThrow();
    expect(()=>revalidateCachedPhotoRecord({...original,rawSuggestion:{...identity,visibleText:['a'.repeat(16001)]}})).toThrow();
  });
  it('sends image pixels without an existing title and keeps field confidence',async()=>{
    const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='fake-only';
    const fetcher=vi.fn(async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(identity)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}}));vi.stubGlobal('fetch',fetcher);
    try{
      expect((await requestPhotoIdentity(photo)).identity).toEqual(identity);
      const request=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
      expect(request.contents[0].parts).toContainEqual({inlineData:{mimeType:photo.mimeType,data:photo.data.toString('base64')}});
      expect(request.contents[0].parts[0].text).not.toContain('Existing item');
      expect(request.contents[0].parts[0].text).not.toContain('Ultra White');
    }finally{vi.unstubAllGlobals();if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;}
  });
  it('strips only a leading brand from the proposed product name',()=>{
    expect(normalizePhotoIdentity({...identity,name:'Monster Ultra White'}).name).toBe('Ultra White');
    expect(normalizePhotoIdentity({...identity,brand:'Red Bull',name:'Red Bull: Juneberry'}).name).toBe('Juneberry');
    expect(normalizePhotoIdentity({...identity,brand:'Battery',name:'Battery Mango'}).name).toBe('Mango');
    expect(normalizePhotoIdentity({...identity,brand:null,name:'Mac and cheese'})).toMatchObject({brand:null,name:'Mac and cheese'});
  });
  it('honors quota retry hints with fake time',async()=>{
    const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='fake-only';vi.useFakeTimers();
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'18s'}]}},{status:429})).mockResolvedValueOnce(Response.json({candidates:[{content:{parts:[{text:JSON.stringify(identity)}]}}]}));vi.stubGlobal('fetch',fetcher);
    try{const pending=requestPhotoIdentity(photo);await vi.advanceTimersByTimeAsync(17999);expect(fetcher).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect((await pending).usage.providerCalls).toBe(2);}
    finally{vi.useRealTimers();vi.unstubAllGlobals();if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;}
  });
  it('caches completed and failed attempts so resume does not pay again',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'everrate-photo-analysis-'));
    const provider=vi.fn(async()=>({identity,rawSuggestion:identity,usage:{inputTokens:10,outputTokens:20,providerCalls:1}}));
    try{
      const first=await analyzeCachedPhoto({...photo,directory,provider});expect(first.cached).toBe(false);
      expect((await analyzeCachedPhoto({...photo,directory,provider})).cached).toBe(true);expect(provider).toHaveBeenCalledTimes(1);
      const failedPhoto={...photo,data:Buffer.from('failed'),sha256:createHash('sha256').update('failed').digest('hex')},failing=vi.fn(async()=>{throw new Error('network');});
      expect((await analyzeCachedPhoto({...failedPhoto,directory,provider:failing})).record.status).toBe('failed');
      expect((await analyzeCachedPhoto({...failedPhoto,directory,provider:failing})).cached).toBe(true);expect(failing).toHaveBeenCalledTimes(1);
      expect((await analyzeCachedPhoto({...failedPhoto,directory,provider,retryFailed:true})).record.status).toBe('completed');
    }finally{await rm(directory,{recursive:true,force:true});}
  });
  it('coalesces simultaneous cache attempts and rejects mismatched image hashes',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'everrate-photo-lock-'));let finish!:()=>void;let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;}),waiting=new Promise<void>(resolve=>{finish=resolve;});
    const provider=vi.fn(async()=>{started();await waiting;return {identity,rawSuggestion:identity,usage:{inputTokens:1,outputTokens:1,providerCalls:1}};});
    try{
      const first=analyzeCachedPhoto({...photo,directory,provider});await ready;
      expect((await analyzeCachedPhoto({...photo,directory,provider})).cached).toBe(true);expect(provider).toHaveBeenCalledTimes(1);
      finish();await first;
      await expect(analyzeCachedPhoto({...photo,directory,data:Buffer.from('wrong')})).rejects.toThrow('Invalid photograph hash');
    }finally{finish?.();await rm(directory,{recursive:true,force:true});}
  });
  it('flags differing product identities across an item history and ambiguous photos',()=>{
    const result=groupPhotoEvidence([{itemId:'item',photoHash:'a',identity},{itemId:'item',photoHash:'b',identity:{...identity,name:'Lewis Hamilton',variant:'Zero sugar'}},{itemId:'other',photoHash:'c',identity:{...identity,multipleProducts:true}}]);
    expect(result.find(row=>row.itemId==='item')).toMatchObject({conflictingEvidence:true,requiresReview:true});
    expect(result.find(row=>row.itemId==='other')).toMatchObject({multipleProducts:true,requiresReview:true});
    expect(groupPhotoEvidence([{itemId:'same',photoHash:'a',identity},{itemId:'same',photoHash:'a',identity}])[0].photoCount).toBe(1);
  });
  it('keeps every source photo and rating link in partial batches until all evidence is completed',()=>{
    const links:[string,{item_id:string;photo_id:string;rating_id:string|null}[]][]=[
      ['a',[{item_id:'item',photo_id:'photo-a',rating_id:'rating-a'},{item_id:'item',photo_id:'photo-a',rating_id:null}]],
      ['b',[{item_id:'item',photo_id:'photo-b',rating_id:'rating-b'}]],
      ['c',[{item_id:'unstarted-item',photo_id:'photo-c',rating_id:'rating-c'}]],
    ];
    const records=new Map([['a',{status:'completed' as const,identity}]]);
    const partial=groupPhotoEvidence(buildPhotoEvidence(links,records));
    expect(partial.find(row=>row.itemId==='item')).toMatchObject({photoCount:2,requiresReview:true,conflictingEvidence:false});
    expect(partial.find(row=>row.itemId==='unstarted-item')).toMatchObject({photoCount:1,requiresReview:true,evidence:[{identity:null,ratingIds:['rating-c']}]});
    expect(partial.find(row=>row.itemId==='item')?.evidence.flatMap(row=>row.ratingIds||[]).sort()).toEqual(['rating-a','rating-b']);
    records.set('b',{status:'completed',identity});records.set('c',{status:'completed',identity});
    expect(groupPhotoEvidence(buildPhotoEvidence(links,records)).every(row=>!row.requiresReview)).toBe(true);
    const failed=new Map([['a',{status:'failed' as const,identity}]]);
    expect(buildPhotoEvidence(links,failed).every(row=>row.identity===null)).toBe(true);
  });
});

const url=process.env.TEST_DATABASE_URL;
if(url&&(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local _test database required');
describe.skipIf(!url)('local photo proposal orchestration',()=>{
  it('advances small cached batches, preserves rating links, and makes no application writes',async()=>{
    const db=new Pool({connectionString:url}),directory=await mkdtemp(join(tmpdir(),'everrate-photo-db-')),user=randomUUID(),group=randomUUID(),item=randomUUID();
    try{
      await db.query('INSERT INTO everrate.users(id,display_name) VALUES($1,$2)',[user,'Photo analysis fixture']);
      await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,$2,$3,$4)',[group,'Photo analysis fixture',user,randomUUID()]);
      await db.query('INSERT INTO everrate.items(id,group_id,name,created_by,identity_key,legacy_metadata) VALUES($1,$2,$3,$4,$5,$6)',[item,group,'Old misleading title',user,'legacy',JSON.stringify({id:item})]);
      const ratingIds=[];
      for(let n=0;n<2;n++){const data=Buffer.from('photo-fixture-'+n),photoId=randomUUID(),rating=randomUUID();ratingIds.push(rating);
        await db.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',1,1)",[photoId,group,user,data,createHash('sha256').update(data).digest('hex')]);
        await db.query('INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,photo_id) VALUES($1,$2,$3,$4,7,$5)',[rating,group,item,user,photoId]);
      }
      const before=(await db.query('SELECT row_to_json(i) snapshot FROM everrate.items i WHERE id=$1',[item])).rows[0].snapshot;
      const provider=vi.fn(async(input:{data:Buffer})=>({identity:{...identity,name:input.data.toString().endsWith('0')?'Lewis Hamilton':'Lando Norris'},rawSuggestion:{},usage:{inputTokens:10,outputTokens:10,providerCalls:1}}));
      const options={connectionString:url!,directory,groupId:group,provider,limit:1};
      expect(await runPhotoIdentityAnalysis(options)).toMatchObject({analyzed:false,selected:1});expect(provider).not.toHaveBeenCalled();
      expect(await runPhotoIdentityAnalysis({...options,analyze:true})).toMatchObject({providerCalls:1});
      const partial=JSON.parse(await readFile(join(directory,'proposals.json'),'utf8'));
      expect(partial.items[0]).toMatchObject({itemId:item,photoCount:2,requiresReview:true});
      expect(partial.items[0].evidence.filter((row:{identity:PhotoIdentity|null})=>row.identity===null)).toHaveLength(1);
      expect(partial.items[0].evidence.flatMap((row:{ratingIds:string[]})=>row.ratingIds).sort()).toEqual(ratingIds.sort());
      expect(await runPhotoIdentityAnalysis({...options,analyze:true})).toMatchObject({providerCalls:1,conflictingItems:1});
      expect(await runPhotoIdentityAnalysis({...options,analyze:true})).toMatchObject({providerCalls:0,cached:2});expect(provider).toHaveBeenCalledTimes(2);
      const proposals=JSON.parse(await readFile(join(directory,'proposals.json'),'utf8'));
      expect(proposals.items[0]).toMatchObject({itemId:item,conflictingEvidence:true,photoCount:2});
      expect(proposals.items[0].evidence.flatMap((row:{ratingIds:string[]})=>row.ratingIds).sort()).toEqual(ratingIds.sort());
      expect((await db.query('SELECT row_to_json(i) snapshot FROM everrate.items i WHERE id=$1',[item])).rows[0].snapshot).toEqual(before);
      expect((await db.query('SELECT count(*)::int n FROM everrate.audit_events WHERE group_id=$1',[group])).rows[0].n).toBe(0);
      expect((await db.query('SELECT count(*)::int n FROM everrate.recognition_jobs WHERE group_id=$1',[group])).rows[0].n).toBe(0);
      expect((await db.query('SELECT count(*)::int n FROM everrate.discord_outbox WHERE group_id=$1',[group])).rows[0].n).toBe(0);
    }finally{await db.end();await rm(directory,{recursive:true,force:true});}
  });
});
