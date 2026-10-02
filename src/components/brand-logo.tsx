'use client';
import {useState} from 'react';
import {brandLogo} from '../domain/brand-logos';
/** Only same-origin paths render; anything else falls back to the brand's initial. */
function localLogo(brand:string|null){
 const logo=brandLogo(brand);
 return logo&&logo.src.startsWith('/')&&!logo.src.startsWith('//')?logo:null;
}
export function BrandLogo({brand}:{brand:string}){
 const logo=localLogo(brand),[failed,setFailed]=useState<string|null>(null);
 if(logo&&failed!==logo.src)return <span className="brand-logo" aria-hidden="true"><img src={logo.src} alt="" loading="lazy" decoding="async" onError={()=>setFailed(logo.src)}/></span>;
 return <span className="brand-logo monogram" aria-hidden="true">{Array.from(brand.trim())[0]?.toUpperCase()||'?'}</span>;
}
