"""Stage the independent classifier. Activation is a separate operator action."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import subprocess
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
MARKER = 'insta-post-explorer:classification:v1\n'
STATE = Path('/var/lib/insta-explorer-classification')
UNIT = Path('/etc/systemd/system/insta-explorer-classification.service')
KEYS = {'CLASSIFICATION_LEARNING_ENABLED', 'CLASSIFICATION_APP_ORIGIN', 'CLASSIFICATION_WORKER_API_KEY', 'CLASSIFICATION_HERMES_URL', 'CLASSIFICATION_HERMES_KEY', 'CLASSIFICATION_ASR_PYTHON', 'CLASSIFICATION_ASR_SCRIPT', 'CLASSIFICATION_TEMP_ROOT', 'CLASSIFICATION_ASR_CACHE'}


def refuse_symlink(path):
    for candidate in [path, *path.parents]:
        if candidate.is_symlink():
            raise ValueError('SYMLINK_REFUSED')


def read_env(path):
    refuse_symlink(path)
    if not path.exists():
        return {}
    if path.stat().st_mode & 0o077:
        raise ValueError('ENV_NOT_PRIVATE')
    values = {}
    for line in path.read_text().splitlines():
        words = shlex.split(line, comments=True)
        if words:
            if len(words) != 1 or '=' not in words[0]:
                raise ValueError('INVALID_ENV')
            key, value = words[0].split('=', 1)
            if key not in KEYS or key in values or any(ord(char) < 32 for char in value):
                raise ValueError('INVALID_ENV')
            values[key] = value
    return values


def atomic_write(path, value, uid, gid, mode=0o600):
    refuse_symlink(path)
    fd, name = tempfile.mkstemp(prefix='.classification-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), mode)
            os.fchown(stream.fileno(), uid, gid)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def install_state(state, values, uid, gid):
    refuse_symlink(state)
    marker = state / '.managed-by-insta-post-explorer'
    refuse_symlink(marker)
    if state.exists() and (not marker.is_file() or marker.read_text() != MARKER):
        raise ValueError('UNMANAGED_STATE')
    previous = read_env(state / '.env')
    for key in ['CLASSIFICATION_WORKER_API_KEY', 'CLASSIFICATION_HERMES_KEY']:
        if previous.get(key) and previous[key] != values.get(key):
            raise ValueError('CREDENTIAL_CHANGE_REQUIRES_REVIEW')
    for child in [state / 'work', state / 'cache']:
        refuse_symlink(child)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    os.chown(state, uid, gid)
    atomic_write(marker, MARKER, uid, gid)
    for child in [state / 'work', state / 'cache']:
        child.mkdir(mode=0o700, exist_ok=True)
        os.chmod(child, 0o700)
        os.chown(child, uid, gid)
    atomic_write(state / '.env', ''.join(f'{key}={shlex.quote(value)}\n' for key, value in sorted(values.items())), uid, gid)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--env-file', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    for path in [args.release, args.node, UNIT]:
        refuse_symlink(path)
    if not re.fullmatch(r'/opt/insta-explorer-classification/releases/[a-zA-Z0-9_-]+', str(args.release)) or not re.fullmatch(r'/(?:usr|opt)/[a-zA-Z0-9_./-]+', str(args.node)):
        raise ValueError('INVALID_RUNTIME_PATH')
    if not args.node.is_file() or not os.access(args.node, os.X_OK) or not (args.release / 'dist/classification/cli.js').is_file() or not (args.release / 'node_modules/zod/package.json').is_file():
        raise ValueError('RELEASE_NOT_BUILT')
    for item in [args.release, *args.release.rglob('*')]:
        refuse_symlink(item)
        if item.stat().st_uid != 0 or item.stat().st_mode & 0o022:
            raise ValueError('RELEASE_NOT_IMMUTABLE')
    version = subprocess.run([str(args.node), '--version'], capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    if not re.fullmatch(r'v24\.\d+\.\d+', version):
        raise ValueError('NODE_24_REQUIRED')
    values = read_env(args.env_file)
    if values.get('CLASSIFICATION_LEARNING_ENABLED', '0') not in ['0', '1']:
        raise ValueError('INVALID_LEARNING_FLAG')
    required = KEYS - {'CLASSIFICATION_LEARNING_ENABLED', 'CLASSIFICATION_ASR_SCRIPT', 'CLASSIFICATION_TEMP_ROOT', 'CLASSIFICATION_ASR_CACHE'}
    if not required.issubset(values):
        raise ValueError('CONFIG_INCOMPLETE')
    origin = urlsplit(values['CLASSIFICATION_APP_ORIGIN'])
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ['', '/'] or origin.query or origin.fragment:
        raise ValueError('INVALID_APP_ORIGIN')
    if values['CLASSIFICATION_HERMES_URL'] != 'http://127.0.0.1:8645/v1':
        raise ValueError('INVALID_HERMES_URL')
    for key in ['CLASSIFICATION_WORKER_API_KEY', 'CLASSIFICATION_HERMES_KEY']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{20,256}', values[key]):
            raise ValueError('INVALID_KEY')
    if not re.fullmatch(r'/opt/[a-zA-Z0-9_./-]+/bin/python', values['CLASSIFICATION_ASR_PYTHON']):
        raise ValueError('INVALID_ASR_PATH')
    values.update(CLASSIFICATION_ASR_SCRIPT=str(args.release / 'transcribe.py'), CLASSIFICATION_TEMP_ROOT=str(STATE / 'work'), CLASSIFICATION_ASR_CACHE=str(STATE / 'cache'))
    unit = (ROOT / UNIT.name).read_text().replace('@NODE@', str(args.node)).replace('@RELEASE@', str(args.release))
    if UNIT.exists() and UNIT.read_text() != unit:
        raise ValueError('EXISTING_UNIT_DIFFERS_REVIEW_REQUIRED')
    account = pwd.getpwnam('argos')
    install_state(STATE, values, account.pw_uid, account.pw_gid)
    atomic_write(UNIT, unit, 0, 0, 0o644)
    print(json.dumps({'installed': True, 'service': UNIT.name, 'activation': 'pending'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[A-Z_]+', str(error)) else 'INSTALL_FAILED'
        print(json.dumps({'installed': False, 'error': code}))
        raise SystemExit(1) from None
