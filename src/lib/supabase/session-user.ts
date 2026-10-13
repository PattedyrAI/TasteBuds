import {createServerClient,type GetAllCookies,type SetAllCookies} from '@supabase/ssr';
import {authTemporarilyUnavailable} from './auth-errors';

/** A temporary refresh failure must not commit the SDK's session deletion. */
export async function getSessionUser(cookies:{getAll:GetAllCookies;setAll:SetAllCookies}){
  const writes:Parameters<SetAllCookies>[0]=[];
  const headers:Record<string,string>={};
  let refreshed=false;
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    global:{fetch:async(input,init)=>{
      const response=await fetch(input,init);
      if(response.status!==429&&response.status<500)return response;
      // Preserve the transport status when a gateway sends an HTML error page.
      const safeHeaders=new Headers(response.headers);
      safeHeaders.set('Content-Type','application/json');
      safeHeaders.delete('Content-Length');safeHeaders.delete('Content-Encoding');
      await response.body?.cancel();
      return new Response(JSON.stringify({msg:'Authentication is temporarily unavailable.'}),{status:response.status,statusText:response.statusText,headers:safeHeaders});
    }},
    cookies:{getAll:cookies.getAll,setAll:(values,cacheHeaders)=>{writes.push(...values);Object.assign(headers,cacheHeaders);}},
  });
  const {data:{subscription}}=client.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')refreshed=true;});
  try{
    const result=await client.auth.getUser();
    // Keep a successfully rotated token even if the subsequent user lookup fails.
    if(writes.length&&(!authTemporarilyUnavailable(result.error)||refreshed))await cookies.setAll(writes,headers);
    return result;
  }finally{subscription.unsubscribe();}
}
