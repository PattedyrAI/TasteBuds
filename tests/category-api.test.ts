import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),ensureUser:vi.fn(),createCategory:vi.fn(),updateCategory:vi.fn(),getMapsConfiguration:vi.fn(),getRestaurantMap:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({authClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('../src/server/service',()=>({ensureUser:mocks.ensureUser}));
vi.mock('../src/server/services/categories',()=>({createCategory:mocks.createCategory,updateCategory:mocks.updateCategory,getMapsConfiguration:mocks.getMapsConfiguration}));
vi.mock('../src/server/services/restaurants',()=>({getRestaurantMap:mocks.getRestaurantMap}));
import {GET,POST,PATCH} from '../src/app/api/[...path]/route';
const uid='10000000-0000-4000-8000-000000000001',canonical='10000000-0000-4000-8000-000000000002',group='10000000-0000-4000-8000-000000000003',category='10000000-0000-4000-8000-000000000004';
function call(method:'GET'|'POST'|'PATCH',path:string[],origin='https://example.test',query=''){
  return ({GET,POST,PATCH})[method](new Request('https://example.test/api/'+path.join('/')+query,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify({name:'Restaurant',fields:[],userId:'untrusted'})}),{params:Promise.resolve({path})});
}
describe('private kategori- og kartendepunkter',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://example.test');mocks.getUser.mockResolvedValue({data:{user:{id:uid,identities:[{provider:'discord',id:'123456789',user_id:uid}],user_metadata:{}}},error:null});mocks.ensureUser.mockResolvedValue({id:canonical});mocks.createCategory.mockResolvedValue({id:category});mocks.updateCategory.mockResolvedValue({id:category});mocks.getRestaurantMap.mockResolvedValue({restaurants:[]});});
  afterEach(()=>vi.unstubAllEnvs());
  it('bruker verifisert identitet og sender valgt kategori til karttjenesten',async()=>{
    const result=await call('GET',['groups',group,'restaurants'],undefined,'?categoryId='+category);
    expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');
    expect(mocks.getRestaurantMap).toHaveBeenCalledWith(canonical,group,category);
    expect((await call('POST',['groups',group,'categories'])).status).toBe(200);
    expect(mocks.createCategory.mock.calls[0][0]).toBe(canonical);
    expect((await call('PATCH',['groups',group,'categories',category])).status).toBe(200);
    expect(mocks.updateCategory.mock.calls[0].slice(0,3)).toEqual([canonical,group,category]);
  });
  it('avviser anonyme brukere og eksterne skriver før kategoritjenesten',async()=>{
    expect((await call('POST',['groups',group,'categories'],'https://evil.test')).status).toBe(403);
    mocks.getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await call('GET',['groups',group,'restaurants'])).status).toBe(401);
    expect(mocks.getRestaurantMap).not.toHaveBeenCalled();expect(mocks.createCategory).not.toHaveBeenCalled();
  });
});
