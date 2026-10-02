/** Fixed SQL aliases: i is the stored item, d its group's connection. No user SQL. */
export const discordItemMatchesRoute=`(
 d.route='all' OR CASE lower(trim(coalesce(i.broad_category,'')))
  WHEN 'food' THEN d.route='food'
  WHEN 'drink' THEN d.route<>'food' AND i.type_id=ANY(d.category_ids)
  WHEN 'other' THEN d.route<>'food' AND i.type_id=ANY(d.category_ids)
  ELSE i.type_id=ANY(d.category_ids)
 END
)`;
