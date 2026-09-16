import {describe,it,expect} from 'vitest';
import {createRatingSchema,updateRatingSchema} from '../src/domain/validation';
const rating={groupId:'11111111-1111-4111-8111-111111111111',name:'Tea',photoId:'22222222-2222-4222-8222-222222222222'};
describe('one-decimal scores',()=>{
 it('accepts every tenth in range for new ratings and edits',()=>{for(let tenth=10;tenth<=100;tenth++){const score=tenth/10;expect(createRatingSchema.safeParse({...rating,score}).success).toBe(true);expect(updateRatingSchema.safeParse({score}).success).toBe(true);}});
 it('rejects extra decimals without rounding in both write paths',()=>{for(const score of [8.75,6.67,9.99,1.001]){expect(createRatingSchema.safeParse({...rating,score}).success).toBe(false);expect(updateRatingSchema.safeParse({score}).success).toBe(false);}});
 it('allows note-only corrections without forcing a historical score change',()=>{expect(updateRatingSchema.safeParse({note:'Updated notes'}).success).toBe(true);});
});
