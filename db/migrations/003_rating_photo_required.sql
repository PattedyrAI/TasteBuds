ALTER TABLE everrate.ratings ADD COLUMN legacy_photo_missing boolean NOT NULL DEFAULT false;
-- The requirement was introduced after historical events existed. Preserve those
-- events visibly as exceptions; all future app inserts default to requiring a photo.
UPDATE everrate.ratings SET legacy_photo_missing=true WHERE photo_id IS NULL;
ALTER TABLE everrate.ratings ADD CONSTRAINT ratings_photo_required CHECK(photo_id IS NOT NULL OR legacy_photo_missing);
COMMENT ON COLUMN everrate.ratings.legacy_photo_missing IS 'Historical exception only: imported or pre-requirement event whose source photo is unavailable. Never accepted from browser input.';
