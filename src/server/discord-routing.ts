// Only internal, fixed aliases are interpolated. No user SQL.
function specificMatch(alias:'d'|'specific'){
  return `CASE lower(trim(coalesce(i.broad_category,'')))
    WHEN 'food' THEN ${alias}.route='food'
    WHEN 'drink' THEN ${alias}.route<>'food' AND i.type_id=ANY(${alias}.category_ids)
    WHEN 'other' THEN ${alias}.route<>'food' AND i.type_id=ANY(${alias}.category_ids)
    ELSE i.type_id=ANY(${alias}.category_ids)
  END`;
}

/** i is the stored item, d its group's connection. Other is a fallback only. */
export const discordItemMatchesRoute=`(
 d.route='all'
 OR (d.route IN ('food','energy_drinks') AND (${specificMatch('d')}))
 OR (d.route='other' AND NOT EXISTS (
   SELECT 1 FROM everrate.discord_connections specific
   WHERE specific.group_id=d.group_id AND specific.enabled
     AND specific.route IN ('food','energy_drinks') AND (${specificMatch('specific')})
 ))
)`;
