import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),ensureUser:vi.fn(),updateNickname:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({authClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('../src/server/service',()=>({ensureUser:mocks.ensureUser,updateNickname:mocks.updateNickname}));
import {PATCH} from '../src/app/api/[...path]/route';
const authId='11111111-1111-4111-8111-111111111111',canonical='22222222-2222-4222-8222-222222222222';
const account={id:canonical,discordId:'900000000000000401',nickname:'Tea friend',displayName:'Tea friend',avatarUrl:null};
function request(path=['me'],body:unknown={nickname:'Tea friend'},origin='https://example.test'){return PATCH(new Request('https://example.test/api/'+path.join('/'),{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({path})});}
describe('authenticated self nickname endpoint',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://example.test');mocks.getUser.mockResolvedValue({data:{user:{id:authId,identities:[{provider:'discord',id:account.discordId,user_id:authId}],user_metadata:{}}},error:null});mocks.ensureUser.mockResolvedValue(account);mocks.updateNickname.mockResolvedValue(account);});
 it('updates the trusted canonical person and returns an uncached User',async()=>{const response=await request();expect(response.status).toBe(200);expect(await response.json()).toEqual(account);expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.updateNickname).toHaveBeenCalledWith(canonical,{nickname:'Tea friend'});});
 it('rejects unauthenticated requests before updating a nickname',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await request()).status).toBe(401);expect(mocks.updateNickname).not.toHaveBeenCalled();});
 it('rejects cross-origin writes before authentication or mutation',async()=>{expect((await request(['me'],{nickname:'Tea friend'},'https://other.test')).status).toBe(403);expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.updateNickname).not.toHaveBeenCalled();});
 it('does not expose an arbitrary-user nickname route',async()=>{expect((await request(['me',authId])).status).toBe(404);expect(mocks.updateNickname).not.toHaveBeenCalled();});
});
