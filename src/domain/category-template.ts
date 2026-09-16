import {z} from 'zod';
import type {CategoryField,CustomFields} from '../lib/contracts';
import {placeIdSchema} from './restaurants';

export const categoryFieldSchema=z.object({
  id:z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).refine(id=>!['__proto__','prototype','constructor'].includes(id),'Ugyldig felt-id'),label:z.string().trim().min(1).max(80),
  type:z.enum(['text','number','price','select','boolean','location']),required:z.boolean(),filterable:z.boolean(),
  options:z.array(z.string().trim().min(1).max(80)).max(40).optional(),
}).strict().superRefine((field,ctx)=>{
  if(field.type==='select'&&(!field.options?.length||new Set(field.options.map(o=>o.toLocaleLowerCase())).size!==field.options.length))ctx.addIssue({code:'custom',message:'Valglister må ha unike alternativer.'});
});
export const categoryFieldsSchema=z.array(categoryFieldSchema).max(20).superRefine((fields,ctx)=>{
  if(new Set(fields.map(f=>f.id)).size!==fields.length||new Set(fields.map(f=>f.label.toLocaleLowerCase())).size!==fields.length)ctx.addIssue({code:'custom',message:'Hvert felt må ha en unik id og et unikt navn.'});
  if(fields.filter(f=>f.type==='location').length>1)ctx.addIssue({code:'custom',message:'En kategori kan ha ett lokasjonsfelt.'});
});
export const customFieldsSchema=z.record(z.string().max(64),z.union([z.string().max(1000),z.number().finite(),z.boolean()])).refine(value=>Object.keys(value).length<=20,'For mange felt.');
export function validateCustomFields(fields:CategoryField[],input:CustomFields):CustomFields{
  const result:CustomFields={};
  for(const id of Object.keys(input))if(!fields.some(f=>f.id===id))throw new Error('Vurderingen inneholder et felt som ikke finnes i malen.');
  for(const field of fields){
    const raw=input[field.id],value=typeof raw==='string'?raw.trim():raw;
    if(value===undefined||value===''){if(field.required)throw new Error(`Fyll ut ${field.label}.`);continue;}
    if(field.type==='text'&&(typeof value!=='string'||value.length>1000))throw new Error(`Kontroller ${field.label}.`);
    if(field.type==='select'&&(typeof value!=='string'||!field.options?.includes(value)))throw new Error(`Velg et gyldig alternativ for ${field.label}.`);
    if((field.type==='number'||field.type==='price')&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error(`Skriv et tall i ${field.label}.`);
    if(field.type==='price'&&typeof value==='number'&&(value<0||Math.abs(value*100-Math.round(value*100))>1e-7))throw new Error(`${field.label} må være en positiv pris med maksimalt to desimaler.`);
    if(field.type==='boolean'&&typeof value!=='boolean')throw new Error(`Velg ja eller nei for ${field.label}.`);
    if(field.type==='location'&&!placeIdSchema.safeParse(value).success)throw new Error(`Velg et sted for ${field.label}.`);
    result[field.id]=value;
  }
  return result;
}
