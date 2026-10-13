import {redirect} from 'next/navigation';
import {sessionUser} from '@/lib/supabase/server';
import {authTemporarilyUnavailable} from '@/lib/supabase/auth-errors';
import {AppClient} from '@/components/app-client';
export default async function App(){
  const {data:{user},error}=await sessionUser();
  if(authTemporarilyUnavailable(error))return <main className="welcome"><section className="welcome-main"><div className="welcome-copy"><h1>Couldn't reconnect right now.</h1><p role="alert">Sign-in is temporarily unavailable. Your saved session hasn't been cleared. Try again in a moment.</p><a className="button primary" href="/app">Try again</a></div></section></main>;
  if(!user)redirect('/');
  return <AppClient/>;
}
