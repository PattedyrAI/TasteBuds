import importlib.util
import io
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("promotion", Path(__file__).parents[1] / "scripts/promote-database.py")
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)


class StreamTests(unittest.TestCase):
    def test_removes_only_exact_header_setting(self):
        data = b"-- PostgreSQL database dump\nSET transaction_timeout = 0;\nSET lock_timeout = 0;\n-- Name: everrate; Type: SCHEMA; Schema: -; Owner: -\nSET transaction_timeout = 0;\n"
        self.assertEqual(b"".join(promotion.filter_dump(io.BytesIO(data))), data.replace(b"SET transaction_timeout = 0;\n", b"", 1))

    def test_rejects_missing_or_changed_header_setting(self):
        for header in [b"", b"SET transaction_timeout = 1;\n", b" SET transaction_timeout = 0;\n"]:
            with self.subTest(header=header), self.assertRaises(promotion.GuardError):
                list(promotion.filter_dump(io.BytesIO(header + b"-- Name: everrate; Type: SCHEMA; Schema: -; Owner: -\n")))

    def test_body_streaming_is_bounded_and_byte_exact(self):
        body = b"\x00" * 300000 + b"\nSET transaction_timeout = 0;\n"
        parts = list(promotion.filter_dump(io.BytesIO(b"SET transaction_timeout = 0;\n-- Name: test; Type: TABLE; Schema: everrate; Owner: -\n" + body)))
        self.assertTrue(all(len(part) <= 65536 for part in parts))
        self.assertTrue(b"".join(parts).endswith(body))


class GuardTests(unittest.TestCase):
    def test_generated_ssh_scope_is_verified_and_agent_keys_are_disabled(self):
        config = f"# BEGIN railway:{promotion.PROJECT}:{promotion.ENVIRONMENT}:{promotion.SERVICE}\nHost everrate-promotion\n    HostName ssh.railway.com\n    User 11111111-1111-1111-1111-111111111111\n"
        command = promotion.ssh_command(config, Path('/private/key'), 12345)
        self.assertIn('127.0.0.1:12345:127.0.0.1:5432', command)
        self.assertIn('IdentityAgent=none', command)
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertIn('Compression=yes', command)
        for wrong in [config.replace(promotion.SERVICE, 'other'), config.replace('ssh.railway.com', 'other.example')]:
            with self.assertRaises(promotion.GuardError):
                promotion.ssh_command(wrong, Path('/private/key'), 12345)

    def test_counts_reject_sql_identifiers_and_noninteger_values(self):
        for value in [{}, {'ratings; DROP SCHEMA public': 0}, {'ratings': True}, {'ratings': -1}, {'ratings': '1'}]:
            with self.subTest(value=value), self.assertRaises(promotion.GuardError):
                promotion.validate_counts(value)

    def test_exact_public_counts_and_schema_absence(self):
        snapshot = {"everrate_exists": False, "counts": {"items": 10, "ratings": 20}}
        promotion.assert_destination(snapshot, {"items": 10, "ratings": 20})
        for changed in [dict(snapshot, everrate_exists=True), dict(snapshot, counts={"items": 10}), dict(snapshot, counts={"items": 10, "ratings": 21})]:
            with self.subTest(changed=changed), self.assertRaises(promotion.GuardError):
                promotion.assert_destination(changed, {"items": 10, "ratings": 20})

    def test_only_fixed_volume_and_valid_measurements(self):
        volume = {"id": promotion.VOLUME, "currentSizeMB": 4400, "sizeMB": 5000, "status": "Ready", "deletedAt": None, "isPendingDeletion": False}
        self.assertEqual(promotion.volume_used({"volumes": [volume]}), 4400)
        for changed in [dict(volume, currentSizeMB=4501), dict(volume, currentSizeMB=None), dict(volume, currentSizeMB=float("nan")), dict(volume, id="other"), dict(volume, isPendingDeletion=True)]:
            with self.subTest(changed=changed), self.assertRaises(promotion.GuardError):
                promotion.volume_used({"volumes": [changed]})

    def test_archive_scope_rejects_public_objects(self):
        valid = "1; 2615 100 SCHEMA - everrate user\n2; 1259 101 TABLE everrate ratings user\n3; 0 101 TABLE DATA everrate ratings user\n"
        promotion.assert_archive_scope(valid)
        with self.assertRaises(promotion.GuardError):
            promotion.assert_archive_scope(valid + "4; 1259 102 TABLE public ratings user\n")

    def test_defaults_to_dry_run_and_requires_exact_ids(self):
        args = ["--expected-sha256", "a" * 64, "--expected-public-counts", "counts.json", "--project-id", promotion.PROJECT, "--environment-id", promotion.ENVIRONMENT, "--service-id", promotion.SERVICE, "--volume-id", promotion.VOLUME]
        parsed = promotion.parse_args(args)
        self.assertFalse(parsed.apply)
        with self.assertRaises(promotion.GuardError):
            promotion.validate_target(dict(project_id="other", environment_id=promotion.ENVIRONMENT, service_id=promotion.SERVICE, volume_id=promotion.VOLUME))


if __name__ == "__main__":
    unittest.main()
