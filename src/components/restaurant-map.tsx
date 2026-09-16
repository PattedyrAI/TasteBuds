'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {LocateFixed,MapPin,Search} from 'lucide-react';
import type {Category,RestaurantMap as MapData,RestaurantPin} from '../lib/contracts';
import {filterRestaurantPins,type FieldFilters} from '../domain/restaurant-filters';
import {loadGoogleMaps,type GoogleMap,type GoogleMarker,type MapsLibraries} from '../lib/google-maps';
import {CategoryFieldFilters} from './category-field-filters';
import {ReviewFieldValues} from './review-fields';
import {Score,request} from './ui';

function MapCanvas({data,pins,selected,onSelect}:{data:MapData;pins:RestaurantPin[];selected:string|null;onSelect:(placeId:string)=>void}){
  const element=useRef<HTMLDivElement>(null),map=useRef<GoogleMap|null>(null),sdk=useRef<MapsLibraries|null>(null),markers=useRef<GoogleMarker[]>([]),selection=useRef(onSelect),initialFit=useRef(false);
  const [ready,setReady]=useState(false),[error,setError]=useState('');selection.current=onSelect;
  const fit=()=>{if(!sdk.current||!map.current)return;const bounds=new sdk.current.LatLngBounds();for(const pin of pins)if(pin.location)bounds.extend(pin.location);if(!bounds.isEmpty())map.current.fitBounds(bounds,64);};
  useEffect(()=>{
    let active=true;const host=element.current;
    const failed=()=>setError('Google Maps-oppsettet må kontrolleres. Stedene er fortsatt tilgjengelige i listen.');window.addEventListener('tastebuds-maps-error',failed);
    void loadGoogleMaps(data.browserKey).then(library=>{
      if(!active||!host)return;sdk.current=library;
      map.current=new library.Map(host,{center:{lat:59.9139,lng:10.7522},zoom:11,mapId:data.mapId,gestureHandling:'cooperative',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,clickableIcons:false});setReady(true);
    }).catch(error=>{if(active)setError(error.message);});
    return()=>{active=false;window.removeEventListener('tastebuds-maps-error',failed);for(const marker of markers.current)marker.map=null;markers.current=[];map.current=null;host?.replaceChildren();};
  },[data.browserKey,data.mapId]);
  useEffect(()=>{
    if(!ready||!map.current||!sdk.current)return;
    const listeners:{remove():void}[]=[];
    for(const marker of markers.current)marker.map=null;markers.current=[];
    const places=new Map<string,RestaurantPin[]>();
    for(const pin of pins)if(pin.location)places.set(pin.placeId,[...(places.get(pin.placeId)||[]),pin]);
    for(const [placeId,entries] of places){
      const pin=entries[0],badge=document.createElement('div');badge.className='restaurant-pin'+(selected===placeId?' selected':'');
      badge.textContent=entries.length>1?String(entries.length):pin.item.average?.toFixed(1)||'•';
      const marker=new sdk.current.AdvancedMarkerElement({map:map.current,position:pin.location,content:badge,title:entries.map(p=>p.item.name).join(', '),gmpClickable:true});
      listeners.push(marker.addListener('click',()=>{selection.current(placeId);if(pin.location)map.current?.panTo(pin.location);}));markers.current.push(marker);
    }
    if(!initialFit.current&&places.size){fit();initialFit.current=true;}
    return()=>{for(const listener of listeners)listener.remove();for(const marker of markers.current)marker.map=null;markers.current=[];};
  },[ready,pins,selected]);
  return <div className="restaurant-map-stage"><div ref={element} className="restaurant-map-canvas" role="region" aria-label="Kart med gruppens vurderinger"/>{!ready&&!error&&<p className="map-message" role="status">Laster kart…</p>}{error&&<p className="map-message error" role="alert">{error}</p>}<button className="button secondary map-fit" disabled={!ready} onClick={fit}><LocateFixed size={18}/>Vis alle treff</button></div>;
}
export function RestaurantMap({groupId,category:template,open}:{groupId:string;category:Category;open:(id:string)=>void}){
  const [data,setData]=useState<MapData|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [search,setSearch]=useState(''),[minimumScore,setMinimumScore]=useState(0),[fields,setFields]=useState<FieldFilters>({}),[selected,setSelected]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setError('');
    void request<MapData>(`/api/groups/${groupId}/restaurants?categoryId=${template.id}`,'GET',undefined,controller.signal).then(setData).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return()=>controller.abort();
  },[groupId,template.id,revision]);
  const pins=useMemo(()=>filterRestaurantPins(data?.restaurants||[],{search,category:template.name,minimumScore,fields}),[data,search,template.name,minimumScore,fields]);
  const visible=selected?pins.filter(pin=>pin.placeId===selected):pins;
  const reset=()=>{setSearch('');setMinimumScore(0);setFields({});setSelected(null);};
  return <section className="restaurant-map-view">
    {error&&<div className="error" role="alert">{error}<button onClick={()=>setRevision(value=>value+1)}>Prøv igjen</button></div>}
    {!data&&!error?<p role="status">Henter gruppens steder…</p>:data&&<>
      <div className="map-filters"><label className="search"><Search size={18}/><input aria-label="Søk i kartet" value={search} onChange={event=>{setSearch(event.target.value);setSelected(null);}} placeholder="Søk etter navn eller feltverdi…"/></label>
        <label>Gruppescore<select value={minimumScore} onChange={event=>{setMinimumScore(Number(event.target.value));setSelected(null);}}><option value={0}>Alle poengsummer</option>{[5,6,7,8,9].map(n=><option key={n} value={n}>{n}+ av 10</option>)}</select></label>
        <button className="text-button" onClick={reset}>Nullstill filtre</button>
      </div>
      <CategoryFieldFilters category={template} items={data.restaurants.map(pin=>pin.item)} value={fields} onChange={value=>{setFields(value);setSelected(null);}}/>
      {!data.configured&&<p className="hint map-setup" role="status">Google Maps er ikke konfigurert ennå. Steder og vurderinger beholdes; kartet vises når oppsettet er klart.</p>}
      {data.unavailableCount>0&&data.configured&&<p className="hint" role="status">{data.unavailableCount} oppføringer mangler tilgjengelig posisjon akkurat nå. De finnes fortsatt i listen.</p>}
      <div className="map-and-list">
        {data.configured&&<MapCanvas data={data} pins={pins} selected={selected} onSelect={setSelected}/>}
        <div className="map-results"><div className="map-results-heading"><strong aria-live="polite">{pins.length} treff</strong>{selected&&<button className="text-button" onClick={()=>setSelected(null)}>Vis hele listen</button>}</div>
          {visible.length===0?<div className="empty-state"><MapPin size={30}/><h2>{data.restaurants.length?'Ingen steder passer filtrene.':'Her kommer gruppens steder.'}</h2><p>{data.restaurants.length?'Prøv et annet filter.':'Velg en kategori med lokasjonsfelt når du legger til en vurdering.'}</p></div>:visible.map(pin=><article className="map-result" key={pin.item.id}>
            <button className="map-result-open" onClick={()=>open(pin.item.id)}><span><strong>{pin.item.name}</strong><small>{pin.item.type} · {pin.item.raterCount} vurderere</small></span><Score value={pin.item.average}/></button>
            <ReviewFieldValues fields={pin.item.categoryFields||[]} values={pin.item.customFields||{}}/>
            {!pin.location&&<small className="muted">Posisjon utilgjengelig</small>}
          </article>)}
        </div>
      </div>
    </>}
  </section>;
}
