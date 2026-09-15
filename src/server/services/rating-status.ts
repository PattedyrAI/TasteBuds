/** Uses the same deterministic tasting order as item averages, across the complete active history. */
export const ratingStatusColumns=`
 EXISTS(SELECT 1 FROM everrate.ratings h WHERE h.item_id=r.item_id AND h.user_id=r.user_id AND h.deleted_at IS NULL
   AND (h.tasted_at,h.created_at,h.id)<(r.tasted_at,r.created_at,r.id)) AS is_rereview,
 (EXISTS(SELECT 1 FROM everrate.memberships m WHERE m.group_id=r.group_id AND m.user_id=r.user_id)
   AND NOT EXISTS(SELECT 1 FROM everrate.ratings h WHERE h.item_id=r.item_id AND h.user_id=r.user_id AND h.deleted_at IS NULL
     AND (h.tasted_at,h.created_at,h.id)>(r.tasted_at,r.created_at,r.id))) AS counts_toward_average`;
