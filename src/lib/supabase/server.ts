import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {getSessionUser} from './session-user';

export async function sessionUser(){
  const jar=await cookies();
  return getSessionUser({
    getAll:()=>jar.getAll(),
    setAll:values=>{try{values.forEach(({name,value,options})=>jar.set(name,value,options));}catch{/* Proxy commits cookies for server components. */}},
  });
}

export async function authClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => { try { values.forEach(({name,value,options}) => jar.set(name,value,options)); } catch { /* Proxy handles refresh for server components. */ } }
    }
  });
}
