import {canonicalItemType} from '../../domain/item-types';
import {validateCustomFields} from '../../domain/category-template';
import type {CategoryField,CreateRatingInput,CustomFields} from '../../lib/contracts';
import type {Db} from '../db';
import {getPlaceLocation,mapsConfiguration} from '../google-places';
import {requireMembership,ServiceError} from './common';

export function parseTemplateValues(fields:CategoryField[],values:CustomFields){
  try{return validateCustomFields(fields,values);}catch(error){throw new ServiceError(400,error instanceof Error?error.message:'Kontroller ekstrafeltene.');}
}
export async function ratingTemplate(db:Db,userId:string,input:CreateRatingInput){
  await requireMembership(db,userId,input.groupId);
  const result=input.itemId
    ?await db.query(`SELECT t.fields,rp.place_id FROM everrate.items i LEFT JOIN everrate.item_types t ON t.id=i.type_id
      LEFT JOIN everrate.restaurant_places rp ON rp.group_id=i.group_id AND rp.item_id=i.id WHERE i.group_id=$1 AND i.id=$2`,[input.groupId,input.itemId])
    :await db.query('SELECT fields FROM everrate.item_types WHERE group_id=$1 AND lower(name)=lower($2)',[input.groupId,canonicalItemType(input.type||'')]);
  if(input.itemId&&!result.rowCount)throw new ServiceError(404,'Item not found');
  const fields:CategoryField[]=result.rows[0]?.fields||[];
  const locationField=fields.find(f=>f.type==='location');
  const submitted={...input.customFields};
  if(locationField&&result.rows[0]?.place_id){
    if(submitted[locationField.id]&&submitted[locationField.id]!==result.rows[0].place_id)throw new ServiceError(409,'Oppføringen er allerede koblet til et annet sted.');
    submitted[locationField.id]=result.rows[0].place_id;
  }
  const values=parseTemplateValues(fields,submitted);
  const placeId=locationField?values[locationField.id] as string|undefined:undefined;
  return {fields,values,placeId,existingPlaceId:result.rows[0]?.place_id as string|undefined};
}
export async function verifyRatingLocation(placeId?:string){
  if(!placeId)return;
  if(!mapsConfiguration().configured)throw new ServiceError(503,'Google Maps er ikke konfigurert ennå.');
  await getPlaceLocation(placeId);
}
export async function persistRatingLocation(db:Db,userId:string,groupId:string,itemId:string,placeId?:string){
  if(!placeId)return;
  await db.query(`INSERT INTO everrate.restaurant_places(group_id,item_id,place_id,created_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(group_id,item_id) DO NOTHING`,[groupId,itemId,placeId,userId]);
  const result=await db.query('SELECT place_id FROM everrate.restaurant_places WHERE group_id=$1 AND item_id=$2',[groupId,itemId]);
  if(result.rows[0].place_id!==placeId)throw new ServiceError(409,'En annen plassering ble nettopp lagret. Åpne oppføringen på nytt.');
}
