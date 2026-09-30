import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export function validateWebhook(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:' || !['discord.com','discordapp.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !/^\/api\/webhooks\/\d{17,22}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname))throw new Error('Enter a valid Discord channel webhook URL.');
  return url.toString();
}
function keyBuffer(key:string){if(!/^[a-f0-9]{64}$/i.test(key))throw new Error('Discord encryption is not configured.');return Buffer.from(key,'hex');}
export function encryptWebhook(value:string,key:string){
  validateWebhook(value);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBuffer(key),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function decryptWebhook(value:string,key:string){
  const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));
  if(!iv||!tag||!data)throw new Error('Invalid encrypted connection.');
  const decipher=createDecipheriv('aes-256-gcm',keyBuffer(key),iv);decipher.setAuthTag(tag);
  return validateWebhook(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));
}
type RatingEmbedInput={itemName:string;brand?:string|null;variant?:string|null;displayName:string;score:number;note?:string|null;itemId:string;photoFilename?:string;category?:string;groupName?:string|null;ratedAt?:string|null};
// The sidebar colour carries the verdict so a channel can be skimmed by score.
function scoreColor(score:number){return score>=8?0x2fb466:score>=5?0xe8a33d:0xe5484d;}
function scoreBar(score:number){const filled=Math.max(0,Math.min(10,Math.round(score)));return (score>=8?'🟩':score>=5?'🟧':'🟥').repeat(filled)+'⬛'.repeat(10-filled);}
export function makeRatingEmbed(r:RatingEmbedInput,origin:string){
  const url=`${origin}/app?item=${encodeURIComponent(r.itemId)}`;
  const reviewer=r.displayName.slice(0,100)||'TasteBuds member';
  const brand=r.brand?.trim();
  // Items store the model without its brand, so "Original" alone reads as nothing.
  const name=brand&&!r.itemName.toLowerCase().startsWith(brand.toLowerCase())?`${brand} ${r.itemName}`:r.itemName;
  const title=(r.variant?.trim()?`${name} · ${r.variant.trim()}`:name).slice(0,200);
  const note=(r.note||'').trim().slice(0,1500);
  const date=r.ratedAt?new Date(r.ratedAt):null;
  return {allowed_mentions:{parse:[]},embeds:[{
    author:{name:r.category?`${reviewer} · ${r.category}`:reviewer},
    title,url,color:scoreColor(r.score),
    ...(note?{description:note.split('\n').map(line=>`> ${line}`).join('\n')}:{}),
    fields:[{name:'Score',value:`**${r.score} / 10**\n${scoreBar(r.score)}`,inline:false}],
    ...(r.photoFilename?{image:{url:`attachment://${r.photoFilename}`}}:{}),
    footer:{text:r.groupName?`TasteBuds · ${r.groupName.slice(0,100)}`:'TasteBuds'},
    ...(date&&!Number.isNaN(date.getTime())?{timestamp:date.toISOString()}:{}),
  }],components:[{type:1,components:[{type:2,style:5,label:'Open in TasteBuds',url}]}]};
}
