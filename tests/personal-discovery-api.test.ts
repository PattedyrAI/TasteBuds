import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),ensureUser:vi.fn(),saveItem:vi.fn(),getTasteInsights:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({authClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('../src/server/service',()=>({ensureUser:mocks.ensureUser,saveItem:mocks.saveItem,getTasteInsights:mocks.getTasteInsights}));
import {GET,POST,DELETE} from '../src/app/api/[...path]/route';
const authId='11111111-1111-4111-8111-111111111111',canonical='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333';
async function request(method:'GET'|'POST'|'DELETE',path:string[],origin='https://example.test'){
  return {GET,POST,DELETE}[method](new Request('https://example.test/api/'+path.join('/'),{method,headers:{origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({userId:authId})}:{})}),{params:Promise.resolve({path})});
}
describe('private discovery endpoints',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://example.test');mocks.getUser.mockResolvedValue({data:{user:{id:authId,identities:[{provider:'discord',id:'900000000000000401',user_id:authId}],user_metadata:{}}},error:null});mocks.ensureUser.mockResolvedValue({id:canonical});mocks.saveItem.mockResolvedValue({saved:true});mocks.getTasteInsights.mockResolvedValue({matches:[],divisive:[]});});
  afterEach(()=>vi.unstubAllEnvs());
  it('saves and removes for trusted canonical identity, ignoring body user impersonation',async()=>{
    const response=await request('POST',['items',itemId,'save']);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.saveItem).toHaveBeenLastCalledWith(canonical,itemId,true);
    expect((await request('DELETE',['items',itemId,'save'])).status).toBe(200);expect(mocks.saveItem).toHaveBeenLastCalledWith(canonical,itemId,false);
  });
  it('reads taste only through authenticated canonical identity',async()=>{
    expect((await request('GET',['groups',itemId,'taste'])).status).toBe(200);expect(mocks.getTasteInsights).toHaveBeenCalledWith(canonical,itemId);
    mocks.getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await request('GET',['groups',itemId,'taste'])).status).toBe(401);
    expect((await request('POST',['items',itemId,'save'])).status).toBe(401);expect(mocks.saveItem).not.toHaveBeenCalled();
  });
  it('rejects cross-origin writes before any persistence',async()=>{
    expect((await request('POST',['items',itemId,'save'],'https://other.test')).status).toBe(403);
    expect((await request('DELETE',['items',itemId,'save'],'https://other.test')).status).toBe(403);
    expect(mocks.saveItem).not.toHaveBeenCalled();
  });
});
