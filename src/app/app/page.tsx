import {redirect} from 'next/navigation';
import {authClient} from '@/lib/supabase/server';
import {AppClient} from '@/components/app-client';
export default async function App(){const client=await authClient();const {data:{user}}=await client.auth.getUser();if(!user)redirect('/');return <AppClient/>;}
