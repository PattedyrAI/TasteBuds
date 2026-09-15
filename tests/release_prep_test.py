import importlib.util
import base64
import contextlib
import io
from unittest.mock import patch
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).parents[1] / 'scripts/prepare-release.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / 'repo'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Local release fixture')
        for name in p.ROOT_FILES:
            (self.repo / name).write_text('reviewed ' + name)
        (self.repo / 'src').mkdir()
        (self.repo / 'src/app.ts').write_text('reviewed source')
        (self.repo / 'public').mkdir()
        (self.repo / 'public/icon.svg').write_text('<svg/>')
        (self.repo / '.private').mkdir()
        (self.repo / '.private/secret').write_text('must not ship')
        (self.repo / 'docs').mkdir()
        (self.repo / 'docs/notes.md').write_text('must not ship')
        self.commit()
        self.destination = Path(self.tmp.name) / 'stage'

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, check=True).stdout.decode().strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD')

    def test_stages_exact_commit_and_ignores_dirty_or_private_worktree_files(self):
        (self.repo / 'src/app.ts').write_text('unreviewed dirty content')
        (self.repo / 'src/untracked.ts').write_text('untracked')
        report = p.stage_commit(self.repo, self.sha, self.destination)
        self.assertEqual((self.destination / 'src/app.ts').read_text(), 'reviewed source')
        self.assertFalse((self.destination / '.private').exists())
        self.assertFalse((self.destination / 'docs').exists())
        self.assertFalse((self.destination / 'src/untracked.ts').exists())
        self.assertEqual(report['files'], len(p.ROOT_FILES) + 2)
        self.assertEqual(report['bytes'], sum(path.stat().st_size for path in self.destination.rglob('*') if path.is_file()))

    def test_main_prepares_private_configuration_without_external_commands_or_secret_output(self):
        env, pg = ConfigurationTests().inputs()
        (self.repo / '.env.local').write_text('\n'.join(key + '=' + json.dumps(value) for key, value in env.items()))
        (self.repo / '.private/railway-legacy.json').write_text(json.dumps({'pg': pg, 'web': {'SUPABASE_SERVICE_ROLE_KEY': 'old-private-value'}}))
        (self.repo / '.private/runtime-role-password').write_text('private-role-password\n')
        for path in [self.repo / '.env.local', self.repo / '.private/railway-legacy.json', self.repo / '.private/runtime-role-password']:
            path.chmod(0o600)
        console = io.StringIO()
        original_run = subprocess.run
        with patch.object(p, 'ROOT', self.repo), patch.object(p.subprocess, 'run', wraps=original_run) as commands, contextlib.redirect_stdout(console):
            self.assertEqual(p.main(['--release', self.sha]), 0)
        self.assertTrue(all(call.args[0][0] == 'git' for call in commands.call_args_list))
        for private_value in ['private-role-password', 'private-gemini', 'old-private-value', 'public-fixture']:
            self.assertNotIn(private_value, console.getvalue())
        folder = next((self.repo / '.private').glob('release-prep-*'))
        variables = json.loads((folder / 'web-variables.json').read_text())
        self.assertEqual(variables['APP_RELEASE'], self.sha)
        self.assertEqual((folder / 'web-variables.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((folder / 'review.json').read_text())['removeIfStillPresent'], ['SUPABASE_SERVICE_ROLE_KEY'])
        self.assertIn('--stdin', (folder / 'operator-commands.md').read_text())
        self.assertFalse((folder / 'stage/web-variables.json').exists())

    def test_rejects_private_file_inside_allowed_tree(self):
        (self.repo / 'public/backup.dump').write_text('fake private archive')
        self.commit()
        with self.assertRaises(p.PrepError):
            p.stage_commit(self.repo, self.sha, self.destination)
        self.assertFalse(self.destination.exists())

    def test_env_variants_and_runtime_variable_files_are_not_uploadable(self):
        for name in ['src/.envrc', 'public/.ENV.local', 'public/web-variables.json']:
            with self.subTest(name=name), self.assertRaises(p.PrepError):
                p.allowed_file(name)

    def test_rejects_escape_symlinks_without_reading_their_target(self):
        (self.repo / 'public/leak').symlink_to('../.private/secret')
        self.commit()
        with self.assertRaises(p.PrepError):
            p.stage_commit(self.repo, self.sha, self.destination)
        self.assertFalse(self.destination.exists())

    def test_missing_required_file_and_wrong_sha_fail(self):
        self.git('rm', 'Dockerfile')
        self.git('commit', '-qm', 'remove required file')
        for sha in [self.git('rev-parse', 'HEAD'), '0' * 40, 'HEAD']:
            with self.subTest(sha=sha), self.assertRaises(p.PrepError):
                p.stage_commit(self.repo, sha, self.destination)


class ConfigurationTests(unittest.TestCase):
    def inputs(self):
        env = {'NEXT_PUBLIC_SUPABASE_URL': p.AUTH_URL, 'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'public-fixture', 'GEMINI_API_KEY': 'private-gemini', 'GEMINI_MODEL': 'gemini-3.1-flash-lite', 'DISCORD_ENCRYPTION_KEY': 'a' * 64}
        pg = {'RAILWAY_PROJECT_ID': p.PROJECT, 'RAILWAY_ENVIRONMENT_ID': p.ENVIRONMENT, 'RAILWAY_SERVICE_ID': p.PG_SERVICE, 'RAILWAY_PRIVATE_DOMAIN': 'pg.railway.internal', 'POSTGRES_DB': 'legacy database', 'RAILWAY_TCP_APPLICATION_PORT': '5432'}
        return env, pg

    def test_runtime_uses_scoped_role_internal_host_and_exact_release(self):
        env, pg = self.inputs()
        result = p.runtime_variables(env, pg, 'sensitive:p@ss/word', 'b' * 40)
        self.assertEqual(result['DATABASE_URL'], 'postgresql://everrate_app:sensitive%3Ap%40ss%2Fword@pg.railway.internal:5432/legacy%20database')
        self.assertEqual(result['APP_URL'], p.APP_URL)
        self.assertEqual(result['APP_RELEASE'], 'b' * 40)
        self.assertEqual(result['RAILWAY_DOCKERFILE_PATH'], 'Dockerfile')
        self.assertNotIn('POSTGRES_PASSWORD', result)
        self.assertNotIn('TEST_DATABASE_URL', result)

    def test_rejects_missing_secrets_wrong_target_or_external_database_host(self):
        env, pg = self.inputs()
        for changed_env, changed_pg, password in [({k: v for k, v in env.items() if k != 'GEMINI_API_KEY'}, pg, 'x'), (env, dict(pg, RAILWAY_SERVICE_ID='other'), 'x'), (env, dict(pg, RAILWAY_PRIVATE_DOMAIN='public.example'), 'x'), (env, pg, '')]:
            with self.assertRaises(p.PrepError):
                p.runtime_variables(changed_env, changed_pg, password, 'b' * 40)

    def test_never_places_a_recognizable_service_role_key_in_public_build_variables(self):
        env, pg = self.inputs()
        payload = base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).decode().rstrip('=')
        env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'header.' + payload + '.signature'
        with self.assertRaises(p.PrepError):
            p.runtime_variables(env, pg, 'password', 'b' * 40)
        env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'sb_secret_fake'
        with self.assertRaises(p.PrepError):
            p.runtime_variables(env, pg, 'password', 'b' * 40)

    def test_dotenv_quotes_are_parsed_without_shell_or_variable_expansion(self):
        self.assertEqual(p.parse_env('TOKEN="$(do-not-execute) # literal"\nOTHER=ok # comment\n'), {'TOKEN': '$(do-not-execute) # literal', 'OTHER': 'ok'})

    def test_secret_json_is_exclusive_and_mode_0600(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'variables.json'
            p.write_private_json(target, {'KEY': 'private-fixture'})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(target.read_text()), {'KEY': 'private-fixture'})
            with self.assertRaises(FileExistsError):
                p.write_private_json(target, {'KEY': 'replacement'})


if __name__ == '__main__':
    unittest.main()
