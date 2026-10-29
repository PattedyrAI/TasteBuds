import {cookies} from 'next/headers';
import type {SupabaseClient,User} from '@supabase/supabase-js';
import {accountFor} from './auth';
import {joinGroup} from './service';

const PENDING='tastebuds_invite';
export const invitePath=(code:string)=>`/join/${encodeURIComponent(code)}`;
/** Carry an invite accepted while signed out across the Discord round trip. Only `/auth/join`'s same-origin POST sets it. */
export async function rememberInvite(code:string,secure:boolean){(await cookies()).set(PENDING,code,{httpOnly:true,secure,sameSite:'lax',path:'/auth',maxAge:600});}
/** Join the invited group as a getUser-validated user and return where the browser goes next. */
export async function acceptInvite(user:User,code:string){
  try{const group=await joinGroup(await accountFor(user),{code});return `/app?group=${encodeURIComponent(group.id)}`;}
  catch(error){if(!(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'&&error.status<500))console.error('Invite join failed',{kind:error instanceof Error?error.name:'Unknown'});return `${invitePath(code)}?error=join`;}
}
/** After the OAuth exchange, finish a pending invite; otherwise continue to the app. */
export async function acceptPendingInvite(client:SupabaseClient){
  const jar=await cookies(),code=jar.get(PENDING)?.value;
  if(!code)return '/app';
  jar.set(PENDING,'',{httpOnly:true,path:'/auth',maxAge:0});
  const {data:{user},error}=await client.auth.getUser();
  return !error&&user?acceptInvite(user,code):invitePath(code);
}
