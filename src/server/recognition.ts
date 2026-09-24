import {query,transaction,getPool,type Db} from './db';
import {validId} from './services/common';
import {getPhoto} from './photos';
import {findItemMatches} from './item-matches';
import {HttpError} from './auth';
import {normalizeSuggestion,recognitionPrompt,recognitionJsonSchema} from './recognition-format';
import type {RecognitionResult,RecognitionSuggestion} from '@/lib/contracts';
const PROMPT_VERSION='everrate-2-photo-identity';

function recognitionFailure(error:unknown){
  if(error instanceof HttpError&&error.status===403)return 'ai_disabled';
  if(error instanceof Error){
    if(error.name==='TimeoutError'||error.name==='AbortError')return 'provider_timeout';
    if(/^(provider_[1-5]\d{2}|not_configured|unrecognised|invalid_model)$/.test(error.message))return error.message;
    if(error instanceof SyntaxError||error.name==='ZodError')return 'invalid_response';
  }
  return 'recognition_failed';
}
function recognitionFailureMessage(failure:string){
  const fallback=' Your photo is still attached. Fill in the details manually and save your rating.';
  switch(failure){
    case 'provider_402':return 'AI suggestions are unavailable because the AI service needs a billing top-up.'+fallback;
    case 'provider_429':return 'AI suggestions are temporarily rate-limited. Try again later.'+fallback;
    case 'provider_timeout':return 'AI suggestions took too long. Try again later.'+fallback;
    case 'provider_401':case 'provider_403':case 'provider_404':case 'not_configured':case 'invalid_model':
      return 'AI suggestions are unavailable due to a service configuration problem.'+fallback;
    case 'unrecognised':return 'AI could not identify this photo.'+fallback;
    default:return 'AI suggestions are temporarily unavailable. Try again later.'+fallback;
  }
}

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
async function requireAiEnabled(userId:string,db:Db=getPool()){
  validId(userId);const account=await db.query('SELECT ai_enabled FROM everrate.users WHERE id=$1',[userId]);
  if(account.rows[0]?.ai_enabled!==true)throw new HttpError('AI assistance is disabled. Enable it in your preferences to use photo recognition.',403);
}
export async function recognize(userId:string,photoId:string):Promise<RecognitionResult>{
  await requireAiEnabled(userId);
  const photo=await getPhoto(userId,photoId),model=process.env.GEMINI_MODEL||'gemini-3.1-flash-lite';
  if(photo.owner_id!==userId)throw new HttpError('Choose your own photo for recognition.',403);
  const reservation=await transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recognition-photo:${photo.group_id}:${photo.sha256}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recognition:${userId}`]);
    await requireAiEnabled(userId,tx);
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
    const started=Date.now();
    try {await requireAiEnabled(userId);const result=await detectImage(photo.data,photo.mime_type);suggestion=result.suggestion;
      await query("UPDATE everrate.recognition_jobs SET status='completed',result=$2,input_tokens=$3,output_tokens=$4,completed_at=now() WHERE id=$1",[reservation.id,suggestion,result.inputTokens,result.outputTokens]);
    }catch(error){
      const failure=recognitionFailure(error);
      // Only fixed codes and job correlation; never log photos, keys or provider response bodies.
      console.warn('Photo recognition failed',{jobId:reservation.id,model:/^gemini-[a-z0-9.-]{1,80}$/.test(model)?model:'invalid_model',failureClass:failure,durationMs:Date.now()-started});
      await query("UPDATE everrate.recognition_jobs SET status='failed',failure_class=$2,completed_at=now() WHERE id=$1",[reservation.id,failure]);
      if(error instanceof HttpError&&error.status===403)throw error;
      return {status:'failed',suggestion:null,matches:[],message:recognitionFailureMessage(failure)};
    }
  }
  const matches=await findItemMatches(userId,photo.group_id,suggestion);
  return {status:'completed',suggestion,matches};
}
