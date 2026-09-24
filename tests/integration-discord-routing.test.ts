import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connectDiscord,processDiscordOutbox} from '../src/server/discord';
import {createGroup,createRating,ensureUser,getGroup,joinGroup} from '../src/server/service';
import {createCategory} from '../src/server/services/categories';
import {getPool} from '../src/server/db';

const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Use a disposable local _test database');
if(url)process.env.DATABASE_URL=url;
const energyHook='https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';
const foodHook='https://discord.com/api/webhooks/223456789012345678/abcdefghijklmnopqrstuvwxyz';
const owner=randomUUID(),member=randomUUID();
const ownerName='Route owner '+owner;
let groupId:string,photoId:string,energyId:string,foodId:string;
let posted:{target:string;body:{embeds:{url:string}[]}}[];
const rate=async(type:string)=>{
  const rating=await createRating(owner,{groupId,name:type+' '+randomUUID(),type,photoId,score:8,idempotencyKey:randomUUID()});
  // The worker is global and bounded. Put only our fixtures first without
  // changing or clearing other integration suites' queued work.
  await getPool().query("UPDATE everrate.discord_outbox SET created_at='0001-01-01T00:00:00Z' WHERE rating_id=$1",[rating.id]);
  return rating;
};
const connect=(route:string,categoryIds:string[],hook=route==='food'?foodHook:energyHook)=>connectDiscord(owner,groupId,{route,categoryIds,url:hook,enabled:true});

describe.skipIf(!url)('Discord category destinations',()=>{
  beforeAll(async()=>{
    vi.stubEnv('DISCORD_ENCRYPTION_KEY','ab'.repeat(32));vi.stubEnv('APP_URL','https://example.test');
    await ensureUser({id:owner,displayName:ownerName});await ensureUser({id:member,displayName:'Member'});
  });
  beforeEach(async()=>{
    posted=[];
    vi.stubGlobal('fetch',vi.fn(async(target:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      if(body.embeds[0].footer.text===`Rated by ${ownerName} on TasteBuds`)posted.push({target:String(target),body});
      return Response.json({});
    }));
    const group=await createGroup(owner,{name:'Routing '+randomUUID()});groupId=group.id;
    await joinGroup(member,{code:group.inviteCode!});
    energyId=(await createCategory(owner,groupId,{name:'Energy drinks'})).id;
    foodId=(await createCategory(owner,groupId,{name:'Pizza'})).id;
    await createCategory(owner,groupId,{name:'Coffee'});
    photoId=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/png',1,1) RETURNING id",[groupId,owner,Buffer.from('photo'),'a'.repeat(64)])).rows[0].id;
  });
  afterEach(async()=>{
    await getPool().query('UPDATE everrate.discord_connections SET enabled=false WHERE group_id=$1',[groupId]);
    vi.unstubAllGlobals();
  });
  afterAll(async()=>{vi.unstubAllEnvs();await getPool().end();});

  it('posts each selected category to its exact channel and omits unmatched reviews',async()=>{
    await connect('energy_drinks',[energyId]);await connect('food',[foodId]);
    const energy=await rate('Energy drinks'),food=await rate('Pizza');await rate('Coffee');
    await processDiscordOutbox();
    expect(posted).toHaveLength(2);
    const destinations=new Map(posted.map(({target,body})=>[body.embeds[0].url,target]));
    expect(destinations.get('https://example.test/app?item='+energy.itemId)).toBe(energyHook+'?wait=true');
    expect(destinations.get('https://example.test/app?item='+food.itemId)).toBe(foodHook+'?wait=true');
    expect((await getPool().query('SELECT status FROM everrate.discord_outbox WHERE group_id=$1',[groupId])).rows).toEqual([{status:'sent'},{status:'sent'}]);
  });
  it('rejects overlapping categories and an all-reviews destination alongside specific routes',async()=>{
    await connect('energy_drinks',[energyId]);
    await expect(connect('food',[energyId])).rejects.toMatchObject({status:409});
    await expect(connectDiscord(owner,groupId,{url:foodHook,enabled:true})).rejects.toMatchObject({status:409});
  });
  it('rejects foreign categories and non-managers without changing the connection',async()=>{
    const other=await createGroup(owner,{name:'Other'});
    const foreign=await createCategory(owner,other.id,{name:'Pizza'});
    await expect(connect('food',[foreign.id])).rejects.toMatchObject({status:400});
    await expect(connectDiscord(member,groupId,{route:'food',categoryIds:[foodId],url:foodHook,enabled:true})).rejects.toBeDefined();
    expect((await getPool().query('SELECT 1 FROM everrate.discord_connections WHERE group_id=$1',[groupId])).rowCount).toBe(0);
  });
  it('disables only the selected route, preserving the other channel',async()=>{
    await connect('energy_drinks',[energyId]);await connect('food',[foodId]);
    const energy=await rate('Energy drinks'),food=await rate('Pizza');
    await connectDiscord(owner,groupId,{route:'energy_drinks',enabled:false});
    await processDiscordOutbox();
    expect(posted.map(({target})=>target)).toEqual([foodHook+'?wait=true']);
    const states=(await getPool().query('SELECT rating_id,status FROM everrate.discord_outbox WHERE group_id=$1',[groupId])).rows;
    expect(states).toContainEqual({rating_id:energy.id,status:'cancelled'});expect(states).toContainEqual({rating_id:food.id,status:'sent'});
  });
  it('cancels pending work when categories are removed and never replays it when re-enabled',async()=>{
    await connect('food',[foodId]);const rating=await rate('Pizza');
    await connect('food',[energyId]);await connect('food',[foodId]);
    await processDiscordOutbox();expect(posted).toEqual([]);
    expect((await getPool().query('SELECT status FROM everrate.discord_outbox WHERE rating_id=$1',[rating.id])).rows[0].status).toBe('cancelled');
  });
  it('does not reroute an already queued review after its item changes category',async()=>{
    await connect('energy_drinks',[energyId]);await connect('food',[foodId]);
    const rating=await rate('Energy drinks');
    await getPool().query('UPDATE everrate.items SET type_id=$1 WHERE id=$2',[foodId,rating.itemId]);
    await processDiscordOutbox();expect(posted).toEqual([]);
  });
  it('returns category routing metadata without webhook secrets',async()=>{
    await connect('food',[foodId]);
    const detail=await getGroup(owner,groupId);
    expect(detail).toMatchObject({discordConnections:[{route:'food',enabled:true,categoryIds:[foodId]}]});
    expect(JSON.stringify(detail)).not.toContain('webhook');expect(JSON.stringify(detail)).not.toContain(foodHook);
    expect((await getGroup(member,groupId)).discordConnections).toEqual([]);
  });
  it('serializes competing saves so one category cannot acquire two enabled destinations',async()=>{
    const results=await Promise.allSettled([connect('energy_drinks',[energyId]),connect('food',[energyId])]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    await rate('Energy drinks');
    expect((await getPool().query('SELECT route FROM everrate.discord_outbox WHERE group_id=$1',[groupId])).rows).toHaveLength(1);
  });
  it('rejects unknown routes and enabled specific routes without categories',async()=>{
    await expect(connect('unknown',[foodId])).rejects.toBeDefined();
    await expect(connect('food',[])).rejects.toMatchObject({status:400});
    expect((await getPool().query('SELECT 1 FROM everrate.discord_connections WHERE group_id=$1',[groupId])).rowCount).toBe(0);
  });
});
