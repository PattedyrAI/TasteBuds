-- Kart er valgfritt per gruppe. Eksisterende vurderinger og identiteter beholdes.
ALTER TABLE everrate.item_types ADD COLUMN fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(fields)='array');
ALTER TABLE everrate.ratings
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(custom_fields)='object'),
  ADD COLUMN category_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(category_fields)='array');
CREATE TABLE everrate.restaurant_places (
  group_id uuid NOT NULL REFERENCES everrate.groups(id),
  item_id uuid NOT NULL,
  place_id text NOT NULL CHECK(length(place_id) BETWEEN 1 AND 300 AND place_id ~ '^[A-Za-z0-9_-]+$'),
  created_by uuid NOT NULL REFERENCES everrate.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,item_id),

  FOREIGN KEY(group_id,item_id) REFERENCES everrate.items(group_id,id)
);
-- Bare ID lagres varig; Google-posisjoner mellomlagres kortvarig i prosessminnet.
CREATE TABLE everrate.google_places_usage (
  usage_day date PRIMARY KEY,
  requests integer NOT NULL CHECK(requests >= 0)
);
REVOKE ALL ON everrate.restaurant_places,everrate.google_places_usage FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='everrate_app') THEN
    GRANT SELECT,INSERT,DELETE ON everrate.restaurant_places TO everrate_app;
    GRANT SELECT,INSERT,UPDATE ON everrate.google_places_usage TO everrate_app;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON everrate.restaurant_places,everrate.google_places_usage FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON everrate.restaurant_places,everrate.google_places_usage FROM authenticated;
  END IF;
END $$;
