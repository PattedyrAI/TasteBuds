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
export function makeRatingEmbed(r:{itemName:string;displayName:string;score:number;note?:string|null;itemId:string;photoFilename?:string;category?:string},origin:string){
  const url=`${origin}/app?item=${encodeURIComponent(r.itemId)}`;
  return {allowed_mentions:{parse:[]},embeds:[{
    author:{name:r.category?`TasteBuds · ${r.category}`:'TasteBuds'},
    title:r.itemName.slice(0,180),description:(r.note||'').slice(0,1500),color:0x3157d5,
    fields:[{name:'TASTE SCORE',value:`${r.score} / 10`,inline:true},{name:'REVIEWED BY',value:r.displayName.slice(0,100)||'TasteBuds member',inline:true}],
    ...(r.photoFilename?{image:{url:`attachment://${r.photoFilename}`}}:{}),
    footer:{text:`Rated by ${r.displayName.slice(0,100)} on TasteBuds`},url,
  }],components:[{type:1,components:[{type:2,style:5,label:'Open TasteBuds',url}]}]};
}
