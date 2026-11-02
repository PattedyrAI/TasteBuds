import { authClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { acceptPendingInvite, invitePath, takePendingInvite } from '@/server/invite-links';
export async function GET(request:Request) {
  const url=new URL(request.url);const origin=process.env.APP_URL || url.origin;
  const code=url.searchParams.get('code'),invite=await takePendingInvite();
  const providerError=url.searchParams.get('error');
  if(providerError){
    const emailMissing=url.searchParams.get('error_description')==='Error getting user email from external provider';
    return NextResponse.redirect(new URL(`${invite?invitePath(invite):'/'}?error=${emailMissing?'email':invite?'auth':'login'}`,origin));
  }
  if(code){const client=await authClient();const {error}=await client.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(await acceptPendingInvite(client,invite),origin));}
  return NextResponse.redirect(new URL(invite?`${invitePath(invite)}?error=auth`:'/?error=login',origin));
}
