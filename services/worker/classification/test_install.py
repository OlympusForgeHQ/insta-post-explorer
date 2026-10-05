import os
from pathlib import Path
import tempfile
import unittest

from install import install_state


class InstallationTests(unittest.TestCase):
    def test_private_idempotent_state_preserves_credentials_and_stays_staged(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            values = {'CLASSIFICATION_WORKER_API_KEY': 'classification-private-key-123456', 'CLASSIFICATION_HERMES_KEY': 'hermes-private-key-123456789'}
            install_state(state, values, os.getuid(), os.getgid())
            first = (state / '.env').read_text()
            install_state(state, values, os.getuid(), os.getgid())
            self.assertEqual((state / '.env').read_text(), first)
            for item in [state, state / 'work', state / 'cache']:
                self.assertEqual(item.stat().st_mode & 0o777, 0o700)
            self.assertEqual((state / '.env').stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, 'CREDENTIAL_CHANGE_REQUIRES_REVIEW'):
                install_state(state, {**values, 'CLASSIFICATION_WORKER_API_KEY': 'different-private-key-123456789'}, os.getuid(), os.getgid())

    def test_refuses_foreign_state_and_symlinked_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            state.mkdir()
            with self.assertRaisesRegex(ValueError, 'UNMANAGED_STATE'):
                install_state(state, {}, os.getuid(), os.getgid())
            state.rmdir()
            install_state(state, {}, os.getuid(), os.getgid())
            (state / '.env').unlink()
            (state / '.env').symlink_to(Path(directory) / 'foreign')
            with self.assertRaisesRegex(ValueError, 'SYMLINK_REFUSED'):
                install_state(state, {}, os.getuid(), os.getgid())


if __name__ == '__main__':
    unittest.main()
