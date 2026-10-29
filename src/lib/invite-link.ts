export const inviteLink=(origin:string,code:string)=>`${origin}/join/${encodeURIComponent(code)}`;
/** Accept either a pasted invite link or the bare code. */
export function inviteCode(input:string){
  const value=input.trim(),match=/\/join\/([^/?#\s]+)/.exec(value);
  if(!match)return value;
  try{return decodeURIComponent(match[1]);}catch{return match[1];}
}
