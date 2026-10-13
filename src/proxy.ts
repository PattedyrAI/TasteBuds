import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({request});
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !request.cookies.getAll().some(c=>c.name.startsWith('sb-'))) return response;
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    cookies: {
      getAll:()=>request.cookies.getAll(),
      setAll:(values)=>{
        values.forEach(({name,value})=>request.cookies.set(name,value));
        response=NextResponse.next({request});
        values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      }
    }
  });
  const {data:{user},error}=await client.auth.getUser();
  const identities=user?.identities?.filter(identity=>identity.provider==='discord')||[];
  const verifiedDiscord=!error&&user&&identities.length>0&&identities.every(identity=>identity.user_id===user.id&&/^\d{1,30}$/.test(identity.id))&&new Set(identities.map(identity=>identity.id)).size===1;
  if(verifiedDiscord&&(request.nextUrl.pathname==='/'||request.nextUrl.pathname==='/auth/login')){
    const redirect=NextResponse.redirect(new URL('/app',request.url));
    // The redirect must carry the refreshed cookies, including removed chunks.
    response.cookies.getAll().forEach(cookie=>redirect.cookies.set(cookie));
    response=redirect;
  }
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config={matcher:['/','/app/:path*','/api/:path*','/auth/:path*']};
