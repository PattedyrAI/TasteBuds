import {reviewTypeNames} from '../domain/review-categories';
import {canonicalItemType} from '../domain/item-types';

// These labels come only from the static taxonomy, never from user input.
function literals(names:readonly string[]){
  if(!names.length||names.some(name=>!/^[a-z0-9 ]+$/.test(name)))throw new Error('Review routing labels require SQL-safe static names.');
  return names.map(name=>`'${name}'`).join(',');
}
const foodNames=literals(reviewTypeNames('Food'));
const energyNames=literals(reviewTypeNames('Drink').filter(name=>canonicalItemType(name)==='Energy drinks'));
// Only internal, fixed aliases are interpolated. No user SQL.
function specificMatch(alias:'d'|'specific'){
  return `CASE lower(trim(coalesce(i.broad_category,'')))
    WHEN 'food' THEN ${alias}.route='food'
    WHEN 'drink' THEN ${alias}.route<>'food' AND i.type_id=ANY(${alias}.category_ids)
    WHEN 'other' THEN ${alias}.route<>'food' AND i.type_id=ANY(${alias}.category_ids)
    ELSE i.type_id=ANY(${alias}.category_ids)
  END`;
}

/** i is the stored item, d its group's connection. Other never substitutes for Food or Energy. */
export const discordItemMatchesRoute=`(
 d.route='all'
 OR (d.route IN ('food','energy_drinks') AND (${specificMatch('d')}))
 OR (d.route='other'
 AND lower(trim(coalesce(i.broad_category,'')))<>'food'
 AND NOT EXISTS (
   SELECT 1 FROM everrate.item_types route_type
   WHERE route_type.id=i.type_id AND route_type.group_id=i.group_id
   AND (lower(regexp_replace(trim(route_type.name),'\\s+',' ','g')) IN (${energyNames})
     OR (lower(trim(coalesce(i.broad_category,''))) NOT IN ('drink','drinks','other')
       AND lower(regexp_replace(trim(route_type.name),'\\s+',' ','g')) IN (${foodNames})))
 )
 AND NOT EXISTS (
   SELECT 1 FROM everrate.discord_connections specific
   WHERE specific.group_id=d.group_id
     AND specific.route IN ('food','energy_drinks') AND (${specificMatch('specific')})
 ))
)`;
