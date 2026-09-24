import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';
import {getRestaurantMap} from '../src/server/services/restaurants';
import {createCategory,updateCategory} from '../src/server/services/categories';
import type {CategoryField} from '../src/lib/contracts';
const url=process.env.TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.pathname!=='/everrate_test'||target.search)throw new Error('Use the disposable local everrate_test database');process.env.DATABASE_URL=url;}
describe.skipIf(!url)('adminstyrte kategorimaler, vurderinger og kart',()=>{
  const owner=randomUUID(),member=randomUUID(),outsider=randomUUID();let groupId:string,otherGroup:string,photoId:string,categoryId:string,itemId:string,placeId:string,firstRating:string;
  const fields:CategoryField[]=[{id:'cuisine',label:'Cuisine',type:'select',options:['Italiensk','Indisk'],required:true,filterable:true},{id:'price',label:'Pris',type:'price',required:false,filterable:true},{id:'location',label:'Lokasjon',type:'location',required:false,filterable:false}];
  const fetch=vi.fn(async(input:string|URL|Request)=>Response.json({id:String(input).split('/').at(-1),location:{latitude:59.91,longitude:10.75}}));
  beforeAll(async()=>{
    await migrate(url);vi.stubGlobal('fetch',fetch);vi.stubEnv('GOOGLE_PLACES_SERVER_KEY','server-only');vi.stubEnv('GOOGLE_MAPS_BROWSER_KEY','browser-key');vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT','10000');
    for(const id of [owner,member,outsider])await service.ensureUser({id,displayName:'Karttester'});
    const group=await service.createGroup(owner,{name:'Restaurantkart'});groupId=group.id;
    await service.joinGroup(member,{code:group.inviteCode!});otherGroup=(await service.createGroup(owner,{name:'Annen gruppe'})).id;
    photoId=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,owner,Buffer.from('photo'),'a'.repeat(64)])).rows[0].id;
  });
  afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await getPool().end();});
  it('bare admin oppretter mal, også når ingen vurderinger finnes',async()=>{
    expect(await getRestaurantMap(owner,groupId)).toMatchObject({enabled:false,restaurants:[]});
    await expect(createCategory(member,groupId,{name:'Restaurant',fields})).rejects.toMatchObject({status:403});
    const category=await createCategory(owner,groupId,{name:'Restaurant',fields});categoryId=category.id;
    expect((await service.getGroup(owner,groupId)).categories).toContainEqual(category);
    await expect(createCategory(owner,groupId,{name:'restaurant',fields:[]})).rejects.toMatchObject({status:409});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('hindrer endringer fra medlemmer, innsyn fra fremmede og kryssing av grupper',async()=>{
    await expect(updateCategory(member,groupId,categoryId,{name:'Restaurant',fields:[]})).rejects.toMatchObject({status:403});
    await expect(updateCategory(owner,otherGroup,categoryId,{name:'Restaurant',fields:[]})).rejects.toMatchObject({status:404});
    await expect(getRestaurantMap(outsider,groupId)).rejects.toMatchObject({status:404});
    await expect(service.createRating(outsider,{groupId,name:'Sted',type:'Restaurant',customFields:{location:'outside',cuisine:'Indisk'},score:7,photoId})).rejects.toMatchObject({status:404});
    expect(fetch).not.toHaveBeenCalled();expect(JSON.stringify(await getRestaurantMap(owner,groupId))).not.toContain('server-only');
  });
  it('lagrer felter og sted atomisk og bevarer siste vurdering per person i gruppesnittet',async()=>{
    placeId=randomUUID();const input={groupId,name:'Vårt navn',type:'Restaurant',customFields:{cuisine:'Italiensk',price:200,location:placeId},score:2,photoId,idempotencyKey:randomUUID(),tastedAt:'2025-01-01T00:00:00Z'};
    const first=await service.createRating(owner,input);itemId=first.itemId;firstRating=first.id;
    expect(first).toMatchObject({customFields:input.customFields,categoryFields:fields});
    expect((await service.createRating(owner,input)).id).toBe(first.id);
    await service.createRating(owner,{groupId,itemId,customFields:{cuisine:'Italiensk',price:250},score:8,photoId,tastedAt:'2025-02-01T00:00:00Z'});
    const map=await getRestaurantMap(member,groupId);expect(map.restaurants).toHaveLength(1);
    expect(map.restaurants[0]).toMatchObject({item:{id:itemId,name:'Vårt navn',customFields:{cuisine:'Italiensk',price:250},average:8,raterCount:1,tastingCount:2},location:{lat:59.91,lng:10.75}});
    expect((await getPool().query('SELECT * FROM everrate.restaurant_places WHERE item_id=$1',[itemId])).rows[0]).not.toHaveProperty('latitude');
    expect((await getRestaurantMap(owner,otherGroup)).restaurants).toEqual([]);
  });
  it('avviser feil felter, manglende obligatoriske verdier og flytting av eksisterende sted',async()=>{
    await createCategory(owner,groupId,{name:'Snacks'});const before=fetch.mock.calls.length;
    await expect(service.createRating(owner,{groupId,name:'Chips',type:'Snacks',customFields:{location:randomUUID()},score:7,photoId})).rejects.toMatchObject({status:400});
    await expect(service.createRating(owner,{groupId,name:'Sted',type:'Restaurant',score:7,photoId})).rejects.toMatchObject({status:400});
    await expect(service.createRating(owner,{groupId,itemId,customFields:{location:randomUUID(),cuisine:'Indisk'},score:7,photoId})).rejects.toMatchObject({status:409});
    await expect(service.createRating(owner,{groupId:otherGroup,itemId,customFields:{location:placeId},score:7,photoId})).rejects.toMatchObject({status:404});
    expect(fetch.mock.calls).toHaveLength(before);
  });
  it('tidligere vurderinger kan redigeres etter malendring, med tidligere felter og revisjonshistorikk',async()=>{
    await updateCategory(owner,groupId,categoryId,{name:'Restaurant',fields:[]});const before=fetch.mock.calls.length;
    expect(await getRestaurantMap(owner,groupId)).toMatchObject({enabled:false,restaurants:[]});expect(fetch.mock.calls).toHaveLength(before);
    expect(await service.updateRating(owner,firstRating,{customFields:{cuisine:'Indisk',price:150,location:placeId}})).toMatchObject({customFields:{cuisine:'Indisk',price:150},categoryFields:fields});
    expect((await service.getItem(owner,itemId)).ratings).toHaveLength(2);
    await updateCategory(owner,groupId,categoryId,{name:'Restaurant',fields});expect((await getRestaurantMap(owner,groupId)).restaurants).toHaveLength(1);
    await expect(service.updateRating(owner,firstRating,{customFields:{cuisine:'Indisk',location:randomUUID()}})).rejects.toMatchObject({status:400});
  });
  it('avgrenser kart og Google-oppslag til den valgte kategorien',async()=>{
    const cafe=await createCategory(owner,groupId,{name:'Kafeer',fields:[fields[2]]});
    const newPlace=randomUUID();
    const review=await service.createRating(owner,{groupId,name:'Kafebesøk',type:'Kafeer',customFields:{location:newPlace},score:6,photoId});
    const before=fetch.mock.calls.length;
    expect((await getRestaurantMap(owner,groupId,categoryId)).restaurants.map(pin=>pin.item.id)).toEqual([itemId]);
    expect((await getRestaurantMap(owner,groupId,cafe.id)).restaurants.map(pin=>pin.item.id)).toEqual([review.itemId]);
    expect((await getRestaurantMap(owner,groupId,randomUUID())).restaurants).toEqual([]);
    expect(fetch.mock.calls).toHaveLength(before);
    await updateCategory(owner,groupId,cafe.id,{name:'Kafeer',fields:[]});
  });
  it('idempotent gjentakelse virker etter malendring og uten nye Google-oppslag',async()=>{
    const input={groupId,name:'Idempotent eksempel',type:'Restaurant',customFields:{cuisine:'Indisk'},score:7,photoId,idempotencyKey:randomUUID()};
    const saved=await service.createRating(owner,input),before=fetch.mock.calls.length;
    await updateCategory(owner,groupId,categoryId,{name:'Restaurant',fields:[]});
    expect((await service.createRating(owner,input)).id).toBe(saved.id);
    expect(fetch.mock.calls).toHaveLength(before);
    await updateCategory(owner,groupId,categoryId,{name:'Restaurant',fields});
  });
  it('stopper Google-kall ved dagsgrensen uten delvis vurdering og tillater valgfritt sted',async()=>{
    vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT','0');const before=fetch.mock.calls.length;
    await expect(service.createRating(owner,{groupId,name:'Over grensen',type:'Restaurant',customFields:{location:randomUUID(),cuisine:'Indisk'},score:7,photoId})).rejects.toMatchObject({status:429});
    expect(fetch.mock.calls).toHaveLength(before);
    await service.createRating(owner,{groupId,name:'Uten posisjon',type:'Restaurant',customFields:{cuisine:'Indisk'},score:7,photoId});
    expect((await getRestaurantMap(owner,groupId)).restaurants).toHaveLength(1);
  });
  it('blokkerer indirekte kategorioppretting fra en vanlig vurdering',async()=>{
    const p=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,member,Buffer.from('photo'),'b'.repeat(64)])).rows[0].id;
    await expect(service.createRating(member,{groupId,name:'Forsøk',type:'Ikke opprettet av admin',score:7,photoId:p})).rejects.toMatchObject({status:403});
    expect((await service.getGroup(owner,groupId)).categories?.some(category=>category.name==='Ikke opprettet av admin')).toBe(false);
  });
});
