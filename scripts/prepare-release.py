#!/usr/bin/env python3
"""Prepare an allowlisted committed release and private runtime configuration locally."""
import argparse
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'Dockerfile', '.dockerignore', '.railwayignore', 'railway.toml', 'package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json'}
PROJECT = '15f6b10e-fb42-42fa-b83c-988a09fae42a'
ENVIRONMENT = 'f42f3c21-f3ae-4651-859e-7d4fde685162'
WEB_SERVICE = '280a7c2d-6bf2-4761-aec1-ac3428d543f0'
PG_SERVICE = 'c75c254b-911d-4014-895f-a9d969890fac'
APP_URL = 'https://web-production-00050.up.railway.app'
AUTH_URL = 'https://gateway-production-2db8.up.railway.app'
PRIVATE_DIRS = {'.private', 'private', '.git', '.ssh', 'node_modules', 'tests', '__tests__', 'media', 'export', 'exports', 'attachments', 'archive', 'archives', 'backups', 'out', 'coverage', '.next', '.cache'}
PRIVATE_SUFFIXES = {'.dump', '.bak', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db', '.csv', '.zip', '.tar', '.gz', '.tgz', '.log', '.jsonl'}
UNNEEDED_PRIVILEGED_KEYS = {'MIGRATION_DATABASE_URL', 'LEGACY_DATABASE_URL', 'POSTGRES_PASSWORD', 'PGPASSWORD', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SERVICE_ROLE_KEY'}


OPERATOR_INSTRUCTIONS = """# Proposed Railway variable update (not executed by this helper)

Review web-variables.json and review.json privately, verify the runtime role exists,
and refresh existing variable NAMES before deciding whether listed privileged keys
still require removal. The snapshot is historical, not a live variable inventory.

The installed CLI supports one key/value per --stdin invocation. Use --skip-deploys
on every update. It can print values, so capture both output streams in a new 0600
file. Do not use shell expansion to put secret values into command arguments.

After the root authorizes this operation, run the following with the generated
configuration file and a new private log path as its two arguments:

python3 - "$EVERRATE_VARIABLES_JSON" "$EVERRATE_VARIABLE_UPDATE_LOG" <<'UPDATE'
import json, os, re, subprocess, sys
values = json.load(open(sys.argv[1]))
assert values and all(re.fullmatch(r'[A-Z][A-Z0-9_]*', k) and isinstance(v, str) and v for k, v in values.items())
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'wb') as log:
    for key, value in values.items():
        subprocess.run(['railway', 'variable', 'set', key, '--stdin', '--skip-deploys',
            '--project', '15f6b10e-fb42-42fa-b83c-988a09fae42a',
            '--environment', 'f42f3c21-f3ae-4651-859e-7d4fde685162',
            '--service', '280a7c2d-6bf2-4761-aec1-ac3428d543f0'],
            input=value.encode(), stdout=log, stderr=log, check=True)
UPDATE

This updates variables sequentially, not atomically. A failure can leave a partial
update; rerun the full reviewed set with skip-deploys before uploading the release.
No deletion or deployment command is included. Upload only the stage subdirectory,
never this preparation directory containing credentials and logs.
"""


class PrepError(Exception):
    """Fixed public error messages only; never include configuration values."""


def valid_sha(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{40}', value):
        raise PrepError('Release must be a complete lowercase Git commit SHA.')
    return value


def git(repo, *args):
    result = subprocess.run(['git', '--no-replace-objects', '-C', str(repo), *args], capture_output=True)
    if result.returncode:
        raise PrepError('Git could not resolve the reviewed source commit.')
    return result.stdout


def allowed_file(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or any(ord(c) < 32 for c in name):
        raise PrepError('Source tree contains an unsafe path.')
    included = name in ROOT_FILES or (len(path.parts) > 1 and path.parts[0] in {'src', 'public'})
    if not included:
        return False
    if (any(part.lower() in PRIVATE_DIRS for part in path.parts)
            or any(part.lower().startswith('.env') for part in path.parts)
            or path.suffix.lower() in PRIVATE_SUFFIXES
            or re.search(r'\.(test|spec)\.', path.name, re.I)
            or path.name == '.DS_Store'
            or path.name.lower() in {'web-variables.json', 'runtime-variables.json', 'variables.json', 'runtime-role-password'}
            or re.match(r'(credentials|secrets|snapshot)([.-]|$)', path.name, re.I)):
        raise PrepError('Private or test material exists inside an allowed source directory.')
    return True


def stage_commit(repo, release, destination):
    valid_sha(release)
    if destination.exists() or destination.is_symlink():
        raise PrepError('Staging destination already exists; refusing to overwrite it.')
    resolved = git(repo, 'rev-parse', '--verify', release + '^{commit}').decode().strip()
    if resolved != release:
        raise PrepError('Source is not the exact requested commit.')
    entries = []
    for raw in git(repo, 'ls-tree', '-rz', '--full-tree', release).split(b'\0'):
        if not raw:
            continue
        metadata, raw_name = raw.split(b'\t', 1)
        mode, kind, object_id = metadata.decode('ascii').split()
        name = raw_name.decode('utf-8')
        if not allowed_file(name):
            continue
        if kind != 'blob' or mode not in {'100644', '100755'}:
            raise PrepError('Allowed directories contain a symlink or submodule; review it before staging.')
        entries.append((name, mode, object_id))
    names = {name for name, _, _ in entries}
    if not ROOT_FILES <= names or not any(name.startswith('src/') for name in names) or not any(name.startswith('public/') for name in names):
        raise PrepError('The commit does not contain every required release file plus src and public.')
    destination.mkdir(mode=0o700, parents=False)
    total = 0
    try:
        for name, mode, object_id in entries:
            size = int(git(repo, 'cat-file', '-s', object_id))
            if size > 32 * 1024 * 1024 or total + size > 100 * 1024 * 1024:
                raise PrepError('Staged source exceeds the reviewed size bounds.')
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o755 if mode == '100755' else 0o644)
            with os.fdopen(fd, 'wb') as output:
                result = subprocess.run(['git', '--no-replace-objects', '-C', str(repo), 'cat-file', 'blob', object_id], stdout=output, stderr=subprocess.DEVNULL)
            if result.returncode or target.stat().st_size != size:
                raise PrepError('Git blob staging failed or produced an unexpected size.')
            total += size
        return {'release': release, 'path': str(destination.resolve()), 'files': len(entries), 'bytes': total, 'filenames': sorted(names)}
    except BaseException:
        shutil.rmtree(destination)
        raise


def parse_env(text):
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:]
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)', line)
        if not match:
            raise PrepError('Environment file contains an unsupported assignment.')
        key, value = match.groups()
        if key in result:
            raise PrepError('Environment file contains a duplicate variable.')
        try:
            words = shlex.split(value, comments=True, posix=True)
        except ValueError as error:
            raise PrepError('Environment file contains unsupported quoting.') from error
        if len(words) > 1:
            raise PrepError('Environment values containing spaces must be quoted.')
        result[key] = words[0] if words else ''
    return result


def required(values, key):
    value = values.get(key)
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise PrepError('A required runtime configuration value is missing or invalid: ' + key)
    return value


def runtime_variables(env, pg, password, release):
    valid_sha(release)
    for key, expected in [('RAILWAY_PROJECT_ID', PROJECT), ('RAILWAY_ENVIRONMENT_ID', ENVIRONMENT), ('RAILWAY_SERVICE_ID', PG_SERVICE)]:
        if pg.get(key) != expected:
            raise PrepError('Private PostgreSQL snapshot does not match canonical target IDs.')
    host = required(pg, 'RAILWAY_PRIVATE_DOMAIN')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.railway\.internal', host) or pg.get('RAILWAY_TCP_APPLICATION_PORT') != '5432':
        raise PrepError('Database connection must use the canonical internal Railway hostname and port.')
    if not password or password != password.strip() or any(ord(c) < 32 for c in password):
        raise PrepError('Runtime-role password file is empty or malformed.')
    public_url = required(env, 'NEXT_PUBLIC_SUPABASE_URL')
    if public_url.rstrip('/') != AUTH_URL:
        raise PrepError('Public Supabase URL differs from the reviewed Auth gateway.')
    public_key = required(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if public_key.startswith('sb_secret_'):
        raise PrepError('A secret Supabase key cannot be used in public build variables.')
    if public_key.count('.') == 2:
        try:
            payload = public_key.split('.')[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        except (ValueError, TypeError):
            raise PrepError('Public Supabase JWT metadata is malformed.')
        if not isinstance(claims, dict) or claims.get('role') != 'anon':
            raise PrepError('Public Supabase JWT must carry the anon role.')
    encryption = required(env, 'DISCORD_ENCRYPTION_KEY')
    if not re.fullmatch('[a-fA-F0-9]{64}', encryption):
        raise PrepError('Discord encryption key must contain 64 hexadecimal characters.')
    model = required(env, 'GEMINI_MODEL')
    if not re.fullmatch('gemini-[a-z0-9.-]+', model):
        raise PrepError('Existing Gemini model is invalid.')
    database_url = 'postgresql://everrate_app:' + quote(password, safe='') + '@' + host + ':5432/' + quote(required(pg, 'POSTGRES_DB'), safe='')
    return {
        'DATABASE_URL': database_url,
        'NEXT_PUBLIC_SUPABASE_URL': public_url,
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': public_key,
        'APP_URL': APP_URL, 'APP_RELEASE': release,
        'GEMINI_API_KEY': required(env, 'GEMINI_API_KEY'), 'GEMINI_MODEL': model,
        'DISCORD_ENCRYPTION_KEY': encryption, 'RAILWAY_DOCKERFILE_PATH': 'Dockerfile',
    }


def write_private_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write('\n')


def read_private(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise PrepError('Configuration inputs must be private regular files with mode 0600.')
    return path.read_text()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True, help='Complete reviewed source commit SHA')
    args = parser.parse_args(argv)
    valid_sha(args.release)
    env = parse_env(read_private(ROOT / '.env.local'))
    snapshot = json.loads(read_private(ROOT / '.private/railway-legacy.json'))
    password = read_private(ROOT / '.private/runtime-role-password').removesuffix('\n')
    variables = runtime_variables(env, snapshot.get('pg', {}), password, args.release)
    output = Path(tempfile.mkdtemp(prefix='release-prep-', dir=ROOT / '.private'))
    os.chmod(output, 0o700)
    try:
        report = stage_commit(ROOT, args.release, output / 'stage')
        write_private_json(output / 'web-variables.json', variables)
        removals = sorted(UNNEEDED_PRIVILEGED_KEYS.intersection(snapshot.get('web', {})))
        write_private_json(output / 'review.json', {**report, 'variableKeys': sorted(variables), 'removeIfStillPresent': removals, 'projectId': PROJECT, 'environmentId': ENVIRONMENT, 'serviceId': WEB_SERVICE})
        fd = os.open(output / 'operator-commands.md', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as instructions:
            instructions.write(OPERATOR_INSTRUCTIONS)
        print(json.dumps({'stage': report['path'], 'release': args.release, 'files': report['files'], 'bytes': report['bytes'], 'variablesFile': str(output / 'web-variables.json'), 'reviewFile': str(output / 'review.json'), 'removeIfStillPresent': removals}, indent=2))
        print('Prepared locally only. No Railway variables were changed and no release was uploaded.')
        return 0
    except BaseException:
        shutil.rmtree(output)
        raise


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PrepError as error:
        print('Release preparation stopped:', error, file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Release preparation stopped unexpectedly; no credentials or raw subprocess output were printed.', file=sys.stderr)
        sys.exit(1)
