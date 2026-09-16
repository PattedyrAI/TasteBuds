'use client';
import {useDiscovery} from './discovery-actions';
export function BrandLabel({brand,interactive=false}:{brand:string|null;interactive?:boolean}){
 const actions=useDiscovery();
 if(!brand)return null;
 return interactive&&actions?<button type="button" className="brand-label brand-link" title={`Explore ${brand}`} onClick={()=>actions.openBrand(brand)}>{brand}</button>:<span className="brand-label">{brand}</span>;
}
