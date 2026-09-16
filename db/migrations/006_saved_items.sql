-- Private server schema: access is authorized against the canonical user and
-- current membership in services, as with ratings. Keep saves after departure
-- so removing a membership never fails and a later rejoin can restore the list.
CREATE TABLE everrate.saved_items (
  user_id uuid NOT NULL REFERENCES everrate.users(id),
  item_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES everrate.groups(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY(user_id,item_id),
  FOREIGN KEY(group_id,item_id) REFERENCES everrate.items(group_id,id)
);
CREATE INDEX saved_items_group_item_idx ON everrate.saved_items(group_id,item_id);
CREATE INDEX saved_items_active_user_group_idx ON everrate.saved_items(user_id,group_id,item_id) WHERE removed_at IS NULL;
REVOKE ALL ON everrate.saved_items FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='everrate_app') THEN
    GRANT SELECT,INSERT,UPDATE ON everrate.saved_items TO everrate_app;
  END IF;
  -- Platform browser roles have no access to this private collection.
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON everrate.saved_items FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON everrate.saved_items FROM authenticated;
  END IF;
END $$;
