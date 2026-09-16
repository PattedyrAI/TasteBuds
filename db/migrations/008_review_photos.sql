-- The existing ratings.photo_id remains the cover; up to four ordered extras.
-- No existing ratings or image bytes need to be rewritten.
CREATE TABLE everrate.rating_photos (
  group_id uuid NOT NULL,
  rating_id uuid NOT NULL,
  photo_id uuid NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 4),
  PRIMARY KEY(rating_id,position),
  UNIQUE(rating_id,photo_id),
  FOREIGN KEY(group_id,rating_id) REFERENCES everrate.ratings(group_id,id),
  FOREIGN KEY(group_id,photo_id) REFERENCES everrate.photos(group_id,id)
);
CREATE INDEX rating_photos_group_photo_idx ON everrate.rating_photos(group_id,photo_id);
REVOKE ALL ON everrate.rating_photos FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='everrate_app') THEN
    GRANT SELECT,INSERT,DELETE ON everrate.rating_photos TO everrate_app;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON everrate.rating_photos FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON everrate.rating_photos FROM authenticated;
  END IF;
END $$;
