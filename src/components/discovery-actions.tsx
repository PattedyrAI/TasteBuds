'use client';
import {createContext,useContext,useState} from 'react';
import {Bookmark,Check,LoaderCircle} from 'lucide-react';
import type {Item} from '@/lib/contracts';
export const DiscoveryActions=createContext<{openBrand:(brand:string)=>void;savedItems:Record<string,boolean>;saveItem:(item:Item)=>Promise<boolean>}|null>(null);
export const useDiscovery=()=>useContext(DiscoveryActions);
export function SaveItemButton({item,changed,compact=false}:{item:Item;changed?:(saved:boolean)=>void;compact?:boolean}){
 const actions=useDiscovery(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!actions)return null;
 const isSaved=actions.savedItems[item.id]??item.saved===true;
 return <span className={`save-control${compact?' compact':''}`}><button type="button" className={`save-item${isSaved?' is-saved':''}`} aria-label={`${isSaved?'Remove':'Save'} ${item.name} ${isSaved?'from':'to'} your want-to-try list`} aria-pressed={isSaved} title={isSaved?'Saved to your list':'Want to try'} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const saved=await actions.saveItem({...item,saved:isSaved});changed?.(saved);}catch(e){setError(e instanceof Error?e.message:'Could not update your list.');}finally{setBusy(false);}}}>
 {busy?<LoaderCircle className="spin" size={18}/>:isSaved?<Check size={18}/>:<Bookmark size={18}/>}<span className={compact?'sr-only':''}>{isSaved?'Saved':'Want to try'}</span></button>{error&&<span className="save-error" role="alert">{error}</span>}</span>;
}
