CREATE SCHEMA IF NOT EXISTS everrate;
REVOKE ALL ON SCHEMA everrate FROM PUBLIC;
CREATE TABLE everrate.users (
 id uuid PRIMARY KEY, discord_id text UNIQUE, display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200), avatar_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE everrate.groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), owner_id uuid NOT NULL REFERENCES everrate.users(id),
 invite_code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX groups_owner_idx ON everrate.groups(owner_id);
CREATE TABLE everrate.memberships (
 group_id uuid NOT NULL REFERENCES everrate.groups(id), user_id uuid NOT NULL REFERENCES everrate.users(id), role text NOT NULL CHECK(role IN ('owner','member')), joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,user_id)
);
CREATE INDEX memberships_user_idx ON everrate.memberships(user_id,group_id);
CREATE UNIQUE INDEX memberships_one_owner ON everrate.memberships(group_id) WHERE role='owner';
CREATE TABLE everrate.brands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), UNIQUE(group_id,id)
);
CREATE UNIQUE INDEX brands_identity ON everrate.brands(group_id,lower(name));
CREATE TABLE everrate.item_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), UNIQUE(group_id,id)
);
CREATE UNIQUE INDEX item_types_identity ON everrate.item_types(group_id,lower(name));
CREATE TABLE everrate.items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 brand_id uuid, variant text, type_id uuid, broad_category text, identity_key text NOT NULL, created_by uuid NOT NULL REFERENCES everrate.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,id), FOREIGN KEY(group_id,brand_id) REFERENCES everrate.brands(group_id,id), FOREIGN KEY(group_id,type_id) REFERENCES everrate.item_types(group_id,id)
);
CREATE INDEX items_identity_idx ON everrate.items(group_id,identity_key);
CREATE INDEX items_brand_idx ON everrate.items(group_id,brand_id);
CREATE INDEX items_type_idx ON everrate.items(group_id,type_id);
CREATE INDEX items_creator_idx ON everrate.items(created_by);
CREATE TABLE everrate.photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), owner_id uuid NOT NULL REFERENCES everrate.users(id),
 data bytea NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 10485760), sha256 text NOT NULL CHECK(length(sha256)=64), mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 12000), height integer NOT NULL CHECK(height BETWEEN 1 AND 12000), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(group_id,id)
);
CREATE INDEX photos_owner_idx ON everrate.photos(owner_id,created_at);
CREATE INDEX photos_hash_idx ON everrate.photos(group_id,sha256);
CREATE TABLE everrate.ratings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), item_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES everrate.users(id),
 score numeric(4,2) NOT NULL CHECK(score BETWEEN 1 AND 10), note text CHECK(length(note)<=5000), tasted_at timestamptz NOT NULL DEFAULT now(), photo_id uuid,
 source text NOT NULL DEFAULT 'app' CHECK(source IN ('app','discord','import')), source_message_id text, idempotency_key text, request_hash text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(group_id,id), UNIQUE(user_id,idempotency_key), UNIQUE(group_id,source,source_message_id),
 FOREIGN KEY(group_id,item_id) REFERENCES everrate.items(group_id,id), FOREIGN KEY(group_id,photo_id) REFERENCES everrate.photos(group_id,id)
);
CREATE INDEX ratings_item_latest_idx ON everrate.ratings(item_id,user_id,tasted_at DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX ratings_feed_idx ON everrate.ratings(group_id,tasted_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ratings_user_idx ON everrate.ratings(user_id);
CREATE INDEX ratings_photo_idx ON everrate.ratings(group_id,photo_id);
CREATE TABLE everrate.rating_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rating_id uuid NOT NULL REFERENCES everrate.ratings(id), actor_id uuid NOT NULL REFERENCES everrate.users(id), action text NOT NULL CHECK(action IN ('update','delete')), previous_value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rating_revisions_rating_idx ON everrate.rating_revisions(rating_id,created_at);
CREATE INDEX rating_revisions_actor_idx ON everrate.rating_revisions(actor_id);
CREATE TABLE everrate.comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), rating_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES everrate.users(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 3000),
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, FOREIGN KEY(group_id,rating_id) REFERENCES everrate.ratings(group_id,id)
);
CREATE INDEX comments_rating_idx ON everrate.comments(group_id,rating_id,created_at);
CREATE INDEX comments_user_idx ON everrate.comments(user_id);
CREATE TABLE everrate.recognition_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), user_id uuid NOT NULL REFERENCES everrate.users(id), photo_id uuid NOT NULL,
 photo_hash text NOT NULL, model text NOT NULL, prompt_version text NOT NULL, status text NOT NULL CHECK(status IN ('pending','processing','completed','failed')),
 result jsonb, input_tokens integer, output_tokens integer, failure_class text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(group_id,photo_id) REFERENCES everrate.photos(group_id,id)
);
CREATE INDEX recognition_cache_idx ON everrate.recognition_jobs(group_id,photo_hash,model,prompt_version) WHERE status='completed';
CREATE INDEX recognition_usage_idx ON everrate.recognition_jobs(user_id,created_at);
CREATE INDEX recognition_photo_idx ON everrate.recognition_jobs(group_id,photo_id);
CREATE TABLE everrate.discord_connections (
 group_id uuid PRIMARY KEY REFERENCES everrate.groups(id), webhook_encrypted text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL REFERENCES everrate.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discord_connections_user_idx ON everrate.discord_connections(updated_by);
CREATE TABLE everrate.discord_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES everrate.groups(id), rating_id uuid NOT NULL UNIQUE, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','cancelled')), attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, sent_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,rating_id) REFERENCES everrate.ratings(group_id,id)
);
CREATE INDEX discord_outbox_ready_idx ON everrate.discord_outbox(next_attempt_at) WHERE status IN ('pending','processing');
CREATE INDEX discord_outbox_group_idx ON everrate.discord_outbox(group_id,rating_id);
CREATE TABLE everrate.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid REFERENCES everrate.groups(id), actor_id uuid REFERENCES everrate.users(id), action text NOT NULL, resource_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_group_idx ON everrate.audit_events(group_id,created_at);
CREATE INDEX audit_actor_idx ON everrate.audit_events(actor_id);
CREATE TABLE everrate.import_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_key text NOT NULL UNIQUE, source_type text NOT NULL, checksum text, status text NOT NULL DEFAULT 'pending', expected_count integer, imported_count integer NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE everrate.import_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), source_record_id text NOT NULL, reason text NOT NULL, raw_record jsonb NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_id,source_record_id,reason)
);
-- Even when a connection uses a platform role, no PostgREST/public role gains implicit access.
REVOKE ALL ON ALL TABLES IN SCHEMA everrate FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA everrate REVOKE ALL ON TABLES FROM PUBLIC;
