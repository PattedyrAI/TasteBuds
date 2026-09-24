import {query,transaction} from './db';
import {HttpError} from './auth';
import {decryptWebhook,encryptWebhook,makeRatingEmbed} from './discord-format';
import {z} from 'zod';
import {requireMembership} from './service';

export async function connectDiscord(userId:string,groupId:string,input:unknown){
  z.uuid().parse(groupId);const v=z.object({url:z.string().max(400).optional(),enabled:z.boolean(),route:z.enum(['all','energy_drinks','food']).default('all'),categoryIds:z.array(z.uuid()).max(500).optional()}).strict().parse(input);
  let encrypted:string|undefined;
  if(v.url){try{encrypted=encryptWebhook(v.url,process.env.DISCORD_ENCRYPTION_KEY||'');}catch{throw new HttpError('Enter a valid Discord channel webhook URL.',400);}}
  return transaction(async tx=>{
    // Serialize configuration with rating creation, avoiding overlapping destinations.
    await tx.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[groupId]);
    await requireMembership(tx,userId,groupId,true);
    const existing=await tx.query<{category_ids:string[]}>('SELECT category_ids FROM everrate.discord_connections WHERE group_id=$1 AND route=$2',[groupId,v.route]);
    const categoryIds=[...new Set(v.categoryIds??existing.rows[0]?.category_ids??[])];
    if(v.route==='all'&&categoryIds.length)throw new HttpError('The all-reviews connection cannot filter categories.',400);
    if(v.route!=='all'&&v.enabled&&!categoryIds.length)throw new HttpError('Choose the categories for this channel.',400);
    if(categoryIds.length){
      const categories=await tx.query('SELECT id FROM everrate.item_types WHERE group_id=$1 AND id=ANY($2::uuid[])',[groupId,categoryIds]);
      if(categories.rowCount!==categoryIds.length)throw new HttpError('Choose categories from this group.',400);
    }
    if(v.enabled){
      const overlap=await tx.query("SELECT 1 FROM everrate.discord_connections WHERE group_id=$1 AND route<>$2 AND enabled AND ($2='all' OR route='all' OR category_ids && $3::uuid[])",[groupId,v.route,categoryIds]);
      if(overlap.rowCount)throw new HttpError('These categories already share to another channel. Disable or update that connection first.',409);
    }
    if(encrypted)await tx.query('INSERT INTO everrate.discord_connections(group_id,route,category_ids,webhook_encrypted,enabled,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_id,route) DO UPDATE SET category_ids=$3,webhook_encrypted=$4,enabled=$5,updated_by=$6,updated_at=now()',[groupId,v.route,categoryIds,encrypted,v.enabled,userId]);
    else {const r=await tx.query('UPDATE everrate.discord_connections SET category_ids=$3,enabled=$4,updated_by=$5,updated_at=now() WHERE group_id=$1 AND route=$2',[groupId,v.route,categoryIds,v.enabled,userId]);if(!r.rowCount&&v.enabled)throw new HttpError('Add a Discord channel connection first.',400);}
    await tx.query(`UPDATE everrate.discord_outbox o SET status='cancelled' WHERE o.group_id=$1 AND o.route=$2 AND o.status IN ('pending','processing','failed')
      AND (NOT $3::boolean OR ($2<>'all' AND NOT EXISTS(SELECT 1 FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id AND i.group_id=r.group_id WHERE r.id=o.rating_id AND r.group_id=o.group_id AND i.type_id=ANY($4::uuid[]))))`,[groupId,v.route,v.enabled,categoryIds]);
    await tx.query("INSERT INTO everrate.audit_events(group_id,actor_id,action,details) VALUES($1,$2,'discord.connection.updated',$3)",[groupId,userId,{enabled:v.enabled,route:v.route,categoryIds}]);
    return {connected:v.enabled};
  });
}

export async function processDiscordOutbox(){
  const claimed=await transaction(async tx=>{
    const r=await tx.query<{id:string}>("SELECT o.id FROM everrate.discord_outbox o JOIN everrate.discord_connections c USING(group_id,route) WHERE c.enabled=true AND ((o.status='pending' AND o.next_attempt_at<=now()) OR (o.status='processing' AND o.locked_at<now()-interval '2 minutes')) ORDER BY o.created_at LIMIT 3 FOR UPDATE OF o SKIP LOCKED");
    const claims:{id:string;attempts:number}[]=[];
    for(const row of r.rows){
      const result=await tx.query<{id:string;attempts:number}>("UPDATE everrate.discord_outbox SET status='processing',locked_at=now(),attempts=attempts+1 WHERE id=$1 RETURNING id,attempts",[row.id]);
      claims.push(result.rows[0]);
    }
    return claims;
  });
  for(const row of claimed){
    // Recheck each entry after earlier sends: a disconnect, rotation, deletion or
    // replacement worker may have invalidated the original batch claim.
    const current=await query<{webhook_encrypted:string;payload:{itemName:string;authorName:string;score:number;note?:string|null;itemId:string}}>(
      "SELECT o.payload,c.webhook_encrypted FROM everrate.discord_outbox o JOIN everrate.discord_connections c USING(group_id,route) JOIN everrate.ratings r ON r.id=o.rating_id AND r.group_id=o.group_id JOIN everrate.items i ON i.id=r.item_id AND i.group_id=r.group_id WHERE o.id=$1 AND o.status='processing' AND o.attempts=$2 AND c.enabled=true AND r.deleted_at IS NULL AND r.source='app' AND (c.route='all' OR i.type_id=ANY(c.category_ids))",[row.id,row.attempts]);
    if(!current.rowCount){await query("UPDATE everrate.discord_outbox SET status='cancelled' WHERE id=$1 AND status='processing' AND attempts=$2",[row.id,row.attempts]);continue;}
    const {webhook_encrypted,payload}=current.rows[0];
    let retry=30,status='failed';
    try {
      const url=decryptWebhook(webhook_encrypted,process.env.DISCORD_ENCRYPTION_KEY||'');
      // No database transaction spans HTTP. A change committed after the final
      // eligibility read can still race with this send; Discord cannot recall an
      // already-started request. Later entries always perform their own fresh check.
      const r=await fetch(url+'?wait=true',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15_000),body:JSON.stringify(makeRatingEmbed({...payload,displayName:payload.authorName},process.env.APP_URL!))});
      if(r.ok){await query("UPDATE everrate.discord_outbox SET status='sent',sent_at=now(),last_error=null WHERE id=$1 AND status='processing' AND attempts=$2",[row.id,row.attempts]);continue;}
      status=`discord_${r.status}`;
      if(r.status===429)retry=Math.min(3600,Math.max(1,Number(r.headers.get('retry-after'))||30));
      else if(r.status>=400&&r.status<500)retry=-1;
    }catch{status='delivery_failed';}
    const terminal=retry<0||row.attempts>=5;
    await query("UPDATE everrate.discord_outbox SET status=$2,last_error=$3,next_attempt_at=now()+($4 * interval '1 second') WHERE id=$1 AND status='processing' AND attempts=$5",[row.id,terminal?'failed':'pending',status,retry<0?0:Math.max(retry,2**(row.attempts-1)*10),row.attempts]);
  }
}
