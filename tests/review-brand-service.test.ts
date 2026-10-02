import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({query:vi.fn(),brand:null as string|null}));
vi.mock('../src/server/db',()=>({transaction:async(fn:(db:unknown)=>unknown)=>fn({query:f.query}),query:vi.fn()}));
vi.mock('../src/server/platform-admin',()=>({isPlatformAdmin:()=>false}));
vi.mock('../src/server/services/common',()=>({validId:()=>{},parse:(schema:{parse:(v:unknown)=>unknown},v:unknown)=>schema.parse(v),requireMembership:vi.fn(),audit:vi.fn(),lookupLabel:vi.fn(),lookupCategory:vi.fn(),ServiceError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
vi.mock('../src/server/services/rating-location',()=>({ratingTemplate:async()=>({values:{},fields:[]}),verifyRatingLocation:vi.fn(),persistRatingLocation:vi.fn()}));
vi.mock('../src/server/services/rating-photos',()=>({requireRatingPhotos:vi.fn(),replaceExtraPhotos:vi.fn()}));
vi.mock('../src/server/services/items',()=>({getRatingRecord:vi.fn(),comment:vi.fn()}));
import {createRating} from '../src/server/services/ratings';
const input={groupId:'11111111-1111-4111-8111-111111111111',itemId:'22222222-2222-4222-8222-222222222222',photoId:'33333333-3333-4333-8333-333333333333',score:7,brand:'Invented client brand'};
beforeEach(()=>{f.query.mockReset();f.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM everrate.items'))return {rowCount:1,rows:[{id:input.itemId,brand:f.brand}]};
  if(sql.includes('INSERT INTO everrate.ratings'))throw new Error('reached rating insert');
  return {rowCount:1,rows:[]};
});});
describe('stored brand requirement',()=>{
  it.each([null,'','   '])('rejects linked item with brand %s despite supplied brand',async brand=>{
    f.brand=brand;
    await expect(createRating(input.groupId,input)).rejects.toMatchObject({status:400,message:expect.stringContaining('brand')});
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO everrate.ratings'))).toBe(false);
  });
  it('uses the stored brand when reviewing an existing item',async()=>{
    f.brand='Acme';
    await expect(createRating(input.groupId,{...input,brand:null})).rejects.toThrow('reached rating insert');
  });
});
