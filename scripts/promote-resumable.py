#!/usr/bin/env python3
"""Stage archive blobs in bounded resumable transactions; release the schema atomically."""
import contextlib
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('promotion', Path(__file__).with_name('promote-database.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
STAGE = 'everrate_promotion_stage'
BATCH_BYTES = 64 * 1024 * 1024  # COPY text, including hex expansion, not decoded bytes.
BATCH_SECONDS = 180
BLOB_DDL = '''CREATE TABLE everrate.archive_blobs (
    sha256 text NOT NULL,
    byte_size bigint NOT NULL,
    data bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT archive_blobs_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT archive_blobs_check CHECK ((octet_length(data) = byte_size)),
    CONSTRAINT archive_blobs_sha256_check CHECK ((length(sha256) = 64))
);'''
COPY_HEADER = b'COPY everrate.archive_blobs (sha256, byte_size, data, created_at) FROM stdin;\n'
PSQL = [str(p.PG_BIN / 'psql'), '-X', '-q', '-A', '-t', '--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file=-']


def fail(message):
    raise p.GuardError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def stage_definition(ddl):
    if ' '.join(ddl.split()) != ' '.join(BLOB_DDL.split()):
        fail('Archive blob table definition changed; review before promotion.')
    return ddl.replace('CREATE TABLE everrate.archive_blobs', 'CREATE TABLE ' + STAGE + '.archive_blobs', 1)


def select_toc(toc):
    p.assert_archive_scope(toc)
    output, table, data = [], 0, 0
    for line in toc.splitlines():
        if re.fullmatch(r'\d+; \d+ \d+ TABLE everrate archive_blobs \S+', line):
            table += 1
        elif re.fullmatch(r'\d+; \d+ \d+ TABLE DATA everrate archive_blobs \S+', line):
            data += 1
        else:
            output.append(line)
    if table != 1 or data != 1:
        fail('Archive must contain exactly one blob table and data entry.')
    return '\n'.join(output) + '\n'


def filter_section(source):
    """PG data sections use Data for Name; remove only the exact PG17 header SET."""
    header, removed = bytearray(), 0
    while len(header) < p.CHUNK:
        line = source.readline(p.CHUNK + 1)
        if len(line) > p.CHUNK or not line:
            fail('Unexpected or truncated section header.')
        if line.startswith((b'-- Name: ', b'-- Data for Name: ')):
            if removed != 1:
                fail('Expected exactly one transaction_timeout header setting.')
            header.extend(line)
            if len(header) > p.CHUNK:
                fail('Section header exceeds the bounded size.')
            yield bytes(header)
            break
        if line == b'SET transaction_timeout = 0;\n':
            removed += 1
        else:
            header.extend(line)
    else:
        fail('Section header exceeds the bounded size.')
    while chunk := source.read(p.CHUNK):
        yield chunk


def parse_blob(line):
    if len(line) > BATCH_BYTES or not line.endswith(b'\n'):
        fail('Archive blob row exceeds the batch limit or is truncated.')
    fields = line[:-1].split(b'\t')
    if len(fields) != 4 or not re.fullmatch(b'[a-f0-9]{64}', fields[0]) or not re.fullmatch(b'[0-9]+', fields[1]):
        fail('Unexpected archive blob COPY row.')
    sha, size, encoded, stamp = fields
    if not encoded.startswith(b'\\\\x') or len(encoded) != 3 + int(size) * 2:
        fail('Archive blob size or encoding mismatch.')
    try:
        data = bytes.fromhex(encoded[3:].decode('ascii'))
        dt = datetime.datetime.fromisoformat(stamp.decode('ascii'))
        if dt.tzinfo is None:
            raise ValueError()
        created = dt.astimezone(datetime.timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    except (ValueError, UnicodeError):
        fail('Archive blob has invalid hex or timestamp.')
    if len(data) != int(size) or hashlib.sha256(data).hexdigest().encode() != sha:
        fail('Archive blob actual digest differs from its source key.')
    return {'sha256': sha.decode(), 'byte_size': int(size), 'created_at': created}


def batches(rows, max_bytes=BATCH_BYTES):
    batch, size = [], 0
    for row in rows:
        if len(row) > max_bytes:
            fail('One blob cannot fit in a bounded batch.')
        if batch and size + len(row) > max_bytes:
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += len(row)
    if batch:
        yield batch


def validate_loaded(rows, manifest):
    expected = {row['sha256']: row for row in manifest}
    loaded = set()
    for row in rows:
        key = row.get('sha256')
        if key in loaded or key not in expected or any(row.get(field) != value for field, value in expected[key].items()):
            fail('Staged blob metadata differs from the reviewed manifest.')
        if row.get('actual_sha256') != key or row.get('actual_bytes') != row.get('byte_size'):
            fail('Staged blob actual bytes differ from its digest or size.')
        loaded.add(key)
    return loaded


def restore_command(dump, *args):
    return [str(p.PG_BIN / 'pg_restore'), '--no-owner', '--no-acl', '--exit-on-error', '--file=-', *args, str(dump)]


def blob_rows(dump, folder):
    """Read only archive_blobs from the sealed dump; bound each decoded COPY line."""
    with p.private_file(folder / ('blob-reader-' + p.secrets.token_hex(8) + '.stderr')) as err:
        process = subprocess.Popen(restore_command(dump, '--data-only', '--table=archive_blobs'), stdout=subprocess.PIPE, stderr=err)
        found = ended = False
        try:
            while True:
                line = process.stdout.readline(BATCH_BYTES + 1)
                if not line:
                    break
                if len(line) > BATCH_BYTES:
                    fail('Source COPY line exceeds the bounded batch size.')
                if not found:
                    if line == COPY_HEADER:
                        found = True
                elif line == b'\\.\n':
                    ended = True
                    # Remaining pg_restore trailer must also finish successfully.
                    while process.stdout.read(65536):
                        pass
                    break
                else:
                    yield line
            if not found or not ended or process.wait(timeout=30) != 0:
                fail('Archive blob extraction failed or was truncated.')
        finally:
            p.stop_process(process)
            process.stdout.close()


def prepare(dump, folder, runner, expected_sha, public_counts, final_counts):
    def verify():
        if dump.is_symlink() or not dump.is_file():
            fail('Source dump must remain a regular file.')
        with dump.open('rb') as source:
            if p.sha256(source) != expected_sha:
                fail('Source dump SHA differs from the reviewed archive.')
    verify()
    toc = runner.capture([str(p.PG_BIN / 'pg_restore'), '--list', str(dump)]).decode()
    selected = select_toc(toc)
    toc_file = folder / 'restore.list'
    with p.private_file(toc_file) as out:
        out.write(selected.encode())
    schema = runner.capture(restore_command(dump, '--schema-only', '--table=archive_blobs')).decode()
    definitions = re.findall(r'CREATE TABLE everrate\.archive_blobs \(.*?\n\);', schema, re.S)
    if len(definitions) != 1:
        fail('Source blob table definition is missing or ambiguous.')
    ddl = definitions[0]
    stage_definition(ddl)
    manifest, seen = [], set()
    for line in blob_rows(dump, folder):
        entry = parse_blob(line)
        if entry['sha256'] in seen:
            fail('Source archive has duplicate blob keys.')
        seen.add(entry['sha256'])
        manifest.append(entry)
    manifest.sort(key=lambda row: row['sha256'])
    if len(manifest) != final_counts.get('archive_blobs'):
        fail('Reviewed final blob count differs from source archive.')
    binding = {'version': 1, 'dumpSha256': expected_sha, 'definitionSha256': hashlib.sha256(ddl.encode()).hexdigest(),
               'manifestSha256': digest(manifest), 'publicCounts': public_counts, 'finalCounts': final_counts,
               'blobCount': len(manifest), 'blobBytes': sum(row['byte_size'] for row in manifest)}
    for section in ['pre-data', 'post-data']:
        with p.private_file(folder / (section + '.sql')) as out, p.private_file(folder / (section + '.stderr')) as err:
            process = subprocess.Popen(restore_command(dump, '--section=' + section, '--use-list=' + str(toc_file)), stdout=subprocess.PIPE, stderr=err)
            try:
                for chunk in filter_section(process.stdout):
                    out.write(chunk)
                if process.wait(timeout=30) != 0:
                    fail('Source schema extraction failed.')
            finally:
                p.stop_process(process)
                process.stdout.close()
    with p.private_file(folder / 'manifest.json') as out:
        out.write(canonical(manifest).encode())
    verify()
    return binding, manifest, ddl, verify


def public_fingerprints_sql():
    row_hash = "encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')"
    query = "SELECT count(*)::text||':'||encode(sha256(convert_to(coalesce(string_agg(" + row_hash + ",'' ORDER BY " + row_hash + "),''),'UTF8')),'hex') fingerprint FROM %I.%I t"
    return "SELECT coalesce(json_object_agg(tablename,(xpath('/row/fingerprint/text()',query_to_xml(format(" + literal(query) + ",schemaname,tablename),false,true,'')))[1]::text),'{}'::json) FROM pg_tables WHERE schemaname='public'"


def public_guard(binding):
    if 'publicFingerprints' not in binding:
        fail('Public full-row fingerprints must be bound before writing.')
    return ("SET TIME ZONE 'UTC'; DO $public_guard$ BEGIN IF (" + public_fingerprints_sql() + ")::jsonb IS DISTINCT FROM " + literal(canonical(binding['publicFingerprints'])) + "::jsonb THEN RAISE EXCEPTION 'Public row contents changed'; END IF; END $public_guard$;\n").encode()


def stage_shape_sql():
    # Exact source definition is pinned above. Check live column/default/check semantics,
    # not only a receipt that could survive an accidental staging-table alteration.
    expected = [
        ['sha256', 'text', True, None], ['byte_size', 'bigint', True, None],
        ['data', 'bytea', True, None], ['created_at', 'timestamp with time zone', True, 'now()']]
    checks = ['CHECK ((byte_size >= 0))', 'CHECK ((length(sha256) = 64))', 'CHECK ((octet_length(data) = byte_size))']
    return f"""IF (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,pg_get_expr(adbin,adrelid)) ORDER BY attnum) FROM pg_attribute LEFT JOIN pg_attrdef ON adrelid=attrelid AND adnum=attnum WHERE attrelid='{STAGE}.archive_blobs'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM {literal(canonical(expected))}::jsonb THEN RAISE EXCEPTION 'Staging columns changed'; END IF;
IF (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='{STAGE}.archive_blobs'::regclass AND contype='c') IS DISTINCT FROM {literal(canonical(checks))}::jsonb THEN RAISE EXCEPTION 'Staging checks changed'; END IF;
IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='{STAGE}.archive_blobs'::regclass AND NOT tgisinternal) OR (SELECT relrowsecurity OR relkind<>'r' OR relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_class WHERE oid='{STAGE}.archive_blobs'::regclass) THEN RAISE EXCEPTION 'Staging table behavior changed'; END IF;"""


def stage_guard(binding):
    return public_guard(binding) + f"""DO $stage_guard$ BEGIN
IF (SELECT count(*) FROM {STAGE}.receipt)<>1 OR NOT EXISTS(SELECT 1 FROM {STAGE}.receipt WHERE binding={literal(canonical(binding))}::jsonb) THEN RAISE EXCEPTION 'Staging receipt differs'; END IF;
IF (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace='{STAGE}'::regnamespace AND relkind IN ('r','v','m','S','f','p')) IS DISTINCT FROM ARRAY['archive_blobs','receipt']::text[] THEN RAISE EXCEPTION 'Unexpected staging relations'; END IF;
{stage_shape_sql()}
END $stage_guard$;\n""".encode()


def stage_init(binding, ddl):
    return f"""CREATE SCHEMA {STAGE}; REVOKE ALL ON SCHEMA {STAGE} FROM PUBLIC;
{stage_definition(ddl)}
ALTER TABLE {STAGE}.archive_blobs ADD CONSTRAINT promotion_blob_unique UNIQUE(sha256);
CREATE TABLE {STAGE}.receipt (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), binding jsonb NOT NULL);
INSERT INTO {STAGE}.receipt(binding) VALUES({literal(canonical(binding))}::jsonb);
REVOKE ALL ON ALL TABLES IN SCHEMA {STAGE} FROM PUBLIC;
""".encode() + stage_guard(binding)


def blob_evidence_query(schema, where=''):
    return f"""SELECT coalesce(json_agg(x ORDER BY sha256),'[]'::json) FROM (
SELECT sha256,byte_size,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
encode(sha256(data),'hex') actual_sha256,octet_length(data) actual_bytes FROM {schema}.archive_blobs {where}) x;"""


def manifest_guard(schema, manifest, where=''):
    expected = canonical(sorted(manifest, key=lambda row: row['sha256']))
    return f"""DO $blob_guard$ BEGIN
IF EXISTS(SELECT 1 FROM {schema}.archive_blobs {where + (' AND ' if where else 'WHERE ')} (encode(sha256(data),'hex')<>sha256 OR octet_length(data)<>byte_size)) THEN RAISE EXCEPTION 'Archive blob bytes mismatch'; END IF;
IF (SELECT coalesce(jsonb_agg(jsonb_build_object('sha256',sha256,'byte_size',byte_size,'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY sha256),'[]'::jsonb) FROM {schema}.archive_blobs {where}) IS DISTINCT FROM {literal(expected)}::jsonb THEN RAISE EXCEPTION 'Archive manifest mismatch'; END IF;
END $blob_guard$;\n""".encode()


def batch_sql(rows, binding):
    entries = [parse_blob(row) for row in rows]
    keys = ','.join(literal(row['sha256']) for row in entries)
    sql = stage_guard(binding)
    sql += f'CREATE TEMP TABLE incoming_blobs (LIKE {STAGE}.archive_blobs INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP;\nCOPY incoming_blobs (sha256,byte_size,data,created_at) FROM stdin;\n'.encode()
    sql += b''.join(rows) + b'\\.\n'
    sql += f'INSERT INTO {STAGE}.archive_blobs SELECT * FROM incoming_blobs ON CONFLICT(sha256) DO NOTHING;\n'.encode()
    # Existing rows can win a racing batch only if their actual bytes and timestamps match.
    sql += manifest_guard(STAGE, entries, 'WHERE sha256 IN (' + keys + ')')
    return sql


def run_sql(sql, env, folder, expected, disk_check, suffix=b'', timeout=BATCH_SECONDS):
    """Use the original EOF/monitor checkpoint; SQL is private and bounded."""
    file = folder / 'input.sql'
    with p.private_file(file) as out:
        out.write(b'SET transaction_timeout = 0;\n-- Name: resumable promotion\n' + sql)
    return p.stream_transaction(['/bin/cat', str(file)], PSQL, env, folder,
                                p.guard_sql(expected, before=True), suffix, disk_check, lambda: None,
                                timeout=timeout)


@contextlib.contextmanager
def connection(operation, credentials, identity):
    """Every batch/probe gets a fresh SSH connection and private, deleted pgpass."""
    operation.mkdir(mode=0o700)
    runner = p.Runner(operation)
    tunnel = None
    try:
        tunnel, port = p.open_tunnel(runner, identity)
        env = p.credential_environment(credentials, operation, port)
        metadata = p.readonly_query(runner, env, "SELECT json_build_object('ssl',current_setting('ssl'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'version',current_setting('server_version'));")
        if metadata.get('version') != '15.8' or metadata.get('ssl') not in ('on', 'off'):
            fail('Canonical PostgreSQL compatibility changed.')
        if metadata['ssl'] == 'on':
            env['PGSSLMODE'] = 'require'
            check = p.readonly_query(runner, env, "SELECT json_build_object('tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()));")
            if check.get('tls') is not True:
                fail('PostgreSQL TLS was not negotiated.')
        def disk_check():
            if tunnel.poll() is not None:
                fail('Encrypted tunnel ended.')
            return runner.disk()
        disk_check()
        yield runner, env, disk_check
    finally:
        p.stop_process(tunnel)
        password = operation / 'pgpass'
        if password.exists():
            password.unlink()


def inspect_stage(runner, env, binding, manifest):
    state = p.readonly_query(runner, env, "SELECT json_build_object('everrate_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='everrate'),'stage_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='" + STAGE + "'),'counts',(" + p.counts_query('public') + "));")
    p.assert_destination(state, binding['publicCounts'])
    if not state['stage_exists']:
        return None
    # A read-only DO only validates; no schema/data changes occur during dry run.
    p.readonly_query(runner, env, '\\set QUIET on\n' + stage_guard(binding).decode() + "SELECT '{}'::json;")
    rows = p.readonly_query(runner, env, blob_evidence_query(STAGE))
    return validate_loaded(rows, manifest)


def final_move_sql(binding):
    return stage_guard(binding) + f"""ALTER TABLE {STAGE}.archive_blobs SET SCHEMA everrate;
ALTER TABLE everrate.archive_blobs DROP CONSTRAINT promotion_blob_unique;
DROP TABLE {STAGE}.receipt;
DROP SCHEMA {STAGE};
""".encode()


def emit_final(folder, dump):
    binding = json.loads((folder / 'binding.json').read_text())
    out = sys.stdout.buffer
    out.write(b'SET transaction_timeout = 0;\n-- Name: final resumable promotion\n')
    out.write((folder / 'pre-data.sql').read_bytes())
    out.write(final_move_sql(binding))
    out.flush()
    # No blob table/data recreation and no INSERT SELECT of the full blob archive.
    process = subprocess.Popen(restore_command(dump, '--section=data', '--use-list=' + str(folder / 'restore.list')), stdout=subprocess.PIPE, stderr=sys.stderr.buffer)
    try:
        for chunk in filter_section(process.stdout):
            out.write(chunk)
        if process.wait(timeout=30) != 0:
            fail('Final source-data extraction failed.')
    finally:
        p.stop_process(process)
        process.stdout.close()
    out.write((folder / 'post-data.sql').read_bytes())
    out.flush()


def main(argv=None):
    args = p.parse_args(argv)
    if args.expected_everrate_counts is None:
        fail('Resumable preflight also requires reviewed final counts.')
    public = p.validate_counts(json.loads(args.expected_public_counts.read_text()))
    final = p.validate_counts(json.loads(args.expected_everrate_counts.read_text()))
    folder = Path(tempfile.mkdtemp(prefix='resumable-promotion-', dir=p.ROOT / '.private'))
    os.chmod(folder, 0o700)
    print('Private operation logs:', folder)
    runner = p.Runner(folder)
    for executable in ['psql', 'pg_restore']:
        if not re.search(r'\(PostgreSQL\) 17\.', runner.capture([str(p.PG_BIN / executable), '--version']).decode()):
            fail('Both PostgreSQL clients must be version17.')
    dump = p.ROOT / '.private/everrate-archive-20260915.dump'
    binding, manifest, ddl, verify = prepare(dump, folder, runner, args.expected_sha256, public, final)
    credentials = json.loads((p.ROOT / '.private/railway-legacy.json').read_text())
    p.validate_target({key: credentials.get('pg', {}).get(field) for key, field in [
        ('project_id', 'RAILWAY_PROJECT_ID'), ('environment_id', 'RAILWAY_ENVIRONMENT_ID'),
        ('service_id', 'RAILWAY_SERVICE_ID'), ('volume_id', 'RAILWAY_VOLUME_ID')]})
    with connection(folder / 'preflight', credentials, args.identity_file) as (probe, env, disk):
        binding['publicFingerprints'] = p.readonly_query(probe, env, '\\set QUIET on\nSET TIME ZONE \'UTC\';\n' + public_fingerprints_sql() + ';')
        loaded = inspect_stage(probe, env, binding, manifest)
        print('Preflight passed; source blobs:', len(manifest), '; verified staged:', len(loaded or []))
        if not args.apply:
            print('DRY RUN: no remote writes. Staging and release require --apply.')
            return 0
        if loaded is None:
            run_sql(stage_init(binding, ddl), env, folder / 'preflight', public, disk)
            loaded = set()
    with p.private_file(folder / 'binding.json') as out:
        out.write(canonical(binding).encode())
    expected = {row['sha256']: row for row in manifest}
    def missing_rows():
        for line in blob_rows(dump, folder):
            entry = parse_blob(line)
            if expected.get(entry['sha256']) != entry:
                fail('Source blob changed after reviewed manifest extraction.')
            if entry['sha256'] not in loaded:
                yield line
    for number, rows in enumerate(batches(missing_rows()), 1):
        operation = folder / f'batch-{number:04d}'
        try:
            with connection(operation, credentials, args.identity_file) as (_, env, disk):
                run_sql(batch_sql(rows, binding), env, operation, public, disk)
            loaded.update(parse_blob(row)['sha256'] for row in rows)
            print('Verified staged blobs:', len(loaded), '/', len(manifest), flush=True)
        finally:
            file = operation / 'input.sql'
            if file.exists():
                file.unlink()  # no retained local copies of blob batch SQL
    verify()
    with connection(folder / 'final', credentials, args.identity_file) as (probe, env, disk):
        if inspect_stage(probe, env, binding, manifest) != set(expected):
            fail('Staged archive is incomplete.')
        suffix = public_guard(binding) + p.guard_sql(public, before=False) + p.restored_counts_sql(final) + manifest_guard('everrate', manifest)
        p.stream_transaction([sys.executable, str(Path(__file__).resolve()), '--emit-final', str(folder), str(dump)],
                             PSQL, env, folder / 'final', p.guard_sql(public, before=True), suffix,
                             disk, verify, timeout=900)
    print('Promotion committed; complete blob archive moved without copying. Verify runtime permissions and app behavior.')
    return 0


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == '--emit-final':
            emit_final(Path(sys.argv[2]), Path(sys.argv[3]))
        else:
            sys.exit(main())
    except KeyboardInterrupt:
        print('Interrupted; completed staged batches remain reusable. Inspect release state before retry.', file=sys.stderr)
        sys.exit(130)
    except Exception:
        print('Resumable promotion stopped; inspect private logs and reconcile state read-only before retry. No credentials or record contents printed.', file=sys.stderr)
        sys.exit(1)
