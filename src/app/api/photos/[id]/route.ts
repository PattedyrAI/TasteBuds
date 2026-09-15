import {requireUser} from '@/server/auth';
import {getPhoto} from '@/server/photos';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const userId=await requireUser();const photo=await getPhoto(userId,(await params).id);return new Response(new Uint8Array(photo.data),{headers:{'Content-Type':photo.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
  catch{return Response.json({error:'Photo not found.'},{status:404});}
}
