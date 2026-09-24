-- Preserve existing connections and queued deliveries as the all-reviews route.
ALTER TABLE everrate.discord_connections
 ADD COLUMN route text NOT NULL DEFAULT 'all' CHECK(route IN ('all','energy_drinks','food')),
 ADD COLUMN category_ids uuid[] NOT NULL DEFAULT '{}',
 DROP CONSTRAINT discord_connections_pkey,
 ADD PRIMARY KEY(group_id,route),
 ADD CONSTRAINT discord_route_categories CHECK(
   (route='all' AND cardinality(category_ids)=0) OR
   (route<>'all' AND (NOT enabled OR cardinality(category_ids)>0))
 );
ALTER TABLE everrate.discord_outbox
 ADD COLUMN route text NOT NULL DEFAULT 'all' CHECK(route IN ('all','energy_drinks','food'));
