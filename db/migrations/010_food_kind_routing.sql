-- Food is selected directly on new items; detailed types remain a legacy fallback.
ALTER TABLE everrate.discord_connections
 DROP CONSTRAINT discord_route_categories,
 ADD CONSTRAINT discord_route_categories CHECK (
   (route='all' AND cardinality(category_ids)=0) OR
   route='food' OR
   (route='energy_drinks' AND (NOT enabled OR cardinality(category_ids)>0))
 );
