import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('promotion', Path(__file__).parents[1] / 'scripts/promote-database.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        self.commit = self.folder / 'committed'
        self.writer = self.folder / 'writer.py'
        self.writer.write_text('''import sys,pathlib
for line in sys.stdin.buffer:
    if line.startswith(b"\\\\echo "):
        print(line[6:].decode().strip(), flush=True)
pathlib.Path(sys.argv[1]).write_text("committed")
''')
        self.reader = self.folder / 'reader.py'
        self.reader.write_text('''import sys
sys.stdout.buffer.write(b"SET transaction_timeout = 0;\\n-- Name: everrate; Type: SCHEMA; Schema: -; Owner: -\\nSELECT 1;\\n")
sys.stdout.flush()
sys.exit(int(sys.argv[1]))
''')

    def tearDown(self):
        self.tmp.cleanup()

    def run_stream(self, *, reader_exit=0, check=lambda: 200, verify=lambda: None, interval=2, timeout=3):
        return p.stream_transaction([sys.executable, str(self.reader), str(reader_exit)], [sys.executable, str(self.writer), str(self.commit)], os.environ.copy(), self.folder, b'GUARD;\n', b'POSTGUARD;\n', check, verify, interval=interval, timeout=timeout)

    def test_commits_only_after_source_and_fresh_disk_checks(self):
        steps = []
        def verify():
            self.assertFalse(self.commit.exists())
            steps.append('source')
        def check():
            self.assertFalse(self.commit.exists())
            steps.append('disk')
            return 200
        self.assertTrue(self.run_stream(check=check, verify=verify))
        self.assertEqual(steps, ['source', 'disk'])
        self.assertTrue(self.commit.exists())
        for name in ['restore.stderr', 'psql.stderr', 'psql.stdout']:
            self.assertEqual((self.folder / name).stat().st_mode & 0o777, 0o600)

    def test_failed_restore_never_releases_eof_to_commit(self):
        with self.assertRaises(p.GuardError):
            self.run_stream(reader_exit=3)
        self.assertFalse(self.commit.exists())

    def test_changed_source_rolls_back(self):
        def changed():
            raise p.GuardError('Changed source.')
        with self.assertRaises(p.GuardError):
            self.run_stream(verify=changed)
        self.assertFalse(self.commit.exists())

    def test_final_high_water_check_rolls_back(self):
        with self.assertRaises(p.GuardError):
            self.run_stream(check=lambda: 4501)
        self.assertFalse(self.commit.exists())

    def test_final_failed_disk_check_rolls_back(self):
        def failed():
            raise RuntimeError('fake monitor error')
        with self.assertRaises(RuntimeError):
            self.run_stream(check=failed)
        self.assertFalse(self.commit.exists())

    def test_two_failed_samples_abort_a_stalled_stream(self):
        self.reader.write_text('import time\ntime.sleep(30)\n')
        calls = []
        def failed():
            calls.append(1)
            raise RuntimeError('fake monitor failure')
        with self.assertRaises(p.GuardError):
            self.run_stream(check=failed, interval=.01)
        self.assertEqual(len(calls), 2)
        self.assertFalse(self.commit.exists())

    def test_high_water_aborts_on_first_sample(self):
        self.reader.write_text('import time\ntime.sleep(30)\n')
        calls = []
        def high():
            calls.append(1)
            raise p.DiskLimit('Full.')
        with self.assertRaises(p.GuardError):
            self.run_stream(check=high, interval=.01)
        self.assertEqual(len(calls), 1)
        self.assertFalse(self.commit.exists())

    def test_deadline_aborts_stalled_stream_even_with_healthy_monitor(self):
        self.reader.write_text('import time\ntime.sleep(30)\n')
        with self.assertRaises(p.GuardError):
            self.run_stream(interval=.01, timeout=.03)
        self.assertFalse(self.commit.exists())

    def test_sql_failure_does_not_commit(self):
        self.writer.write_text('import sys\nsys.exit(3)\n')
        with self.assertRaises((p.GuardError, BrokenPipeError)):
            self.run_stream()
        self.assertFalse(self.commit.exists())

    def test_partial_writes_do_not_truncate_sql(self):
        class Partial(io.BytesIO):
            def write(self, value):
                return super().write(value[:2])
        output = Partial()
        p.write_all(output, b'0123456789')
        self.assertEqual(output.getvalue(), b'0123456789')


if __name__ == '__main__':
    unittest.main()
