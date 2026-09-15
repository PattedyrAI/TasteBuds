import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),ensureUser:vi.fn(),updatePreferences:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({authClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('../src/server/service',()=>({ensureUser:mocks.ensureUser,updatePreferences:mocks.updatePreferences}));
import {PATCH} from '../src/app/api/[...path]/route';
const authId='11111111-1111-4111-8111-111111111111',canonical='22222222-2222-4222-8222-222222222222';
const account={id:canonical,discordId:'900000000000000401',aiEnabled:true,nickname:'Tea friend',displayName:'Tea friend',avatarUrl:null};
function request(path=['me','preferences'],body:unknown={aiEnabled:true},origin='https://example.test'){return PATCH(new Request('https://example.test/api/'+path.join('/'),{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({path})});}
describe('authenticated self AI preference endpoint',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://example.test');mocks.getUser.mockResolvedValue({data:{user:{id:authId,identities:[{provider:'discord',id:account.discordId,user_id:authId}],user_metadata:{}}},error:null});mocks.ensureUser.mockResolvedValue(account);mocks.updatePreferences.mockResolvedValue(account);});
 it('updates the trusted canonical person and returns an uncached User',async()=>{const response=await request();expect(response.status).toBe(200);expect(await response.json()).toEqual(account);expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.updatePreferences).toHaveBeenCalledWith(canonical,{aiEnabled:true});});
 it('rejects unauthenticated requests before updating a preference',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await request()).status).toBe(401);expect(mocks.updatePreferences).not.toHaveBeenCalled();});
 it('rejects cross-origin writes before authentication or mutation',async()=>{expect((await request(['me','preferences'],{aiEnabled:true},'https://other.test')).status).toBe(403);expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.updatePreferences).not.toHaveBeenCalled();});
 it('does not expose an arbitrary-user preference route',async()=>{expect((await request(['me',authId])).status).toBe(404);expect(mocks.updatePreferences).not.toHaveBeenCalled();});
});
