-- Legacy snapshots did not record who made a correction. NULL preserves that uncertainty.
ALTER TABLE everrate.rating_revisions ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE everrate.items ADD COLUMN legacy_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE everrate.ratings ADD COLUMN legacy_metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE everrate.legacy_aliases (
 discord_id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES everrate.users(id), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), evidence text NOT NULL
);
CREATE INDEX legacy_aliases_user_idx ON everrate.legacy_aliases(user_id);
CREATE INDEX legacy_aliases_source_idx ON everrate.legacy_aliases(source_id);
CREATE TABLE everrate.legacy_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), table_name text NOT NULL, record_key text NOT NULL, sha256 text NOT NULL,
 raw_record jsonb NOT NULL, captured_at timestamptz NOT NULL, UNIQUE(source_id,table_name,record_key,sha256)
);
CREATE TABLE everrate.legacy_import_links (
 source_id uuid NOT NULL REFERENCES everrate.import_sources(id), table_name text NOT NULL, record_key text NOT NULL, target_table text NOT NULL, target_id uuid NOT NULL, source_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source_id,table_name,record_key,target_table)
);
CREATE TABLE everrate.archive_blobs (
 sha256 text PRIMARY KEY CHECK(length(sha256)=64), byte_size bigint NOT NULL CHECK(byte_size>=0), data bytea NOT NULL,
 CHECK(octet_length(data)=byte_size), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE everrate.archive_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), relative_path text NOT NULL,
 sha256 text NOT NULL, byte_size bigint NOT NULL, blob_sha256 text REFERENCES everrate.archive_blobs(sha256), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_id,relative_path,sha256), CHECK(relative_path !~ '(^/|(^|/)\.\.(/|$))')
);
CREATE INDEX archive_files_blob_idx ON everrate.archive_files(blob_sha256);
CREATE TABLE everrate.archive_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), message_id text NOT NULL,
 channel_id text, author_discord_id text, sent_at timestamptz, sha256 text NOT NULL, raw_record jsonb NOT NULL,
 UNIQUE(source_id,message_id,sha256)
);
CREATE TABLE everrate.archive_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), message_id text NOT NULL,
 attachment_id text NOT NULL, ordinal integer NOT NULL, sha256 text NOT NULL, raw_record jsonb NOT NULL, archive_file_id uuid REFERENCES everrate.archive_files(id),
 UNIQUE(source_id,message_id,attachment_id,ordinal,sha256)
);
CREATE INDEX archive_attachments_file_idx ON everrate.archive_attachments(archive_file_id);
CREATE TABLE everrate.archive_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES everrate.import_sources(id), source_file text NOT NULL,
 record_key text NOT NULL, sha256 text NOT NULL, raw_record jsonb NOT NULL, disposition text NOT NULL, linked_rating_id uuid REFERENCES everrate.ratings(id),
 UNIQUE(source_id,source_file,record_key,sha256)
);
CREATE INDEX archive_proposals_rating_idx ON everrate.archive_proposals(linked_rating_id);
REVOKE ALL ON ALL TABLES IN SCHEMA everrate FROM PUBLIC;
ALTER TABLE everrate.items ADD COLUMN legacy_photo_id uuid;
ALTER TABLE everrate.items ADD CONSTRAINT items_legacy_photo_group_fk FOREIGN KEY(group_id,legacy_photo_id) REFERENCES everrate.photos(group_id,id);
CREATE INDEX items_legacy_photo_idx ON everrate.items(group_id,legacy_photo_id);
