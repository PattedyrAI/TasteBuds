import { authClient } from '@/lib/supabase/server';
import { ensureUser } from './service';
import {ZodError} from 'zod';

export class HttpError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function requireUser() {
  const client=await authClient();
  const {data:{user},error}=await client.auth.getUser();
  if(error || !user) throw new HttpError('Sign in to continue.',401);
  const identities=user.identities?.filter(identity=>identity.provider==='discord')||[];
  // GoTrue serializes provider_id as `id`; `identity_id` is its internal row UUID.
  // Use only getUser-validated identity fields, never editable user_metadata/sub/email.
  if(!identities.length||identities.some(identity=>identity.user_id!==user.id||!/^\d{1,30}$/.test(identity.id))||new Set(identities.map(identity=>identity.id)).size!==1)throw new HttpError('Sign in with your Discord account to continue.',401);
  const account=await ensureUser({id:user.id,discordId:identities[0].id,displayName:String(user.user_metadata?.full_name || user.user_metadata?.name || 'Member').slice(0,100),avatarUrl:typeof user.user_metadata?.avatar_url==='string'?user.user_metadata.avatar_url:null});
  return account.id;
}
export function requireSameOrigin(request: Request) {
  if(['GET','HEAD','OPTIONS'].includes(request.method))return;
  const expected=new URL(process.env.APP_URL || request.url).origin;
  if(request.headers.get('origin')!==expected)throw new HttpError('This request could not be verified. Refresh and try again.',403);
}
export async function api(request:Request, operation:(userId:string)=>Promise<unknown>) {
  try {
    requireSameOrigin(request);
    const userId=await requireUser();
    return Response.json(await operation(userId),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {
    const status=error instanceof ZodError?400:error && typeof error==='object' && 'status' in error && typeof error.status==='number'?error.status:500;
    const message=error instanceof ZodError?'Check the details and try again.':status>=500?'Something went wrong. Please try again.':error instanceof Error?error.message:'Invalid request.';
    if(status>=500)console.error('Request failed',{kind:error instanceof Error?error.name:'Unknown'});
    return Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
  }
}
