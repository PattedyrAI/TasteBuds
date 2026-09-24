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
    const authError=()=>setError('Google Maps-oppsettet må kontrolleres før du kan velge et sted.');
    window.addEventListener('tastebuds-maps-error',authError);
    void request<{configured:boolean;browserKey:string}>(`/api/groups/${groupId}/maps-config`,'GET',undefined,controller.signal).then(async configuration=>{
      if(!configuration.configured)throw new Error('Lokasjon er aktivert for kategorien, men Google Maps er ikke konfigurert ennå.'+(required?' Kategorien krever et sted før vurderingen kan publiseres.':' Du kan fortsatt lagre vurderingen uten sted.'));
      const sdk=await loadGoogleMaps(configuration.browserKey);if(controller.signal.aborted)return;
      widget=new sdk.BasicPlaceAutocompleteElement({requestedLanguage:'nb',requestedRegion:'no',...(restaurant?{includedPrimaryTypes:['restaurant','cafe','bar','bakery','meal_takeaway']}:{})});
      widget.setAttribute('aria-label','Søk etter sted');
      widget.addEventListener('gmp-select',event=>{const id=(event as Event&{place?:{id?:string}}).place?.id;if(id)change.current(id);});
      widget.addEventListener('gmp-error',()=>setError('Stedssøket er utilgjengelig. Prøv igjen senere.'));
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
  return <fieldset className="location-picker" disabled={disabled}><legend><MapPin size={17}/>Lokasjon <span className="optional">{required?'obligatorisk':'valgfritt'}</span></legend>
    <p className="hint">Velg riktig sted og avdeling. Navnet på vurderingen skriver du selv.</p>
    {loading&&<p role="status" className="hint">Åpner stedssøk…</p>}
    <div ref={host} inert={disabled}/>
    {error&&<div className="error" role="alert"><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}>Prøv igjen</button></div>}
    {value&&<><p className="hint" role="status">Et sted er valgt.</p><div ref={details} className="google-place-preview"/><button type="button" className="text-button" onClick={()=>onChange('')}>Fjern valgt sted</button></>}
  </fieldset>;
}
