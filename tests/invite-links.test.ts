import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({jar:new Map<string,{value:string;options?:Record<string,unknown>}>(),getUser:vi.fn(),exchange:vi.fn(),clientUser:vi.fn(),oauth:vi.fn(),previewInvite:vi.fn(),joinGroup:vi.fn(),ensureUser:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>mocks.jar.get(name),getAll:()=>[...mocks.jar].map(([name,c])=>({name,value:c.value})),set:(name:string,value:string,options?:Record<string,unknown>)=>{mocks.jar.set(name,{value,options});}})}));
vi.mock('../src/lib/supabase/server',()=>({sessionUser:async()=>mocks.getUser(),authClient:async()=>({auth:{signInWithOAuth:mocks.oauth,exchangeCodeForSession:mocks.exchange,getUser:mocks.clientUser}})}));
vi.mock('../src/server/service',()=>({previewInvite:mocks.previewInvite,joinGroup:mocks.joinGroup,ensureUser:mocks.ensureUser}));
import {POST} from '../src/app/auth/join/route';
import {GET} from '../src/app/auth/callback/route';
import {inviteCode,inviteLink} from '../src/lib/invite-link';

const origin='https://tastebuds.example',code='AbCdEfGhIjKlMnOpQrStUvWxYz012345-_ab';
const authId='11111111-1111-4111-8111-111111111111',canonical='22222222-2222-4222-8222-222222222222',groupId='33333333-3333-4333-8333-333333333333';
const authUser={id:authId,user_metadata:{},identities:[{provider:'discord',id:'900000000000000101',user_id:authId}]};
const join=(body:string,from=origin)=>new Request(origin+'/auth/join',{method:'POST',headers:{origin:from,'content-type':'application/x-www-form-urlencoded'},body});
const pending=()=>mocks.jar.get('tastebuds_invite');

describe('invite links',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.jar.clear();vi.stubEnv('APP_URL',origin);
    mocks.previewInvite.mockImplementation(async(value:string)=>value===code?{name:'The usual suspects'}:null);
    mocks.joinGroup.mockResolvedValue({id:groupId});mocks.ensureUser.mockResolvedValue({id:canonical});
    mocks.getUser.mockResolvedValue({data:{user:null},error:null});
    mocks.oauth.mockResolvedValue({data:{url:'https://auth.example/authorize?provider=discord'},error:null});
  });
  it('builds a link from the code and reads either a pasted link or a bare code',()=>{
    expect(inviteLink(origin,code)).toBe(`${origin}/join/${code}`);
    expect(inviteCode(` ${inviteLink(origin,code)}?utm=x `)).toBe(code);
    expect(inviteCode(` ${code} `)).toBe(code);
  });
  it('joins a signed-in member straight into the group',async()=>{
    mocks.getUser.mockResolvedValue({data:{user:authUser},error:null});
    const response=await POST(join('code='+code));
    expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(`${origin}/app?group=${groupId}`);
    expect(mocks.joinGroup).toHaveBeenCalledWith(canonical,{code});expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('sends a signed-out visitor to Discord with the unchanged callback and remembers only this invite',async()=>{
    const response=await POST(join('code='+code));
    expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('https://auth.example/authorize?provider=discord');
    expect(mocks.oauth).toHaveBeenCalledWith({provider:'discord',options:{redirectTo:`${origin}/auth/callback`}});
    expect(pending()).toEqual({value:code,options:{httpOnly:true,secure:true,sameSite:'lax',path:'/auth',maxAge:600}});
    expect(mocks.joinGroup).not.toHaveBeenCalled();
  });
  it('refuses cross-site posts and unknown codes without joining or starting sign-in',async()=>{
    mocks.getUser.mockResolvedValue({data:{user:authUser},error:null});
    const forged=await POST(join('code='+code,'https://evil.example'));
    expect(forged.headers.get('location')).toBe(`${origin}/`);
    const stale=await POST(join('code=OldCodeOldCodeOldCodeOldCode'));
    expect(stale.headers.get('location')).toBe(`${origin}/join/OldCodeOldCodeOldCodeOldCode`);
    expect(mocks.joinGroup).not.toHaveBeenCalled();expect(mocks.oauth).not.toHaveBeenCalled();expect(pending()).toBeUndefined();
  });
  it('finishes a pending invite after the Discord round trip and clears it',async()=>{
    mocks.jar.set('tastebuds_invite',{value:code});mocks.exchange.mockResolvedValue({error:null});mocks.clientUser.mockResolvedValue({data:{user:authUser},error:null});
    const response=await GET(new Request(origin+'/auth/callback?code=oauth-code'));
    expect(response.headers.get('location')).toBe(`${origin}/app?group=${groupId}`);
    expect(mocks.joinGroup).toHaveBeenCalledWith(canonical,{code});expect(pending()?.options).toMatchObject({path:'/auth',maxAge:0});
  });
  it('signs in normally without a pending invite and returns to the invite when the code went stale',async()=>{
    mocks.exchange.mockResolvedValue({error:null});mocks.clientUser.mockResolvedValue({data:{user:authUser},error:null});
    expect((await GET(new Request(origin+'/auth/callback?code=oauth-code'))).headers.get('location')).toBe(`${origin}/app`);
    expect(mocks.joinGroup).not.toHaveBeenCalled();
    mocks.jar.set('tastebuds_invite',{value:code});mocks.joinGroup.mockRejectedValue(Object.assign(new Error('Invite not found'),{status:404}));
    expect((await GET(new Request(origin+'/auth/callback?code=oauth-code'))).headers.get('location')).toBe(`${origin}/join/${code}?error=join`);
  });
});
