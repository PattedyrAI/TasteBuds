import {z} from 'zod';
import type {Category} from '../../lib/contracts';
import {canonicalItemType} from '../../domain/item-types';
import {categoryFieldsSchema} from '../../domain/category-template';
import {nameSchema} from '../../domain/validation';
import {transaction} from '../db';
import {audit,parse,requireMembership,ServiceError,validId} from './common';
import {mapsConfiguration} from '../google-places';

export async function getMapsConfiguration(userId:string,groupId:string){
  return transaction(async db=>{await requireMembership(db,userId,groupId);return mapsConfiguration();});
}
const category=(row:Record<string,any>):Category=>({id:row.id,name:row.name,fields:row.fields});
const schema=z.object({name:nameSchema,fields:categoryFieldsSchema.default([])}).strict();
export async function createCategory(userId:string,groupId:string,input:unknown):Promise<Category>{
  const value=parse(schema,input);
  return transaction(async db=>{
    await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[validId(groupId)]);
    await requireMembership(db,userId,groupId,true);
    const name=canonicalItemType(value.name);
    if((await db.query('SELECT id FROM everrate.item_types WHERE group_id=$1 AND lower(name)=lower($2)',[groupId,name])).rowCount)throw new ServiceError(409,'Kategorien finnes allerede. Velg den eksisterende kategorien eller bruk et annet navn.');
    const result=await db.query('INSERT INTO everrate.item_types(group_id,name,fields) VALUES($1,$2,$3) RETURNING *',[groupId,name,JSON.stringify(value.fields)]);
    await audit(db,userId,groupId,'category.create',result.rows[0].id);return category(result.rows[0]);
  });
}
export async function updateCategory(userId:string,groupId:string,categoryId:string,input:unknown):Promise<Category>{
  validId(categoryId);const value=parse(schema,input);
  return transaction(async db=>{
    await db.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[validId(groupId)]);
    await requireMembership(db,userId,groupId,true);
    const old=await db.query('SELECT * FROM everrate.item_types WHERE group_id=$1 AND id=$2',[groupId,categoryId]);
    if(!old.rowCount)throw new ServiceError(404,'Kategorien finnes ikke.');
    const name=canonicalItemType(value.name);
    if((await db.query('SELECT 1 FROM everrate.item_types WHERE group_id=$1 AND lower(name)=lower($2) AND id<>$3',[groupId,name,categoryId])).rowCount)throw new ServiceError(409,'En annen kategori har dette navnet.');
    const result=await db.query('UPDATE everrate.item_types SET name=$1,fields=$2 WHERE group_id=$3 AND id=$4 RETURNING *',[name,JSON.stringify(value.fields),groupId,categoryId]);
    await audit(db,userId,groupId,'category.template',categoryId,{previous:category(old.rows[0]),updated:category(result.rows[0])});return category(result.rows[0]);
  });
}
