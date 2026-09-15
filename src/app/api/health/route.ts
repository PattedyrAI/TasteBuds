import {query} from '@/server/db';
export async function GET(){
  try{await query('SELECT id FROM everrate.groups LIMIT 1');return Response.json({status:'ok',app:'TasteBuds',version:process.env.APP_RELEASE||process.env.RAILWAY_GIT_COMMIT_SHA||'1.0.0'},{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({status:'unavailable'},{status:503});}
}
