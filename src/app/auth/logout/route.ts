import { authClient } from '@/lib/supabase/server';
import { requireSameOrigin } from '@/server/auth';
export async function POST(request:Request) {
  try {requireSameOrigin(request);const client=await authClient();await client.auth.signOut();return Response.json({ok:true});}
  catch{return Response.json({error:'Could not sign out.'},{status:403});}
}
