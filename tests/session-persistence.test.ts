import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createChunks} from '@supabase/ssr';
import {proxy,config} from '../src/proxy';

const authId='11111111-1111-4111-8111-111111111111';
const user={id:authId,aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},user_metadata:{},identities:[{id:'900000000000000101',user_id:authId,provider:'discord'}]};
const session=(expiresAt:number)=>({access_token:'old-access',refresh_token:'valid-refresh',token_type:'bearer',expires_in:3600,expires_at:expiresAt,user});
const cookie=(expiresAt:number)=>'sb-example-auth-token=base64-'+Buffer.from(JSON.stringify(session(expiresAt))).toString('base64url');
const request=(path:string,expiresAt?:number)=>new NextRequest('https://tastebuds.example'+path,{headers:expiresAt===undefined?{}:{cookie:cookie(expiresAt)}});
let currentUser:unknown,revoked:boolean,refreshes:number;

describe('persistent returning sessions',()=>{
  beforeEach(()=>{
    currentUser=user;revoked=false;refreshes=0;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-test-key');
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('/token?grant_type=refresh_token')){
        refreshes++;
        expect(JSON.parse(String(init?.body)).refresh_token).toBe('valid-refresh');
        return revoked?Response.json({code:'refresh_token_not_found',msg:'Session revoked'},{status:400}):Response.json({...session(Math.floor(Date.now()/1000)+3600),access_token:'new-access',refresh_token:'rotated-refresh'});
      }
      if(url.endsWith('/user'))return currentUser?Response.json(currentUser):Response.json({code:'bad_jwt',msg:'Invalid token'},{status:401});
      throw new Error('Unexpected Auth request');
    }));
  });
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

  it('includes the welcome page in session refresh routing',()=>{
    expect(config.matcher).toContain('/');
  });
  it.each(['/','/auth/login'])('reuses an existing verified session at %s',async path=>{
    const response=await proxy(request(path,Math.floor(Date.now()/1000)+3600));
    expect(response.headers.get('location')).toBe('https://tastebuds.example/app');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(refreshes).toBe(0);
  });
  it('refreshes a 90-day-old access token and persists the rotated session on the redirect',async()=>{
    const incoming=request('/',Math.floor(Date.now()/1000)-90*86400);
    const response=await proxy(incoming);
    expect(refreshes).toBe(1);
    expect(response.headers.get('location')).toBe('https://tastebuds.example/app');
    const refreshed=response.cookies.getAll().find(c=>c.name==='sb-example-auth-token');
    expect(refreshed?.maxAge).toBeGreaterThanOrEqual(90*86400);
    const saved=JSON.parse(Buffer.from(refreshed!.value.slice('base64-'.length),'base64url').toString());
    expect(saved.access_token).toBe('new-access');
    expect(saved.refresh_token).toBe('rotated-refresh');
    expect(incoming.cookies.get('sb-example-auth-token')?.value).toBe(refreshed!.value);
  });
  it('keeps guests on the welcome page without contacting Auth',async()=>{
    const response=await proxy(request('/'));
    expect(response.headers.has('location')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('removes old cookie chunks when refresh shrinks the saved session',async()=>{
    const old={...session(Math.floor(Date.now()/1000)-3600),user:{...user,user_metadata:{large:'x'.repeat(15000)}}};
    const chunks=createChunks('sb-example-auth-token','base64-'+Buffer.from(JSON.stringify(old)).toString('base64url'));
    expect(chunks.length).toBeGreaterThan(1);
    const incoming=new NextRequest('https://tastebuds.example/',{headers:{cookie:chunks.map(c=>c.name+'='+c.value).join('; ')}});
    const response=await proxy(incoming);
    expect(response.headers.get('location')).toBe('https://tastebuds.example/app');
    for(const chunk of chunks){
      expect(response.cookies.get(chunk.name)).toMatchObject({value:'',maxAge:0});
    }
    expect(response.cookies.get('sb-example-auth-token')?.maxAge).toBe(400*86400);
  });
  it('does not redirect an invalid session into the app',async()=>{
    currentUser=null;
    const response=await proxy(request('/',Math.floor(Date.now()/1000)+3600));
    expect(response.headers.has('location')).toBe(false);
  });
  it('does not restore a revoked refresh session',async()=>{
    revoked=true;
    const response=await proxy(request('/',Math.floor(Date.now()/1000)-3600));
    expect(refreshes).toBe(1);
    expect(response.headers.has('location')).toBe(false);
    expect(response.cookies.get('sb-example-auth-token')?.maxAge).toBe(0);
  });
  it('does not start a return/login loop for a non-Discord identity',async()=>{
    currentUser={...user,identities:[{id:'other-provider',user_id:authId,provider:'email'}]};
    expect((await proxy(request('/',Math.floor(Date.now()/1000)+3600))).headers.has('location')).toBe(false);
  });
  it.each([
    {identities:[]},
    {identities:[{...user.identities[0],id:'invalid-id'}]},
    {identities:[{...user.identities[0],user_id:'22222222-2222-4222-8222-222222222222'}]},
    {identities:[...user.identities,{...user.identities[0],id:'900000000000000102'}]},
  ])('does not redirect an untrusted Discord identity set',async({identities})=>{
    currentUser={...user,identities};
    expect((await proxy(request('/',Math.floor(Date.now()/1000)+3600))).headers.has('location')).toBe(false);
  });
  it('allows the OAuth callback to complete even with an existing session',async()=>{
    const response=await proxy(request('/auth/callback?code=provider-code',Math.floor(Date.now()/1000)+3600));
    expect(response.headers.has('location')).toBe(false);
  });
});
