-- Keep the existing destinations and queued route identities unchanged.
ALTER TABLE everrate.discord_connections
 DROP CONSTRAINT discord_connections_route_check,
 ADD CONSTRAINT discord_connections_route_check CHECK(route IN ('all','energy_drinks','food','other')),
 DROP CONSTRAINT discord_route_categories,
 ADD CONSTRAINT discord_route_categories CHECK (
   (route IN ('all','other') AND cardinality(category_ids)=0) OR
   route='food' OR
   (route='energy_drinks' AND (NOT enabled OR cardinality(category_ids)>0))
 );
ALTER TABLE everrate.discord_outbox
 DROP CONSTRAINT discord_outbox_route_check,
 ADD CONSTRAINT discord_outbox_route_check CHECK(route IN ('all','energy_drinks','food','other'));
