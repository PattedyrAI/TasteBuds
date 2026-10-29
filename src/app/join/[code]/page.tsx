import type {Metadata} from 'next';
import Link from 'next/link';
import {ArrowUpRight,Users} from 'lucide-react';
import {sessionUser} from '@/lib/supabase/server';
import {previewInvite} from '@/server/service';
type Props={params:Promise<{code:string}>;searchParams:Promise<{error?:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
  const invite=await previewInvite((await params).code);
  return {title:invite?`Join ${invite.name} on TasteBuds`:'TasteBuds invite',robots:{index:false,follow:false}};
}
export default async function Join({params,searchParams}:Props){
  const [{code},{error}]=await Promise.all([params,searchParams]);
  const [invite,{data:{user}}]=await Promise.all([previewInvite(code),sessionUser()]);
  const header=<header className="welcome-header"><Link className="wordmark" href="/"><img className="brand-mark" src="/brand-mark.svg" alt="" width="32" height="32"/>TasteBuds</Link></header>;
  if(!invite)return <main className="welcome">{header}<section className="welcome-main join-main"><div className="welcome-copy"><h1>This invite link doesn’t work anymore.</h1><p>The group may have made a new link. Ask whoever invited you for a fresh one.</p><a className="button primary large" href={user?'/app':'/'}>Go to TasteBuds <ArrowUpRight size={19}/></a></div></section></main>;
  return <main className="welcome">{header}<section className="welcome-main join-main"><div className="welcome-copy"><div className="welcome-badge"><Users size={16}/> You’re invited</div><h1>Join {invite.name}</h1><p>{user?'You’re signed in. Join to see what the group has tried and add your own ratings.':'Sign in with Discord and you’ll go straight into the group.'}</p>
    <form method="post" action="/auth/join"><input type="hidden" name="code" value={code}/><button className="button primary large">{user?'Join group':'Join with Discord'} <ArrowUpRight size={19}/></button></form>
    {error&&<p role="alert" className="error">{error==='auth'?'Sign-in is temporarily unavailable. Try again in a moment.':'We couldn’t add you to the group. Try again, or ask for a fresh invite link.'}</p>}
    <span className="fine-print">Groups are private. Only people with this link can join.</span></div></section></main>;
}
