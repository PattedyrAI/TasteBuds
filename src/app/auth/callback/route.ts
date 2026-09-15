import { authClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
export async function GET(request:Request) {
  const url=new URL(request.url);const origin=process.env.APP_URL || url.origin;
  const code=url.searchParams.get('code');
  if(code){const client=await authClient();const {error}=await client.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL('/app',origin));}
  return NextResponse.redirect(new URL('/?error=login',origin));
}
