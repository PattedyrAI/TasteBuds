import {z} from 'zod';
import {placeIdSchema} from '../domain/restaurants';
import type {RestaurantLocation} from '../lib/contracts';
import {getPool} from './db';
import {parse,ServiceError} from './services/common';

const responseSchema=z.object({id:z.string(),location:z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)})});
export function mapsConfiguration(){
  const browserKey=process.env.GOOGLE_MAPS_BROWSER_KEY?.trim()||'';
  return {configured:Boolean(browserKey&&process.env.GOOGLE_PLACES_SERVER_KEY?.trim()),browserKey,mapId:process.env.GOOGLE_MAPS_MAP_ID?.trim()||'DEMO_MAP_ID'};
}
export async function fetchPlaceLocation(placeId:string):Promise<RestaurantLocation>{
  parse(placeIdSchema,placeId);
  const key=process.env.GOOGLE_PLACES_SERVER_KEY?.trim();
  if(!key)throw new ServiceError(503,'Google Maps er ikke konfigurert ennå.');
  try{
    const response=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,{
      headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'id,location'},cache:'no-store',signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)throw new Error('Provider request failed');
    const data=responseSchema.parse(await response.json());
    if(data.id!==placeId)throw new Error('Unexpected place identity');
    return {lat:data.location.latitude,lng:data.location.longitude};
  }catch{throw new ServiceError(502,'Kunne ikke hente plasseringen fra Google. Prøv igjen senere.');}
}

// No persistent coordinates: expiring memory only, bounded even in a long-lived server.
const cache=new Map<string,{location:RestaurantLocation;expires:number}>();
const pending=new Map<string,Promise<RestaurantLocation>>();
const ttl=24*60*60*1000;
const expiry=setInterval(()=>{for(const [id,entry] of cache)if(entry.expires<=Date.now())cache.delete(id);},60_000);
expiry.unref();
async function reserveRequest(){
  const configured=Number(process.env.GOOGLE_PLACES_DAILY_LIMIT??500);
  const limit=Number.isSafeInteger(configured)&&configured>=0?configured:500;
  if(!limit)throw new ServiceError(429,'Dagens grense for stedsoppslag er nådd. Prøv igjen i morgen.');
  const result=await getPool().query(`INSERT INTO everrate.google_places_usage(usage_day,requests)
    VALUES((now() AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(usage_day) DO UPDATE SET requests=everrate.google_places_usage.requests+1
    WHERE everrate.google_places_usage.requests<$1 RETURNING requests`,[limit]);
  if(!result.rowCount)throw new ServiceError(429,'Dagens grense for stedsoppslag er nådd. Prøv igjen i morgen.');
}
/** Call only after membership and group-feature authorization. */
export async function getPlaceLocation(placeId:string):Promise<RestaurantLocation>{
  parse(placeIdSchema,placeId);
  const key=process.env.GOOGLE_PLACES_SERVER_KEY;
  if(!key?.trim())throw new ServiceError(503,'Google Maps er ikke konfigurert ennå.');
  const hit=cache.get(placeId);
  if(hit&&hit.expires>Date.now())return hit.location;
  cache.delete(placeId);
  const existing=pending.get(placeId);if(existing)return existing;
  const operation=(async()=>{
    await reserveRequest();const location=await fetchPlaceLocation(placeId);
    if(cache.size>=1000)cache.delete(cache.keys().next().value!);
    cache.set(placeId,{location,expires:Date.now()+ttl});return location;
  })();
  pending.set(placeId,operation);
  try{return await operation;}finally{pending.delete(placeId);}
}
