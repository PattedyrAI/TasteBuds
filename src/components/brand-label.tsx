export function BrandLabel({brand}:{brand:string|null}){
  return brand?<span className="brand-label">{brand}</span>:null;
}
