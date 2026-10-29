import { authClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { acceptPendingInvite, takePendingInvite } from '@/server/invite-links';
export async function GET(request:Request) {
  const url=new URL(request.url);const origin=process.env.APP_URL || url.origin;
  const code=url.searchParams.get('code'),invite=await takePendingInvite();
  if(code){const client=await authClient();const {error}=await client.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(await acceptPendingInvite(client,invite),origin));}
  return NextResponse.redirect(new URL('/?error=login',origin));
}
