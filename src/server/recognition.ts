import {query,transaction} from './db';
import {getPhoto} from './photos';
import {findItemMatches} from './item-matches';
import {HttpError} from './auth';
import {normalizeSuggestion,recognitionPrompt,recognitionJsonSchema} from './recognition-format';
import type {RecognitionResult,RecognitionSuggestion} from '@/lib/contracts';
const PROMPT_VERSION='everrate-2-photo-identity';

export async function detectImage(data:Buffer,mimeType:string){
  if(!process.env.GEMINI_API_KEY)throw new Error('not_configured');
  const model=process.env.GEMINI_MODEL||'gemini-3.1-flash-lite';
  if(!/^gemini-[a-z0-9.-]+$/.test(model))throw new Error('invalid_model');
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},signal:AbortSignal.timeout(30_000),
    body:JSON.stringify({contents:[{role:'user',parts:[{text:recognitionPrompt},{inlineData:{mimeType,data:data.toString('base64')}}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:recognitionJsonSchema,temperature:0,maxOutputTokens:1000,thinkingConfig:{thinkingLevel:'minimal'}}})
  });
  if(!response.ok)throw new Error(`provider_${response.status}`);
  const payload=await response.json();const text=payload.candidates?.[0]?.content?.parts?.filter((p:{text?:string;thought?:boolean})=>p.text&&!p.thought).map((p:{text:string})=>p.text).join('');
  if(!text)throw new Error('unrecognised');
  return {suggestion:normalizeSuggestion(JSON.parse(text)),inputTokens:payload.usageMetadata?.promptTokenCount??null,outputTokens:(payload.usageMetadata?.candidatesTokenCount??0)+(payload.usageMetadata?.thoughtsTokenCount??0),model};
}
export async function recognize(userId:string,photoId:string):Promise<RecognitionResult>{
  const photo=await getPhoto(userId,photoId),model=process.env.GEMINI_MODEL||'gemini-3.1-flash-lite';
  if(photo.owner_id!==userId)throw new HttpError('Choose your own photo for recognition.',403);
  const reservation=await transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recognition-photo:${photo.group_id}:${photo.sha256}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recognition:${userId}`]);
    const cached=await tx.query("SELECT result FROM everrate.recognition_jobs WHERE group_id=$1 AND photo_hash=$2 AND model=$3 AND prompt_version=$4 AND status='completed' ORDER BY created_at DESC LIMIT 1",[photo.group_id,photo.sha256,model,PROMPT_VERSION]);
    if(cached.rowCount)return {cached:cached.rows[0].result as RecognitionSuggestion,id:null};
    const pending=await tx.query("SELECT id FROM everrate.recognition_jobs WHERE group_id=$1 AND photo_hash=$2 AND model=$3 AND prompt_version=$4 AND status='processing' AND created_at>now()-interval '2 minutes' LIMIT 1",[photo.group_id,photo.sha256,model,PROMPT_VERSION]);
    if(pending.rowCount)return {cached:null,id:null};
    const count=await tx.query("SELECT count(*)::int n FROM everrate.recognition_jobs WHERE user_id=$1 AND created_at>now()-interval '1 day'",[userId]);
    const cap=Math.min(100,Math.max(1,Number(process.env.RECOGNITION_DAILY_LIMIT)||30));
    if(count.rows[0].n>=cap)throw new HttpError('Daily recognition limit reached. Fill in the item details to continue.',429);
    const row=await tx.query("INSERT INTO everrate.recognition_jobs(group_id,user_id,photo_id,photo_hash,model,prompt_version,status) VALUES($1,$2,$3,$4,$5,$6,'processing') RETURNING id",[photo.group_id,userId,photo.id,photo.sha256,model,PROMPT_VERSION]);
    return {cached:null,id:row.rows[0].id as string};
  });
  if(!reservation.cached&&!reservation.id)return {status:'failed',suggestion:null,matches:[],message:'This photo is already being read. Wait a moment, or fill in the details yourself.'};
  let suggestion=reservation.cached;
  if(!suggestion){
    try {const result=await detectImage(photo.data,photo.mime_type);suggestion=result.suggestion;
      await query("UPDATE everrate.recognition_jobs SET status='completed',result=$2,input_tokens=$3,output_tokens=$4,completed_at=now() WHERE id=$1",[reservation.id,suggestion,result.inputTokens,result.outputTokens]);
    }catch(error){
      const failure=error instanceof Error&&/^provider_\d+$|not_configured|unrecognised|invalid_model$/.test(error.message)?error.message:'recognition_failed';
      await query("UPDATE everrate.recognition_jobs SET status='failed',failure_class=$2,completed_at=now() WHERE id=$1",[reservation.id,failure]);
      return {status:'failed',suggestion:null,matches:[],message:'We could not identify this photo. Fill in what you know and save your rating.'};
    }
  }
  const matches=await findItemMatches(userId,photo.group_id,suggestion);
  return {status:'completed',suggestion,matches};
}
