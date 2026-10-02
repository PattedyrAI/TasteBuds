'use client';
import {useDiscovery} from './discovery-actions';
import {BrandLogo} from './brand-logo';
/** The brand name is always visible text; the logo only decorates it. */
export function BrandLabel({brand,interactive=false}:{brand:string|null;interactive?:boolean}){
 const actions=useDiscovery();
 if(!brand)return null;
 const content=<><BrandLogo brand={brand}/><span className="brand-name">{brand}</span></>;
 return interactive&&actions?<button type="button" className="brand-label brand-link" title={`Explore ${brand}`} onClick={()=>actions.openBrand(brand)}>{content}</button>:<span className="brand-label">{content}</span>;
}
