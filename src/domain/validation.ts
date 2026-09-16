import { z } from 'zod';
export const idSchema = z.uuid();
export const nameSchema = z.string().trim().min(1).max(200);
const nullableText = z.string().trim().max(200).nullable().optional().transform(value => value || null);
const dateSchema = z.string().datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now() + 86_400_000, 'Tasting date cannot be in the future');
const scoreSchema=z.number().finite().min(1).max(10).multipleOf(0.1,'Use at most one decimal place.');
export const createRatingSchema = z.object({
  groupId: idSchema, itemId: idSchema.optional(), rereviewOf: idSchema.optional(), name: nameSchema.optional(), brand: nullableText,
  variant: nullableText, type: nullableText, broadCategory: nullableText,
  score: scoreSchema, note: z.string().trim().max(5000).nullable().optional(),
  tastedAt: dateSchema.optional(), photoId: idSchema,
  idempotencyKey: z.string().min(8).max(200).optional(),
}).refine(value => Boolean(value.itemId || value.name), 'Choose an item or enter a name').refine(value => !value.rereviewOf || Boolean(value.itemId), 'A rereview requires an existing item');
export const updateRatingSchema = z.object({ score: scoreSchema.optional(), note: z.string().trim().max(5000).nullable().optional(), tastedAt: dateSchema.optional(), photoId: idSchema.optional() }).refine(value => Object.keys(value).length > 0, 'Nothing to update');
export const groupPatchSchema = z.object({ name: nameSchema.optional(), ownerId: idSchema.optional(), leave: z.boolean().optional() }).refine(value => !(value.leave && (value.name || value.ownerId)), 'Leave must be a separate operation');

const nullablePatchText = z.string().trim().max(200).nullable().transform(value => value || null).optional();
export const updateItemSchema = z.object({name:nameSchema.optional(),brand:nullablePatchText,variant:nullablePatchText,type:nullablePatchText,broadCategory:nullablePatchText}).refine(value => Object.values(value).some(field => field !== undefined), 'Nothing to update');
export const commentSchema = z.object({body:z.string().trim().min(1).max(3000)});
