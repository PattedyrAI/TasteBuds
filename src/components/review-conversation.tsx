'use client';
import {useId,useRef,useState} from 'react';
import {LoaderCircle,MessageCircle,MoreHorizontal,Pencil,Send,Trash2} from 'lucide-react';
import type {Comment,User} from '@/lib/contracts';
import {Avatar,request} from './ui';

export function ReviewConversation({ratingId,comments,user,owner,person,onChange}:{ratingId:string;comments:Comment[];user:User;owner:boolean;person?:(id:string)=>void;onChange:(comments:Comment[])=>void}){
  const headingId=useId(),inputId=useId(),hintId=useId();
  const input=useRef<HTMLTextAreaElement>(null),inFlight=useRef(false);
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [menu,setMenu]=useState<string|null>(null),[removing,setRemoving]=useState<string|null>(null);
  const [editing,setEditing]=useState<{id:string;body:string}|null>(null);
  async function run(work:()=>Promise<void>){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setStatus('');
    try{await work();}catch(e){setError(e instanceof Error?e.message:'Could not save. Try again.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function send(){
    if(!draft.trim()||busy)return;
    void run(async()=>{
      const added=await request<Comment>(`/api/ratings/${ratingId}/comments`,'POST',{body:draft.trim()});
      onChange([...comments,added]);setDraft('');setStatus('Comment sent');input.current?.focus();
    });
  }
  return <section className="review-conversation" aria-labelledby={headingId} onKeyDown={event=>{if(event.key==='Escape'&&menu){event.preventDefault();event.stopPropagation();setMenu(null);}}}>
    <header className="conversation-heading"><h4 id={headingId}><MessageCircle size={17}/> Conversation <span>{comments.length}</span></h4></header>
    {comments.length?<ol className="conversation-messages">{comments.map(comment=>{
      const own=comment.author.id===user.id,canManage=own||owner;
      return <li className={`conversation-message${own?' is-own':''}`} key={comment.id}>
        <Avatar name={comment.author.displayName} url={comment.author.avatarUrl}/>
        <div className="conversation-bubble">
          <header className="conversation-meta">
            {person?<button type="button" className="conversation-author" onClick={()=>person(comment.author.id)}>{comment.author.displayName}</button>:<strong>{comment.author.displayName}</strong>}
            {own&&<span className="conversation-you">You</span>}
            <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{new Date(comment.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · {new Date(comment.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time>
            {canManage&&<button type="button" className="conversation-menu-toggle" disabled={busy} aria-label={`Options for ${comment.author.displayName}'s comment`} aria-expanded={menu===comment.id} onClick={()=>setMenu(menu===comment.id?null:comment.id)}><MoreHorizontal size={20}/></button>}
          </header>
          {menu===comment.id&&<div className="conversation-options" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMenu(null);}}}>
            {own&&<button type="button" disabled={busy} onClick={()=>{setEditing({id:comment.id,body:comment.body});setMenu(null);setRemoving(null);}}><Pencil size={14}/> Edit</button>}
            <button type="button" className="danger" disabled={busy} onClick={()=>{setRemoving(comment.id);setMenu(null);setEditing(null);}}><Trash2 size={14}/> Delete</button>
          </div>}
          {editing?.id===comment.id?<form className="conversation-edit" onSubmit={event=>{event.preventDefault();if(!editing.body.trim())return;void run(async()=>{const updated=await request<Comment>(`/api/comments/${comment.id}`,'PATCH',{body:editing.body.trim()});onChange(comments.map(c=>c.id===updated.id?updated:c));setEditing(null);});}}>
            <textarea autoFocus aria-label="Edit your comment" maxLength={3000} required rows={3} disabled={busy} value={editing.body} onChange={event=>setEditing({id:comment.id,body:event.target.value})}/>
            <div><button type="submit" disabled={busy||!editing.body.trim()}>Save changes</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
          </form>:<p className="conversation-body">{comment.body}</p>}
          {removing===comment.id&&<div className="conversation-confirm"><p>Delete this comment?</p><button type="button" disabled={busy} onClick={()=>void run(async()=>{await request(`/api/comments/${comment.id}`,'DELETE');onChange(comments.filter(c=>c.id!==comment.id));setRemoving(null);})}>Delete</button><button type="button" disabled={busy} onClick={()=>setRemoving(null)}>Keep it</button></div>}
        </div>
      </li>;
    })}</ol>:<p className="conversation-empty">Agree with the score? Start the conversation.</p>}
    <span role="status" className="sr-only">{status}</span>
    {error&&<p className="error conversation-error" role="alert">{error}</p>}
    <form className="conversation-composer" onSubmit={event=>{event.preventDefault();send();}}>
      <Avatar name={user.displayName} url={user.avatarUrl}/>
      <div className="conversation-input-wrap">
        <label htmlFor={inputId} className="sr-only">Add a comment</label>
        <textarea ref={input} id={inputId} aria-describedby={hintId} placeholder="What do you think?" rows={2} maxLength={3000} required readOnly={busy} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();send();}}}/>
        <div className="conversation-compose-footer"><span id={hintId}>{draft.length>2700?`${draft.length} / 3000`:'Enter to send · Shift + Enter for a new line'}</span><button type="submit" disabled={busy||!draft.trim()} aria-label={busy&&!editing&&!removing?'Sending comment':'Send comment'}>{busy&&!editing&&!removing?<LoaderCircle size={17} className="spin"/>:<Send size={17}/>}<span>{busy&&!editing&&!removing?'Sending…':'Send'}</span></button></div>
      </div>
    </form>
  </section>;
}
