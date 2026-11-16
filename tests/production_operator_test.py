import importlib.util
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('operator', Path(__file__).parents[1] / 'scripts/production-operator.py')
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)


class FakeTunnel:
    def __init__(self, dies=False):
        self.dies, self.stopped = dies, False

    def poll(self):
        return 255 if self.dies or self.stopped else None

    def terminate(self):
        self.stopped = True

    def wait(self, timeout=None):
        return 0


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.spec = self.private('spec.json', '{}')
        self.creds = self.private('railway-legacy.json', '{"pg": {}}')

    def tearDown(self):
        self.tmp.cleanup()

    def private(self, name, text, mode=0o600):
        path = self.root / name
        path.write_text(text)
        os.chmod(path, mode)
        return path

    def args(self, *extra):
        return o.parse_args(['--identity-file', str(self.root / 'key'), '--credentials', str(self.creds), *extra])

    def test_inputs_must_be_private_regular_files(self):
        loose = self.private('loose.json', '{}', 0o644)
        link = self.root / 'link.json'
        link.symlink_to(self.spec)
        for bad in [loose, link, self.root / 'missing.json']:
            with self.subTest(bad=bad.name), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.args('category', f'--spec={bad}')
        self.assertEqual(self.args('category', f'--spec={self.spec}').spec, self.spec.resolve())

    def test_only_reviewed_entry_points_run(self):
        command, extra = o.child_command(self.args('category', f'--spec={self.spec}', '--apply'), 'rail way', 5555)
        self.assertEqual(command, ['npx', 'tsx', 'scripts/production-operator.ts', 'category', f'--spec={self.spec.resolve()}', '--apply'])
        self.assertEqual(extra, {})
        command, _ = o.child_command(self.args('apply-plan', f'--plan={self.spec}'), 'railway', 5555)
        self.assertEqual(command[2:4], ['scripts/production-operator.ts', 'apply-plan'])
        self.assertNotIn('--apply', command)
        command, extra = o.child_command(self.args('plan-merges', f'--review={self.spec}', '--evidence=Patrick, 2026-11-16'), 'rail way', 5555)
        self.assertEqual(command[2], 'scripts/plan-same-product-merges.ts')
        # Loopback only, and no credential in the URL.
        self.assertEqual(extra, {'SAME_PRODUCT_DATABASE_URL': 'postgresql://127.0.0.1:5555/rail%20way'})
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.args('drop-everything')

    def test_child_environment_names_no_other_database(self):
        env = o.child_environment({'DATABASE_URL': 'x', 'CATEGORY_DATABASE_URL': 'y', 'PGHOST': '127.0.0.1', 'PATH': '/bin'}, {'SAME_PRODUCT_DATABASE_URL': 'z'})
        self.assertEqual(env, {'PGHOST': '127.0.0.1', 'PATH': '/bin', 'SAME_PRODUCT_DATABASE_URL': 'z', 'PGSSLMODE': 'disable', 'PGAPPNAME': 'everrate-reviewed-operator'})

    def run_with(self, tunnel, returncode=0):
        calls = []

        def credentials_env(snapshot, folder, port):
            (folder / 'pgpass').write_text('secret')
            return {'PGHOST': '127.0.0.1', 'PGPORT': str(port), 'PGDATABASE': 'railway', 'PGPASSFILE': str(folder / 'pgpass')}

        def execute(command, env, cwd, timeout):
            calls.append((command, env))
            return type('Result', (), {'returncode': returncode})()

        with patch.object(o.p, 'ROOT', self.root), contextlib.redirect_stdout(io.StringIO()):
            try:
                code = o.run(self.args('category', f'--spec={self.spec}'), runner_factory=lambda folder: None,
                             tunnel=lambda runner, identity: (tunnel, 5555), credentials_env=credentials_env, execute=execute)
            finally:
                self.leftover = list((self.root / '.private').glob('operator-*/pgpass'))
        return code, calls

    def test_runs_the_child_through_the_tunnel_and_cleans_up(self):
        tunnel = FakeTunnel()
        code, calls = self.run_with(tunnel, returncode=3)
        self.assertEqual(code, 3)
        self.assertEqual(calls[0][1]['PGSSLMODE'], 'disable')
        self.assertTrue(tunnel.stopped)
        self.assertEqual(self.leftover, [])
        folder = next((self.root / '.private').glob('operator-*'))
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)

    def test_a_tunnel_that_ended_is_reported(self):
        with self.assertRaises(o.p.GuardError):
            self.run_with(FakeTunnel(dies=True))
        self.assertEqual(self.leftover, [])


if __name__ == '__main__':
    unittest.main()
