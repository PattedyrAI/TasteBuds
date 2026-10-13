// Local-only stand-in for Supabase Auth so the real app can be driven in a browser.
// Answers GET /auth/v1/user for bearer tokens of the form `ux-user-<n>`. Never deploy.
import {createServer} from 'node:http';
export const users=[
  {n:1,name:'Patrick',discord:'100000000000000001'},
  {n:2,name:'Mia',discord:'100000000000000002'},
  {n:3,name:'Jonas',discord:'100000000000000003'},
  {n:4,name:'Sara',discord:'100000000000000004'},
];
export function userFor(n){
  const u=users.find(u=>u.n===Number(n));if(!u)return null;
  const id=`00000000-0000-4000-8000-00000000000${u.n}`;
  return {id,aud:'authenticated',role:'authenticated',email:`${u.name.toLowerCase()}@example.test`,app_metadata:{provider:'discord'},user_metadata:{full_name:u.name,avatar_url:null},
    identities:[{id:u.discord,identity_id:`10000000-0000-4000-8000-00000000000${u.n}`,user_id:id,provider:'discord',identity_data:{}}],created_at:'2026-01-01T00:00:00Z'};
}
export function sessionCookie(n){
  const access=`ux-user-${n}`,session={access_token:access,refresh_token:access,token_type:'bearer',expires_in:86400*365,expires_at:Math.floor(Date.now()/1000)+86400*365,user:userFor(n)};
  return {name:'sb-localhost-auth-token',value:'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')};
}
if(process.argv[1]?.endsWith('fake-auth.mjs')){
  createServer((req,res)=>{
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');const n=token.match(/^ux-user-(\d+)$/)?.[1];
    res.setHeader('content-type','application/json');
    if(req.url?.startsWith('/auth/v1/user')&&n&&userFor(n)){res.end(JSON.stringify(userFor(n)));return;}
    if(req.url?.startsWith('/auth/v1/logout')){res.statusCode=204;res.end();return;}
    res.statusCode=401;res.end(JSON.stringify({code:401,msg:'invalid token'}));
  }).listen(Number(process.env.FAKE_AUTH_PORT||54999),'127.0.0.1');
  console.log('fake auth listening');
}
