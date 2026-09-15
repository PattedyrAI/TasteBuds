import {query,transaction} from './db';
import {HttpError} from './auth';
import {decryptWebhook,encryptWebhook,makeRatingEmbed} from './discord-format';
import {z} from 'zod';
import {requireMembership} from './service';

export async function connectDiscord(userId:string,groupId:string,input:unknown){
  z.uuid().parse(groupId);const v=z.object({url:z.string().max(400).optional(),enabled:z.boolean()}).parse(input);
  let encrypted:string|undefined;
  if(v.url){try{encrypted=encryptWebhook(v.url,process.env.DISCORD_ENCRYPTION_KEY||'');}catch{throw new HttpError('Enter a valid Discord channel webhook URL.',400);}}
  return transaction(async tx=>{
    await requireMembership(tx,userId,groupId,true);
    if(encrypted)await tx.query('INSERT INTO everrate.discord_connections(group_id,webhook_encrypted,enabled,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(group_id) DO UPDATE SET webhook_encrypted=$2,enabled=$3,updated_by=$4,updated_at=now()',[groupId,encrypted,v.enabled,userId]);
    else {const r=await tx.query('UPDATE everrate.discord_connections SET enabled=$2,updated_by=$3,updated_at=now() WHERE group_id=$1',[groupId,v.enabled,userId]);if(!r.rowCount && v.enabled)throw new HttpError('Add a Discord channel connection first.',400);}
    if(!v.enabled)await tx.query("UPDATE everrate.discord_outbox SET status='cancelled' WHERE group_id=$1 AND status IN ('pending','processing')",[groupId]);
    await tx.query("INSERT INTO everrate.audit_events(group_id,actor_id,action,details) VALUES($1,$2,'discord.connection.updated',$3)",[groupId,userId,{enabled:v.enabled}]);
    return {connected:v.enabled};
  });
}

export async function processDiscordOutbox(){
  const claimed=await transaction(async tx=>{
    const r=await tx.query<{id:string}>("SELECT o.id FROM everrate.discord_outbox o JOIN everrate.discord_connections c USING(group_id) WHERE c.enabled=true AND ((o.status='pending' AND o.next_attempt_at<=now()) OR (o.status='processing' AND o.locked_at<now()-interval '2 minutes')) ORDER BY o.created_at LIMIT 3 FOR UPDATE OF o SKIP LOCKED");
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
      "SELECT o.payload,c.webhook_encrypted FROM everrate.discord_outbox o JOIN everrate.discord_connections c USING(group_id) JOIN everrate.ratings r ON r.id=o.rating_id WHERE o.id=$1 AND o.status='processing' AND o.attempts=$2 AND c.enabled=true AND r.deleted_at IS NULL",[row.id,row.attempts]);
    if(!current.rowCount)continue;
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
