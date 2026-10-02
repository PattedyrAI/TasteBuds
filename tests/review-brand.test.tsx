import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RatingForm} from '../src/components/rating-form';
import {createRatingSchema} from '../src/domain/validation';
import type {Item} from '../src/lib/contracts';
const value={groupId:'11111111-1111-4111-8111-111111111111',name:'Original',score:7,photoId:'22222222-2222-4222-8222-222222222222'};
describe('mandatory review brand',()=>{
  it.each([undefined,null,'','   '])('rejects missing or blank brand %s',brand=>{
    expect(createRatingSchema.safeParse({...value,brand}).success).toBe(false);
  });
  it('accepts a trimmed brand and defers linked-item brand validation to stored data',()=>{
    expect(createRatingSchema.parse({...value,brand:'  Acme  '}).brand).toBe('Acme');
    expect(createRatingSchema.safeParse({...value,itemId:value.groupId}).success).toBe(true);
  });
  it.each(['Energy drinks','Food','Restaurants','Movies'])('renders required Brand before Model for %s',type=>{
    const item={name:'Original',brand:'Acme',type} as Item;
    const html=renderToStaticMarkup(<RatingForm groupId="group" item={item} categories={[type]} close={()=>{}} saved={()=>{}}/>);
    const brand=html.match(/<label>[^<]*Brand[^<]*(?:<[^>]*>[^<]*<\/[^>]*>)*<input[^>]*>/)?.[0];
    expect(brand).toBeDefined();
    expect(brand).toContain('required=""');
    expect(brand).not.toContain('optional');
    expect(html.indexOf(brand!)).toBeLessThan(html.indexOf('Model'));
  });
});
