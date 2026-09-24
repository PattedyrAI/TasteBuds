import type {RestaurantLocation} from './contracts';

// Narrow SDK boundary; the application owns no Google place names or addresses.
export interface GoogleMap {
  fitBounds(bounds:GoogleBounds,padding?:number):void;
  panTo(location:RestaurantLocation):void;
  setZoom(zoom:number):void;
}
export interface GoogleBounds {extend(location:RestaurantLocation):GoogleBounds;isEmpty():boolean}
export interface GoogleMarker {map:GoogleMap|null;addListener(event:string,callback:()=>void):{remove():void}}
export interface MapsLibraries {
  Map:new(element:HTMLElement,options:Record<string,unknown>)=>GoogleMap;
  LatLngBounds:new()=>GoogleBounds;
  AdvancedMarkerElement:new(options:Record<string,unknown>)=>GoogleMarker;
  BasicPlaceAutocompleteElement:new(options?:Record<string,unknown>)=>HTMLElement;
}
type SDKWindow=Window&{google?:{maps:{importLibrary(name:string):Promise<unknown>}};__tastebudsMapsReady?:()=>void;gm_authFailure?:()=>void};
let loading:Promise<MapsLibraries>|undefined;
export function loadGoogleMaps(key:string):Promise<MapsLibraries>{
  if(loading)return loading;
  const target=window as SDKWindow;
  loading=(async()=>{
    if(!target.google?.maps?.importLibrary)await new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script');
      const fail=()=>{clearTimeout(timer);script.remove();delete target.__tastebudsMapsReady;reject(new Error('Google Maps kunne ikke lastes. Kontroller tilkoblingen og kartoppsettet.'));};
      const timer=setTimeout(fail,15000);
      target.__tastebudsMapsReady=()=>{clearTimeout(timer);delete target.__tastebudsMapsReady;resolve();};
      target.gm_authFailure=()=>{window.dispatchEvent(new Event('tastebuds-maps-error'));fail();};
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,v:'weekly',loading:'async',callback:'__tastebudsMapsReady',language:'nb',region:'NO'});
      script.async=true;script.onerror=fail;document.head.appendChild(script);
    });
    const sdk=target.google?.maps;if(!sdk)throw new Error('Google Maps er ikke tilgjengelig.');
    const libraries=await Promise.all(['maps','core','marker','places'].map(name=>sdk.importLibrary(name)));
    return Object.assign({},...libraries) as MapsLibraries;
  })().catch(error=>{loading=undefined;throw error;});
  return loading;
}
