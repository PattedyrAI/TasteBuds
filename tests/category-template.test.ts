import {describe,expect,it} from 'vitest';
import {categoryFieldsSchema,validateCustomFields} from '../src/domain/category-template';
import type {CategoryField,CustomFields} from '../src/lib/contracts';
const fields:CategoryField[]=[{id:'cuisine',label:'Cuisine',type:'select',options:['Italiensk','Indisk'],required:true,filterable:true},{id:'price',label:'Pris',type:'price',required:false,filterable:true},{id:'location',label:'Lokasjon',type:'location',required:false,filterable:false}];
describe('egendefinerte kategorimaler',()=>{
  it('validerer krav, typer, valgmuligheter og priser uten stille konvertering',()=>{
    expect(validateCustomFields(fields,{cuisine:'Italiensk',price:199.50,location:'place-1'})).toEqual({cuisine:'Italiensk',price:199.50,location:'place-1'});
    for(const values of ([{},{cuisine:'Ukjent'},{cuisine:'Indisk',price:-1},{cuisine:'Indisk',price:1.999},{cuisine:'Indisk',price:'2'},{cuisine:'Indisk',extra:'x'},{cuisine:'Indisk',location:'../bad'}] as CustomFields[]))expect(()=>validateCustomFields(fields,values)).toThrow();
  });
  it('hindrer duplikatfelter og flere lokasjonsfelt',()=>{
    expect(categoryFieldsSchema.safeParse(fields).success).toBe(true);
    expect(categoryFieldsSchema.safeParse([...fields,fields[0]]).success).toBe(false);
    expect(categoryFieldsSchema.safeParse([...fields,{...fields[2],id:'other',label:'Annen'}]).success).toBe(false);
  });
});
