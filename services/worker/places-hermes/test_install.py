import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("places_install", ROOT / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class PlacesInstallTests(unittest.TestCase):
    def test_install_preserves_api_key_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as parent:
            state = Path(parent) / "places"
            args = (state, "sk-or-v1-synthetic-test", os.getuid(), os.getgid())
            installer.install_profile(*args)
            before = installer.read_env(state / ".env")["API_SERVER_KEY"]
            installer.install_profile(*args)
            self.assertEqual(before, installer.read_env(state / ".env")["API_SERVER_KEY"])
            self.assertGreaterEqual(len(before), 32)
            self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((state / ".env").stat().st_mode), 0o600)
            self.assertEqual(set(installer.read_env(state / ".env")), {
                "OPENROUTER_API_KEY", "API_SERVER_KEY", "API_SERVER_ENABLED",
            })

    def test_refuses_foreign_state_and_secret_symlinks(self):
        with tempfile.TemporaryDirectory() as parent:
            state = Path(parent) / "foreign"
            state.mkdir()
            with self.assertRaisesRegex(ValueError, "UNMANAGED_STATE"):
                installer.install_profile(state, "sk-or-test", os.getuid(), os.getgid())
            state.rmdir()
            installer.install_profile(state, "sk-or-test", os.getuid(), os.getgid())
            target = Path(parent) / "unrelated"
            target.write_text("unchanged")
            (state / ".env").unlink()
            (state / ".env").symlink_to(target)
            with self.assertRaisesRegex(ValueError, "SYMLINK"):
                installer.install_profile(state, "sk-or-test", os.getuid(), os.getgid())
            self.assertEqual(target.read_text(), "unchanged")

    def test_rejects_environment_injection_before_writing(self):
        with tempfile.TemporaryDirectory() as parent:
            state = Path(parent) / "places"
            with self.assertRaisesRegex(ValueError, "INVALID_UPSTREAM_KEY"):
                installer.install_profile(state, "sk-or-test\nOTHER=secret", os.getuid(), os.getgid())
            self.assertFalse(state.exists())


if __name__ == "__main__":
    unittest.main()
