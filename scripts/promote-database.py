#!/usr/bin/env python3
"""Reviewed, additive TasteBuds promotion. Defaults to read-only preflight."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time

PROJECT = '15f6b10e-fb42-42fa-b83c-988a09fae42a'
ENVIRONMENT = 'f42f3c21-f3ae-4651-859e-7d4fde685162'
SERVICE = 'c75c254b-911d-4014-895f-a9d969890fac'
VOLUME = 'a3ce1826-dfa2-4832-9131-775b545d5fc0'
ROOT = Path(__file__).resolve().parents[1]
PG_BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
MAX_USED_MB = 4500
CHUNK = 65536


class GuardError(Exception):
    """Only fixed, non-sensitive operator messages belong in this exception."""


def validate_target(args):
    for key, expected in [('project_id', PROJECT), ('environment_id', ENVIRONMENT), ('service_id', SERVICE), ('volume_id', VOLUME)]:
        if args.get(key) != expected:
            raise GuardError('Target IDs do not match the reviewed canonical database.')


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--expected-public-counts', type=Path, required=True)
    parser.add_argument('--expected-everrate-counts', type=Path)
    for name in ['project', 'environment', 'service', 'volume']:
        parser.add_argument('--' + name + '-id', required=True)
    parser.add_argument('--identity-file', type=Path, default=ROOT / '.private/ssh/everrate-promotion-20260915')
    args = parser.parse_args(argv)
    validate_target(vars(args))
    if not re.fullmatch('[a-f0-9]{64}', args.expected_sha256):
        raise GuardError('Expected SHA-256 must be 64 lowercase hexadecimal characters.')
    if args.apply and args.expected_everrate_counts is None:
        raise GuardError('Apply requires reviewed expected TasteBuds table counts.')
    return args


def filter_dump(source):
    """Remove one exact PG17 header SET; stream every subsequent byte unchanged."""
    header, removed = bytearray(), 0
    while len(header) < CHUNK:
        line = source.readline(CHUNK + 1)
        if len(line) > CHUNK or not line:
            raise GuardError('Unexpected or truncated dump header.')
        if line.startswith(b'-- Name: '):
            if removed != 1:
                raise GuardError('Expected exactly one transaction_timeout header setting.')
            header.extend(line)
            if len(header) > CHUNK:
                raise GuardError('Dump header exceeds the bounded header size.')
            yield bytes(header)
            break
        if line == b'SET transaction_timeout = 0;\n':
            removed += 1
        else:
            header.extend(line)
    else:
        raise GuardError('Dump header exceeds the bounded header size.')
    while chunk := source.read(CHUNK):
        yield chunk


def assert_destination(snapshot, expected):
    if snapshot.get('everrate_exists') is not False:
        raise GuardError('The destination everrate schema must be absent.')
    if snapshot.get('counts') != expected:
        raise GuardError('Legacy public table names or counts differ from the reviewed expectations.')


def validate_counts(value):
    if not isinstance(value, dict) or not value:
        raise GuardError('Expected counts must be a nonempty JSON table-name/count object.')
    if any(not re.fullmatch('[a-z_][a-z0-9_]*', name) or type(count) is not int or count < 0 for name, count in value.items()):
        raise GuardError('Expected count names or values are invalid.')
    return value


def volume_used(payload):
    volumes = [v for v in payload.get('volumes', []) if v.get('id') == VOLUME]
    if len(volumes) != 1:
        raise GuardError('Canonical Railway volume is missing or ambiguous.')
    volume = volumes[0]
    used, capacity = volume.get('currentSizeMB'), volume.get('sizeMB')
    if (type(used) not in (int, float) or not math.isfinite(used) or used < 0
            or type(capacity) not in (int, float) or not math.isfinite(capacity) or capacity < 5000
            or volume.get('status') != 'Ready' or volume.get('deletedAt') is not None or volume.get('isPendingDeletion') is not False):
        raise GuardError('Canonical volume metrics or state are invalid.')
    if used > MAX_USED_MB:
        raise DiskLimit('Canonical volume exceeds the 4500 MB abort threshold.')
    return used


def assert_archive_scope(toc):
    schemas = 0
    for line in toc.splitlines():
        if not line or line.startswith(';'):
            continue
        match = re.fullmatch(r'\d+; \d+ \d+ (SCHEMA|TABLE DATA|TABLE|COMMENT|FK CONSTRAINT|CONSTRAINT|INDEX) (\S+) (.+)', line)
        if not match:
            raise GuardError('Archive contains an unreviewed entry type.')
        kind, schema, name = match.groups()
        if kind == 'SCHEMA':
            if schema != '-' or name.split()[0] != 'everrate':
                raise GuardError('Archive contains an unexpected schema.')
            schemas += 1
        elif schema != 'everrate':
            raise GuardError('Archive contains an object outside everrate.')
    if schemas != 1:
        raise GuardError('Archive must contain exactly one everrate schema.')


def sha256(source):
    source.seek(0)
    digest = hashlib.sha256()
    while chunk := source.read(1024 * 1024):
        digest.update(chunk)
    source.seek(0)
    return digest.hexdigest()


def private_file(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')


def stop_process(process):
    if process is not None and process.poll() is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


class Runner:
    def __init__(self, folder):
        self.folder, self.serial = folder, 0
        self.lock = threading.Lock()

    def capture(self, command, *, env=None, data=None, source=None, timeout=30):
        with self.lock:
            self.serial += 1
            prefix = self.folder / str(self.serial)
        with private_file(str(prefix) + '.stdout') as out, private_file(str(prefix) + '.stderr') as err:
            try:
                result = subprocess.run(command, input=data, stdout=out, stderr=err, env=env, timeout=timeout, stdin=source)
            except (OSError, subprocess.TimeoutExpired) as error:
                raise GuardError('A guarded subprocess failed or timed out; inspect the private logs.') from error
        if result.returncode:
            raise GuardError('A guarded subprocess returned nonzero; inspect the private logs.')
        path = Path(str(prefix) + '.stdout')
        if path.stat().st_size > 2 * 1024 * 1024:
            raise GuardError('Unexpectedly large subprocess metadata output.')
        return path.read_bytes()

    def disk(self):
        raw = self.capture(['railway', 'volume', '--project', PROJECT, '--environment', ENVIRONMENT, '--service', SERVICE, 'list', '--json'], timeout=15)
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError) as error:
            raise GuardError('Railway returned invalid volume metadata.') from error
        return volume_used(payload)


def counts_query(schema):
    # query_to_xml runs only identifier-quoted SELECT count(*) on actual tables.
    return f"""SELECT coalesce(json_object_agg(tablename, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) n FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint), '{{}}'::json) FROM pg_tables WHERE schemaname='{schema}'"""


def guard_sql(expected, *, before):
    expected_json = json.dumps(expected, separators=(',', ':'))
    existence = "IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='everrate') THEN RAISE EXCEPTION 'Destination schema exists'; END IF;" if before else "IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='everrate') THEN RAISE EXCEPTION 'Destination schema missing'; END IF;"
    lock = "IF NOT pg_try_advisory_xact_lock(174836509, 20260915) THEN RAISE EXCEPTION 'Another promotion is active'; END IF;" if before else ''
    return f"DO $promotion_guard$ BEGIN {lock} {existence} IF ({counts_query('public')})::jsonb <> '{expected_json}'::jsonb THEN RAISE EXCEPTION 'Public counts changed'; END IF; END $promotion_guard$;\n".encode()


def restored_counts_sql(expected):
    expected_json = json.dumps(expected, separators=(',', ':'))
    return f"DO $promotion_guard$ BEGIN IF ({counts_query('everrate')})::jsonb <> '{expected_json}'::jsonb THEN RAISE EXCEPTION 'Restored counts differ'; END IF; IF EXISTS(SELECT 1 FROM everrate.discord_outbox) THEN RAISE EXCEPTION 'Imported outbox is not empty'; END IF; END $promotion_guard$;\n".encode()


class DiskLimit(GuardError):
    pass


class DiskMonitor:
    """Any high-water observation aborts immediately; two failed samples abort."""
    def __init__(self, check, abort, interval=2, deadline=None):
        self.check, self.abort, self.interval = check, abort, interval
        self.deadline = deadline
        self.stopped = threading.Event()
        self.failure = None
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        failures = 0
        while not self.stopped.wait(self.interval):
            if self.deadline is not None and time.monotonic() > self.deadline:
                self.failure = GuardError('Promotion streaming deadline exceeded.')
                self.abort()
                return
            try:
                used = self.check()
                if used > MAX_USED_MB:
                    raise DiskLimit('Canonical volume exceeds the 4500 MB abort threshold.')
                failures = 0
            except DiskLimit as error:
                self.failure = error
            except Exception:
                failures += 1
                if failures >= 2:
                    self.failure = GuardError('Volume monitoring failed twice; transaction aborted.')
            if self.failure:
                self.abort()
                return

    def assert_healthy(self):
        if self.failure:
            raise self.failure

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=20)
        if self.thread.is_alive():
            raise GuardError('Volume monitor did not stop cleanly.')


def write_all(stream, data):
    remaining = memoryview(data)
    while remaining:
        count = stream.write(remaining)
        if not count:
            raise GuardError('Database input stream stopped accepting data.')
        remaining = remaining[count:]


def stream_transaction(restore_command, psql_command, env, folder, prefix, suffix, disk_check,
                       verify_source, *, source=None, interval=2, timeout=7200):
    """Hold stdin open until a marker proves all SQL ran and final guards pass."""
    writer = reader = None
    monitor = None
    marker = ('EVERRATE_READY_' + secrets.token_hex(16)).encode()
    ready = threading.Event()
    output_error = threading.Event()
    deadline = time.monotonic() + timeout
    logs = [private_file(folder / name) for name in ['restore.stderr', 'psql.stdout', 'psql.stderr']]
    restored_err, psql_out, psql_err = logs
    output_thread = None
    try:
        writer = subprocess.Popen(psql_command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=psql_err, env=env, bufsize=0)
        def abort():
            # Terminate the session before closing stdin, otherwise psql could COMMIT.
            stop_process(writer)
            stop_process(reader)

        def copy_output():
            try:
                for line in iter(writer.stdout.readline, b''):
                    psql_out.write(line)
                    psql_out.flush()
                    if line.rstrip(b'\r\n') == marker:
                        ready.set()
            except Exception:
                output_error.set()
                abort()

        output_thread = threading.Thread(target=copy_output, daemon=True)
        output_thread.start()
        monitor = DiskMonitor(disk_check, abort, interval, deadline)
        monitor.thread.start()
        write_all(writer.stdin, prefix)
        reader = subprocess.Popen(restore_command, stdout=subprocess.PIPE, stderr=restored_err, stdin=source)
        for chunk in filter_dump(reader.stdout):
            monitor.assert_healthy()
            if time.monotonic() > deadline:
                raise GuardError('Promotion streaming deadline exceeded.')
            write_all(writer.stdin, chunk)
        if reader.wait(timeout=30) != 0:
            raise GuardError('pg_restore failed; the transaction was not released to commit.')
        verify_source()
        monitor.assert_healthy()
        write_all(writer.stdin, b'\n' + suffix + b'\n\\echo ' + marker + b'\n')
        writer.stdin.flush()
        while not ready.wait(.1):
            monitor.assert_healthy()
            if writer.poll() is not None or output_error.is_set():
                raise GuardError('Restore SQL failed before the commit checkpoint.')
            if time.monotonic() > deadline:
                raise GuardError('Restore SQL checkpoint timed out.')
        # Wait for every SQL statement, then take a fresh measurement before EOF.
        monitor.close()
        monitor.assert_healthy()
        if disk_check() > MAX_USED_MB:
            raise DiskLimit('Final disk check exceeded the abort threshold.')
        if writer.poll() is not None:
            raise GuardError('Database session ended before commit authorization.')
        writer.stdin.close()  # psql --single-transaction commits only now.
        if writer.wait(timeout=60) != 0:
            raise GuardError('Commit result is not confirmed; inspect the destination read-only before retrying.')
        return True
    except BaseException:
        stop_process(writer)
        stop_process(reader)
        raise
    finally:
        if monitor:
            monitor.stopped.set()
            monitor.thread.join(timeout=20)
        for process in [reader, writer]:
            stop_process(process)
            if process:
                for stream in [getattr(process, 'stdin', None), getattr(process, 'stdout', None)]:
                    if stream and not stream.closed:
                        stream.close()
        if output_thread:
            output_thread.join(timeout=5)
        for log in logs:
            log.close()


def credential_environment(snapshot, folder, port):
    pg = snapshot.get('pg', {})
    validate_target({key: pg.get(field) for key, field in [
        ('project_id', 'RAILWAY_PROJECT_ID'), ('environment_id', 'RAILWAY_ENVIRONMENT_ID'),
        ('service_id', 'RAILWAY_SERVICE_ID'), ('volume_id', 'RAILWAY_VOLUME_ID')]})
    if pg.get('RAILWAY_TCP_APPLICATION_PORT') != '5432':
        raise GuardError('Unexpected canonical database container port.')
    values = [pg.get('POSTGRES_DB'), pg.get('POSTGRES_USER'), pg.get('POSTGRES_PASSWORD')]
    if any(not isinstance(value, str) or not value or '\n' in value or '\r' in value for value in values):
        raise GuardError('Invalid private credential snapshot.')
    escaped = [value.replace('\\', '\\\\').replace(':', '\\:') for value in values]
    password_file = folder / 'pgpass'
    with private_file(password_file) as output:
        output.write(f'127.0.0.1:{port}:{escaped[0]}:{escaped[1]}:{escaped[2]}\n'.encode())
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    env.update(PGHOST='127.0.0.1', PGPORT=str(port), PGDATABASE=values[0], PGUSER=values[1],
               PGPASSFILE=str(password_file), PGSSLMODE='prefer', PGCONNECT_TIMEOUT='10',
               PGAPPNAME='everrate-reviewed-promotion')
    return env


def ssh_command(config, identity, port):
    marker = f'# BEGIN railway:{PROJECT}:{ENVIRONMENT}:{SERVICE}'
    if marker not in config.splitlines():
        raise GuardError('SSH config target marker does not match canonical IDs.')
    hosts = re.findall(r'^\s*HostName\s+(\S+)\s*$', config, re.M)
    users = re.findall(r'^\s*User\s+(\S+)\s*$', config, re.M)
    if hosts != ['ssh.railway.com'] or len(users) != 1 or not re.fullmatch('[a-f0-9-]{36}', users[0]):
        raise GuardError('Unexpected Railway SSH target metadata.')
    # Construct only reviewed arguments; never execute generated arbitrary SSH directives.
    return ['ssh', '-F', '/dev/null', '-i', str(identity), '-N', '-o', 'IdentitiesOnly=yes',
            '-o', 'IdentityAgent=none', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'Compression=yes',
            '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
            '-L', f'127.0.0.1:{port}:127.0.0.1:5432', users[0] + '@ssh.railway.com']


def open_tunnel(runner, identity):
    if identity.is_symlink() or not identity.is_file() or identity.stat().st_mode & 0o077:
        raise GuardError('Dedicated SSH identity must be a regular private file with mode 0600.')
    config = runner.capture(['railway', 'ssh', 'config', '--project', PROJECT, '--environment', ENVIRONMENT,
                             '--service', SERVICE, '--alias', 'everrate-promotion', '--dry-run']).decode()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with private_file(runner.folder / 'ssh.stdout') as out, private_file(runner.folder / 'ssh.stderr') as err:
        process = subprocess.Popen(ssh_command(config, identity.resolve(), port), stdin=subprocess.DEVNULL, stdout=out, stderr=err)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise GuardError('Encrypted SSH tunnel failed; inspect the private SSH log.')
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                    return process, port
            except OSError:
                time.sleep(.1)
        raise GuardError('Encrypted SSH tunnel did not become ready.')
    except BaseException:
        stop_process(process)
        raise


def readonly_query(runner, env, sql):
    readonly = dict(env, PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000')
    raw = runner.capture([str(PG_BIN / 'psql'), '-X', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--file=-'], env=readonly, data=sql.encode(), timeout=45)
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as error:
        raise GuardError('Read-only database probe returned invalid metadata.') from error


def main(argv=None):
    args = parse_args(argv)
    expected = validate_counts(json.loads(args.expected_public_counts.read_text()))
    restored = validate_counts(json.loads(args.expected_everrate_counts.read_text())) if args.expected_everrate_counts else None
    private_dir = ROOT / '.private'
    folder = Path(tempfile.mkdtemp(prefix='promotion-', dir=private_dir))
    os.chmod(folder, 0o700)
    print('Private operation logs:', folder)
    runner = Runner(folder)
    tunnel = None
    try:
        for executable in ['psql', 'pg_restore']:
            version = runner.capture([str(PG_BIN / executable), '--version']).decode()
            if not re.search(r'\(PostgreSQL\) 17\.', version):
                raise GuardError('Both local PostgreSQL clients must be version 17.')
        dump_path = private_dir / 'everrate-archive-20260915.dump'
        if dump_path.is_symlink():
            raise GuardError('Dump path must not be a symlink.')
        with dump_path.open('rb') as source:
            def verify_source():
                if sha256(source) != args.expected_sha256:
                    raise GuardError('Dump SHA-256 differs from the reviewed source.')
            verify_source()
            toc = runner.capture([str(PG_BIN / 'pg_restore'), '--list'], source=source).decode()
            source.seek(0)
            assert_archive_scope(toc)
            used = runner.disk()
            snapshot = json.loads((private_dir / 'railway-legacy.json').read_text())
            # Validate credential target before opening the encrypted connection.
            validate_target({key: snapshot.get('pg', {}).get(field) for key, field in [
                ('project_id', 'RAILWAY_PROJECT_ID'), ('environment_id', 'RAILWAY_ENVIRONMENT_ID'),
                ('service_id', 'RAILWAY_SERVICE_ID'), ('volume_id', 'RAILWAY_VOLUME_ID')]})
            tunnel, port = open_tunnel(runner, args.identity_file)
            env = credential_environment(snapshot, folder, port)
            metadata = readonly_query(runner, env, "SELECT json_build_object('ssl',current_setting('ssl'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'version',current_setting('server_version'));\n")
            if metadata.get('ssl') == 'on':
                env['PGSSLMODE'] = 'require'
                metadata = readonly_query(runner, env, "SELECT json_build_object('ssl',current_setting('ssl'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'version',current_setting('server_version'));\n")
                if metadata.get('tls') is not True:
                    raise GuardError('PostgreSQL TLS is available but was not negotiated.')
            elif metadata.get('ssl') != 'off':
                raise GuardError('Unknown PostgreSQL TLS configuration.')
            if metadata.get('version') != '15.8':
                raise GuardError('Canonical server version changed; review compatibility before promotion.')
            state = readonly_query(runner, env, "SELECT json_build_object('everrate_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='everrate'),'counts',(" + counts_query('public') + "));\n")
            assert_destination(state, expected)
            print(f'Preflight passed: canonical IDs, SHA-256, archive scope, schema absence, public counts; disk {used:.2f}/5000 MB; SSH encrypted, PostgreSQL TLS {metadata["ssl"]}.')
            if not args.apply:
                print('DRY RUN: no database restore or writes performed. Final backfill dump and counts must be reviewed before --apply.')
                return 0
            def disk_check():
                if tunnel.poll() is not None:
                    raise GuardError('Encrypted tunnel ended.')
                return runner.disk()
            disk_check()
            source.seek(0)
            stream_transaction(
                [str(PG_BIN / 'pg_restore'), '--no-owner', '--no-acl', '--exit-on-error', '--file=-'],
                [str(PG_BIN / 'psql'), '-X', '-q', '-A', '-t', '--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file=-'],
                env, folder, guard_sql(expected, before=True), guard_sql(expected, before=False) + restored_counts_sql(restored),
                disk_check, verify_source, source=source)
            print('Promotion committed. Verify restored hashes, permissions and app behavior separately before launch.')
            return 0
    finally:
        stop_process(tunnel)
        password_file = folder / 'pgpass'
        if password_file.exists():
            password_file.unlink()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except GuardError as error:
        print('Promotion stopped:', str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Promotion interrupted; verify transaction outcome read-only before retrying.', file=sys.stderr)
        sys.exit(130)
    except Exception:
        print('Promotion stopped unexpectedly. Inspect private logs; no raw error or credentials were printed.', file=sys.stderr)
        sys.exit(1)
