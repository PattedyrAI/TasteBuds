-- One-time operational repair for imported GoTrue v2.189.0 users.
-- Run with psql -v ON_ERROR_STOP=1 -v expected_rows=<reviewed count>.
-- The app runtime role must not receive access to auth.users.
-- Source: https://supabase.com/docs/guides/troubleshooting/scan-error-on-column-confirmation_token-converting-null-to-string-is-unsupported-during-auth-login-a0c686
-- These four columns are Go strings; phone/password/timestamp NULLs remain valid.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE tastebuds_auth_repair_expected ON COMMIT DROP AS
  SELECT :expected_rows::integer AS rows;
CREATE TEMP TABLE tastebuds_auth_repair_before ON COMMIT DROP AS
  SELECT id, to_jsonb(u) AS payload FROM auth.users u;
DO $$ BEGIN
  IF (SELECT count(*) FROM auth.users WHERE confirmation_token IS NULL
      OR recovery_token IS NULL OR email_change_token_new IS NULL OR email_change IS NULL)
     <> (SELECT rows FROM tastebuds_auth_repair_expected) THEN
    RAISE EXCEPTION 'Auth repair scope differs from reviewed row count';
  END IF;
END $$;
UPDATE auth.users
SET confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change = coalesce(email_change, '')
WHERE confirmation_token IS NULL OR recovery_token IS NULL
   OR email_change_token_new IS NULL OR email_change IS NULL;
DO $$ BEGIN
  -- Compare every user field with the exact intended transformation before commit.
  IF EXISTS (
    SELECT FROM tastebuds_auth_repair_before b FULL JOIN auth.users u ON u.id=b.id
    WHERE b.id IS NULL OR u.id IS NULL OR to_jsonb(u) IS DISTINCT FROM
      b.payload || jsonb_build_object(
        'confirmation_token',coalesce(b.payload->>'confirmation_token',''),
        'recovery_token',coalesce(b.payload->>'recovery_token',''),
        'email_change_token_new',coalesce(b.payload->>'email_change_token_new',''),
        'email_change',coalesce(b.payload->>'email_change',''))
  ) THEN RAISE EXCEPTION 'Auth repair changed fields outside the reviewed transformation'; END IF;
END $$;
COMMIT;
