'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {menuPosition} from '@/lib/menu-position';
import {Check,ChevronDown,Search} from 'lucide-react';
type Option={value:string;label:string;alwaysVisible?:boolean};
/** A controlled single-choice menu. Search filters labels without changing the selected value. */
export function SelectMenu({label,value,options,onChange,searchable=false,disabled=false,placeholder='Choose…'}:{label:string;value:string;options:Option[];onChange:(value:string)=>void;searchable?:boolean;disabled?:boolean;placeholder?:string}){
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[position,setPosition]=useState({left:0,top:0,width:240,maxHeight:320});
  const typed=useRef({text:'',at:0});
  const filtered=options.filter(o=>o.alwaysVisible||o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected=options.find(o=>o.value===value),index=Math.min(active,Math.max(0,filtered.length-1)),activeId=filtered.length?`${id}-option-${index}`:undefined;
  function close(restore=false){setOpen(false);if(restore)trigger.current?.focus();}
  function place(){
    if(!trigger.current)return;
    const viewport=window.visualViewport;
    setPosition(menuPosition(trigger.current.getBoundingClientRect(),{width:viewport?.width??window.innerWidth,height:viewport?.height??window.innerHeight,offsetTop:viewport?.offsetTop??0,offsetLeft:viewport?.offsetLeft??0}));
  }
  function show(last=false){
    if(disabled||!options.length)return;
    place();setQuery('');setActive(last?options.length-1:Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);
  }
  function choose(option:Option){onChange(option.value);close(true);}
  useEffect(()=>{if(!open)return;(searchable?search.current:list.current)?.focus();
    function outside(event:PointerEvent){if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))close();}
    function scroll(event:Event){if(!panel.current?.contains(event.target as Node))place();}
    const resize=()=>place();document.addEventListener('pointerdown',outside);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);};
  },[open,searchable]);
  useEffect(()=>{if(open)document.getElementById(activeId||'')?.scrollIntoView({block:'nearest'});},[open,activeId]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  function keydown(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActive(i=>filtered.length?(i+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length:0);return;}
    if(event.key==='Enter'||(!searchable&&event.key===' ')){event.preventDefault();if(filtered[index])choose(filtered[index]);return;}
    if(!searchable&&(event.key==='Home'||event.key==='End')){event.preventDefault();setActive(event.key==='Home'?0:filtered.length-1);return;}
    if(!searchable&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){const now=Date.now();typed.current={text:(now-typed.current.at<700?typed.current.text:'')+event.key.toLocaleLowerCase(),at:now};const found=filtered.findIndex(o=>o.label.toLocaleLowerCase().startsWith(typed.current.text));if(found>=0)setActive(found);}
  }
  return <div className="select-menu">
    <button ref={trigger} type="button" className="select-trigger" aria-label={`${label}: ${selected?.label??placeholder}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${id}-list`:undefined} disabled={disabled||!options.length} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowUp');}}}>
      <span title={selected?.label??placeholder}>{selected?.label??placeholder}</span><ChevronDown size={16} aria-hidden="true"/>
    </button>
    {open&&createPortal(<div ref={panel} className="select-panel" style={position} onKeyDown={keydown}>
      {searchable&&<div className="select-search"><Search size={16} aria-hidden="true"/><input ref={search} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={activeId} value={query} placeholder="Search names…" autoComplete="off" onChange={event=>{setQuery(event.target.value);setActive(0);}}/></div>}
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} tabIndex={searchable?-1:0} aria-activedescendant={searchable?undefined:activeId} className="select-options">
        {filtered.map((option,i)=><div key={option.value} id={`${id}-option-${i}`} role="option" aria-selected={option.value===value} className={`select-option ${i===index?'is-active':''}`} onPointerMove={event=>{if(event.pointerType==='mouse')setActive(i);}} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option)}><span>{option.label}</span>{option.value===value&&<Check size={16} aria-hidden="true"/>}</div>)}
      </div>
      {!filtered.length&&<p className="select-empty" role="status">No matching options.</p>}
    </div>,trigger.current?.closest('dialog')??document.body)}
  </div>;
}
