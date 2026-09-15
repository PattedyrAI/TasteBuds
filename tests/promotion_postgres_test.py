"""Optional real psql transaction proof in a newly created disposable local database."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import unquote, urlparse
from uuid import uuid4

spec = importlib.util.spec_from_file_location('promotion', Path(__file__).parents[1] / 'scripts/promote-database.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
URL = os.environ.get('TEST_DATABASE_URL')


@unittest.skipUnless(URL, 'TEST_DATABASE_URL required for disposable local PostgreSQL proof')
class PostgresTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = urlparse(URL)
        if url.scheme not in ('postgres', 'postgresql') or url.hostname not in ('127.0.0.1', 'localhost', '::1') or not url.path.endswith('_test') or url.query:
            raise RuntimeError('Only a disposable local TEST_DATABASE_URL is allowed')
        cls.name = 'everrate_promotion_' + uuid4().hex + '_test'
        cls.env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        cls.env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGUSER=unquote(url.username or ''), PGDATABASE=cls.name)
        if url.password:
            cls.env['PGPASSWORD'] = unquote(url.password)
        subprocess.run([str(p.PG_BIN / 'createdb'), '--maintenance-db=postgres', cls.name], env=cls.env, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        subprocess.run([str(p.PG_BIN / 'dropdb'), '--maintenance-db=postgres', cls.name], env=cls.env, check=True, capture_output=True)

    def sql(self, sql):
        result = subprocess.run([str(p.PG_BIN / 'psql'), '-X', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--file=-'], input=sql.encode(), env=self.env, check=True, capture_output=True)
        return result.stdout.decode().strip()

    def test_real_psql_rolls_back_failed_producer_and_commits_only_after_guards(self):
        self.sql('CREATE TABLE public.legacy_probe(id integer); INSERT INTO public.legacy_probe VALUES(1);')
        expected = {'legacy_probe': 1}
        # The fixture is generated locally and contains no real records or credentials.
        fixture = b'SET transaction_timeout = 0;\n-- Name: everrate; Type: SCHEMA; Schema: -; Owner: -\nCREATE SCHEMA everrate; CREATE TABLE everrate.discord_outbox(id integer); CREATE TABLE everrate.items(id integer); INSERT INTO everrate.items VALUES(1);\n'
        for exit_code in [3, 0]:
            with tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                reader = folder / 'fixture.py'
                reader.write_text('import sys\nsys.stdout.buffer.write(' + repr(fixture) + ')\nsys.stdout.flush()\nsys.exit(' + str(exit_code) + ')\n')
                def perform():
                    return p.stream_transaction([sys.executable, str(reader)], [str(p.PG_BIN / 'psql'), '-X', '-q', '-A', '-t', '--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file=-'], self.env, folder, p.guard_sql(expected, before=True), p.guard_sql(expected, before=False) + p.restored_counts_sql({'discord_outbox': 0, 'items': 1}), lambda: 200, lambda: None, timeout=10)
                if exit_code:
                    with self.assertRaises(p.GuardError):
                        perform()
                    self.assertEqual(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname='everrate';"), '0')
                else:
                    self.assertTrue(perform())
                    self.assertEqual(json.loads(self.sql(p.counts_query('everrate') + ';')), {'discord_outbox': 0, 'items': 1})
                self.assertEqual(self.sql('SELECT count(*) FROM public.legacy_probe;'), '1')


if __name__ == '__main__':
    unittest.main()
