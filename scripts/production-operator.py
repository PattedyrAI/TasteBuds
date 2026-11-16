#!/usr/bin/env python3
"""Runs one reviewed operator change against production through the encrypted SSH tunnel of
promote-database.py (the same tunnel promote-resumable.py reuses).

PostgreSQL TLS is off on the canonical service, so the database is reached only as
127.0.0.1 -> SSH -> the pg container; there is no public-TCP option. Credentials come from the
private canonical snapshot (target IDs verified) through a temporary 0600 pgpass file, never
arguments or output.

  python3 scripts/production-operator.py --identity-file .private/ssh/<key> category --spec=<file> [--apply]
  python3 scripts/production-operator.py --identity-file .private/ssh/<key> plan-merges --review=<review.json> --evidence="<who reviewed what, when>"
  python3 scripts/production-operator.py --identity-file .private/ssh/<key> apply-plan --plan=<file> [--apply]

category and apply-plan validate and roll back unless --apply is given; plan-merges only reads.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import quote

spec = importlib.util.spec_from_file_location('promotion', Path(__file__).with_name('promote-database.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

MAX_INPUT = 2 * 1024 * 1024


def private_input(value):
    """Plans, specs and reviews are private operator files: regular, owner-only, small."""
    path = Path(value)
    try:
        info = path.lstat()
    except OSError as error:
        raise argparse.ArgumentTypeError('input file not found') from error
    if not path.is_file() or path.is_symlink() or info.st_mode & 0o077 or info.st_size > MAX_INPUT:
        raise argparse.ArgumentTypeError('input must be a regular 0600 file under 2 MiB')
    return path.resolve()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--identity-file', type=Path, required=True)
    parser.add_argument('--credentials', type=private_input, default=None,
                        help='canonical snapshot (default .private/railway-legacy.json)')
    sub = parser.add_subparsers(dest='operation', required=True)
    category = sub.add_parser('category')
    category.add_argument('--spec', type=private_input, required=True)
    category.add_argument('--apply', action='store_true')
    plan = sub.add_parser('plan-merges')
    plan.add_argument('--review', type=private_input, required=True)
    plan.add_argument('--evidence', required=True)
    apply = sub.add_parser('apply-plan')
    apply.add_argument('--plan', type=private_input, required=True)
    apply.add_argument('--apply', action='store_true')
    return parser.parse_args(argv)


def child_command(args, database, port):
    """Only these reviewed entry points ever run; returns (argv, extra environment)."""
    if args.operation == 'plan-merges':
        # No credential in the URL: node-postgres reads the private pgpass file from the environment.
        url = f'postgresql://127.0.0.1:{port}/{quote(database, safe="")}'
        return (['npx', 'tsx', 'scripts/plan-same-product-merges.ts', f'--plan={args.review}', f'--evidence={args.evidence}'],
                {'SAME_PRODUCT_DATABASE_URL': url})
    flag = '--spec' if args.operation == 'category' else '--plan'
    source = args.spec if args.operation == 'category' else args.plan
    return (['npx', 'tsx', 'scripts/production-operator.ts', args.operation, f'{flag}={source}'] + (['--apply'] if args.apply else []), {})


def child_environment(tunnel_env, extra):
    # Nothing else may name a database; the tunnel is the encryption, and the server has TLS off.
    env = {key: value for key, value in tunnel_env.items() if 'DATABASE_URL' not in key}
    env.update(extra, PGSSLMODE='disable', PGAPPNAME='everrate-reviewed-operator')
    return env


def run(args, runner_factory=p.Runner, tunnel=p.open_tunnel, credentials_env=p.credential_environment, execute=subprocess.run):
    snapshot = json.loads((args.credentials or p.ROOT / '.private/railway-legacy.json').read_text())
    private_dir = p.ROOT / '.private'
    private_dir.mkdir(mode=0o700, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix='operator-', dir=private_dir))
    os.chmod(folder, 0o700)
    print('Private operation logs:', folder)
    process = None
    try:
        process, port = tunnel(runner_factory(folder), args.identity_file)
        env = credentials_env(snapshot, folder, port)  # verifies the canonical target IDs and port
        command, extra = child_command(args, env['PGDATABASE'], port)
        result = execute(command, env=child_environment(env, extra), cwd=p.ROOT, timeout=900)
        if process.poll() is not None:
            raise p.GuardError('Encrypted tunnel ended during the operation; inspect the database state read-only before any retry.')
        return result.returncode
    finally:
        p.stop_process(process)
        password = folder / 'pgpass'
        if password.exists():
            password.unlink()


def main(argv=None):
    args = parse_args(argv)
    try:
        return run(args)
    except (p.GuardError, subprocess.TimeoutExpired) as error:
        print(f'Operator run stopped: {error if isinstance(error, p.GuardError) else "timed out"}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
