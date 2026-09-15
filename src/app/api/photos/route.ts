import {api} from '@/server/auth';
import {readImageBody,uploadPhoto} from '@/server/photos';
export async function POST(request:Request){return api(request,async id=>uploadPhoto(id,new URL(request.url).searchParams.get('groupId')||'',await readImageBody(request)));}
