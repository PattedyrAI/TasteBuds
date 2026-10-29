import {NextResponse} from 'next/server';
import {authClient,sessionUser} from '@/lib/supabase/server';
import {authTemporarilyUnavailable} from '@/lib/supabase/auth-errors';
import {requireSameOrigin} from '@/server/auth';
import {readBodyText} from '@/server/request-body';
import {previewInvite} from '@/server/service';
import {acceptInvite,invitePath,rememberInvite} from '@/server/invite-links';
/** The invite page's button: join now when signed in, otherwise sign in with Discord and join on return. */
export async function POST(request:Request){
  const origin=process.env.APP_URL || new URL(request.url).origin;
  const go=(path:string)=>NextResponse.redirect(new URL(path,origin),303);
  let code:string;
  try{requireSameOrigin(request);code=new URLSearchParams(await readBodyText(request,1_000)).get('code')?.trim()??'';}catch{return go('/');}
  if(!(await previewInvite(code)))return go(code&&code.length<=100?invitePath(code):'/');
  const {data:{user},error}=await sessionUser();
  if(user&&!error)return go(await acceptInvite(user,code));
  if(authTemporarilyUnavailable(error))return go(`${invitePath(code)}?error=auth`);
  const client=await authClient();
  const {data,error:oauthError}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:`${origin}/auth/callback`}});
  if(oauthError || !data.url)return go(`${invitePath(code)}?error=auth`);
  await rememberInvite(code,new URL(origin).protocol==='https:');
  return NextResponse.redirect(data.url,303);
}
