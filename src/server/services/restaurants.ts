import type {RestaurantMap,RestaurantPin} from '../../lib/contracts';
import {transaction} from '../db';
import {getPlaceLocation,mapsConfiguration} from '../google-places';
import {requireMembership,ServiceError,validId} from './common';
import {item,itemSelect} from './items';

export async function getRestaurantMap(userId:string,groupId:string,categoryId?:string):Promise<RestaurantMap>{
  if(categoryId)validId(categoryId);
  const configuration=mapsConfiguration();
  const data=await transaction(async db=>{
    await requireMembership(db,userId,groupId);
    const enabled=Boolean((await db.query(`SELECT 1 FROM everrate.item_types WHERE group_id=$1 AND fields @> '[{"type":"location"}]'::jsonb LIMIT 1`,[groupId])).rowCount);
    const result=enabled?await db.query(`${itemSelect} WHERE i.group_id=$1 AND t.fields @> '[{"type":"location"}]'::jsonb
      AND EXISTS(SELECT 1 FROM everrate.restaurant_places rp WHERE rp.group_id=i.group_id AND rp.item_id=i.id)
      AND EXISTS(SELECT 1 FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL)
      AND ($2::uuid IS NULL OR i.type_id=$2) ORDER BY lower(i.name),i.id`,[groupId,categoryId||null]):{rows:[]};
    const restaurants:RestaurantPin[]=result.rows.map(row=>({item:item(row),placeId:row.place_id,location:null}));
    return {enabled,restaurants};
  });
  if(!data.enabled)return {...data,configured:configuration.configured,browserKey:'',mapId:'',unavailableCount:0};
  if(configuration.configured){
    for(let i=0;i<data.restaurants.length;i+=4)await Promise.all(data.restaurants.slice(i,i+4).map(async pin=>{
      try{pin.location=await getPlaceLocation(pin.placeId);}catch(error){if(!(error instanceof ServiceError))throw error;}
    }));
  }
  // Re-read access after network latency; provider calls never hold database locks.
  await transaction(db=>requireMembership(db,userId,groupId));
  return {...data,...configuration,unavailableCount:data.restaurants.filter(pin=>!pin.location).length};
}
