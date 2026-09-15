import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),ensureUser:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({authClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('../src/server/service',()=>({ensureUser:mocks.ensureUser}));
import {requireUser} from '../src/server/auth';
const authId='11111111-1111-4111-8111-111111111111',canonical='22222222-2222-4222-8222-222222222222',provider='900000000000000101';
const identity=(id=provider)=>({provider:'discord',id,identity_id:'33333333-3333-4333-8333-333333333333',user_id:authId});
function user(identities:unknown[]=[identity()],metadata:Record<string,unknown>={}){mocks.getUser.mockResolvedValue({data:{user:{id:authId,identities,user_metadata:metadata}},error:null});}
describe('trusted Auth provider identity boundary',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.ensureUser.mockResolvedValue({id:canonical});});
 it('returns the canonical historical UUID, using provider id rather than identity row UUID',async()=>{user();expect(await requireUser()).toBe(canonical);expect(mocks.ensureUser).toHaveBeenCalledWith(expect.objectContaining({id:authId,discordId:provider}));});
 it('rejects missing Discord identity even when editable metadata claims a known account',async()=>{user([],{provider_id:provider,sub:provider,discord_id:provider,name:'Historical'});await expect(requireUser()).rejects.toMatchObject({status:401});expect(mocks.ensureUser).not.toHaveBeenCalled();});
 it('rejects a provider identity attached to a different Auth user',async()=>{user([{...identity(),user_id:canonical}]);await expect(requireUser()).rejects.toMatchObject({status:401});expect(mocks.ensureUser).not.toHaveBeenCalled();});
 it('rejects multiple Discord account IDs rather than choosing the first',async()=>{user([identity(),identity('900000000000000102')]);await expect(requireUser()).rejects.toMatchObject({status:401});expect(mocks.ensureUser).not.toHaveBeenCalled();});
 it('does not recover an invalid provider ID from identity metadata',async()=>{user([{...identity('not-a-snowflake'),identity_data:{sub:provider,provider_id:provider}}]);await expect(requireUser()).rejects.toMatchObject({status:401});expect(mocks.ensureUser).not.toHaveBeenCalled();});
 it('fails before any account lookup when getUser does not validate the session',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:new Error('expired')});await expect(requireUser()).rejects.toMatchObject({status:401});expect(mocks.ensureUser).not.toHaveBeenCalled();});
});
