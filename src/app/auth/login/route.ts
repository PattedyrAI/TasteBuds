import { authClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
export async function GET(request: Request) {
  const origin=process.env.APP_URL || new URL(request.url).origin;
  const client=await authClient();
  const {data,error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:`${origin}/auth/callback`}});
  if(error || !data.url)return NextResponse.redirect(new URL('/?error=login',origin));
  return NextResponse.redirect(data.url);
}
