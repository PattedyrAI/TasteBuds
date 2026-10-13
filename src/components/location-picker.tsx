'use client';
import {useEffect,useRef,useState} from 'react';
import {MapPin} from 'lucide-react';
import {loadGoogleMaps} from '../lib/google-maps';
import {request} from './ui';

export function LocationPicker({groupId,value,onChange,disabled=false,required=false,restaurant=false}:{groupId:string;value:string;onChange:(placeId:string)=>void;disabled?:boolean;required?:boolean;restaurant?:boolean}){
  const host=useRef<HTMLDivElement>(null),details=useRef<HTMLDivElement>(null),change=useRef(onChange);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  change.current=onChange;
  useEffect(()=>{
    const controller=new AbortController();let widget:HTMLElement|undefined;
    setLoading(true);setError('');
    const authError=()=>setError('Google Maps setup needs attention before you can choose a place.');
    window.addEventListener('tastebuds-maps-error',authError);
    void request<{configured:boolean;browserKey:string}>(`/api/groups/${groupId}/maps-config`,'GET',undefined,controller.signal).then(async configuration=>{
      if(!configuration.configured)throw new Error('Location is enabled for the category, but Google Maps is not configured yet.'+(required?' The category requires a place before the rating can be published.':' You can still save the rating without a place.'));
      const sdk=await loadGoogleMaps(configuration.browserKey);if(controller.signal.aborted)return;
      widget=new sdk.BasicPlaceAutocompleteElement({requestedLanguage:'nb',requestedRegion:'no',...(restaurant?{includedPrimaryTypes:['restaurant','cafe','bar','bakery','meal_takeaway']}:{})});
      widget.setAttribute('aria-label','Search for a place');
      widget.addEventListener('gmp-select',event=>{const id=(event as Event&{place?:{id?:string}}).place?.id;if(id)change.current(id);});
      widget.addEventListener('gmp-error',()=>setError('Place search is unavailable. Try again later.'));
      host.current?.replaceChildren(widget);setLoading(false);
    }).catch(error=>{if(!controller.signal.aborted){setError(error.message);setLoading(false);}});
    return()=>{controller.abort();widget?.remove();window.removeEventListener('tastebuds-maps-error',authError);};
  },[groupId,restaurant,required,retry]);
  useEffect(()=>{
    const container=details.current;if(!container)return;container.replaceChildren();if(!value)return;
    const card=document.createElement('gmp-place-details-compact');
    const place=document.createElement('gmp-place-details-place-request');place.setAttribute('place',value);
    card.append(place,document.createElement('gmp-place-standard-content'));container.append(card);
    return()=>card.remove();
  },[value,loading]);
  return <fieldset className="location-picker" disabled={disabled}><legend><MapPin size={17}/>Location <span className="optional">{required?'required':'optional'}</span></legend>
    <p className="hint">Choose the right place and department. You write the name of the rating yourself.</p>
    {loading&&<p role="status" className="hint">Opening place search…</p>}
    <div ref={host} inert={disabled}/>
    {error&&<div className="error" role="alert"><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></div>}
    {value&&<><p className="hint" role="status">A place is selected.</p><div ref={details} className="google-place-preview"/><button type="button" className="text-button" onClick={()=>onChange('')}>Remove selected place</button></>}
  </fieldset>;
}
