import {listItems} from './services/items';
import {z} from 'zod';
import {itemMatchSearchTerms, rankItemMatches} from '../domain/item-matches';
import {parse} from './services/common';

const optionalLabel = z.string().trim().max(200).nullable().optional();
const querySchema = z.object({name: z.string().trim().min(1).max(200), brand: optionalLabel, variant: optionalLabel});

export async function findItemMatches(userId: string, groupId: string, input: unknown) {
  const query = parse(querySchema, input);
  // At most six group-authorized queries and 300 rows; the final suggestions are capped at eight.
  const pages = await Promise.all(itemMatchSearchTerms(query).map(search => listItems(userId, groupId, {search, limit: 50})));
  return rankItemMatches(pages.flat(), query);
}
