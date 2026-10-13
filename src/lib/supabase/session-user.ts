import {createServerClient,type GetAllCookies,type SetAllCookies} from '@supabase/ssr';
import {authTemporarilyUnavailable} from './auth-errors';

/** A temporary refresh failure must not commit the SDK's session deletion. */
export async function getSessionUser(cookies:{getAll:GetAllCookies;setAll:SetAllCookies}){
  const writes:Parameters<SetAllCookies>[0]=[];
  const headers:Record<string,string>={};
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    cookies:{getAll:cookies.getAll,setAll:(values,cacheHeaders)=>{writes.push(...values);Object.assign(headers,cacheHeaders);}},
  });
  const result=await client.auth.getUser();
  if(!authTemporarilyUnavailable(result.error)&&writes.length)await cookies.setAll(writes,headers);
  return result;
}
