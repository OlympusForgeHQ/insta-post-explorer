"""Install the authorized Places profile; service activation is a separate step."""

import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shlex
import tempfile

ROOT = Path(__file__).resolve().parent
MARKER = "insta-post-explorer:places-hermes:v1\n"
STATE = Path("/var/lib/insta-explorer-places")
UNIT = Path("/etc/systemd/system/insta-explorer-places.service")


def refuse_symlink(path):
    if path.is_symlink():
        raise ValueError("SYMLINK_REFUSED")


def read_env(path):
    refuse_symlink(path)
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            words = shlex.split(line, comments=True)
            if words and words[0] == "export":
                words.pop(0)
            if len(words) == 1 and "=" in words[0]:
                key, value = words[0].split("=", 1)
                values[key] = value
    return values


def atomic_write(path, value, uid, gid, mode=0o600):
    refuse_symlink(path)
    fd, name = tempfile.mkstemp(prefix=".places-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), mode)
            os.fchown(stream.fileno(), uid, gid)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def install_profile(state, upstream_key, uid, gid):
    if not re.fullmatch(r"sk-or-[A-Za-z0-9_-]+", upstream_key or ""):
        raise ValueError("INVALID_UPSTREAM_KEY")
    refuse_symlink(state)
    marker = state / ".managed-by-insta-post-explorer"
    refuse_symlink(marker)
    if state.exists() and (not marker.is_file() or marker.read_text() != MARKER):
        raise ValueError("UNMANAGED_STATE")
    previous = read_env(state / ".env")
    api_key = previous.get("API_SERVER_KEY") or secrets.token_urlsafe(48)
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", api_key):
        raise ValueError("INVALID_EXISTING_API_KEY")
    config = json.loads((ROOT / "config.json").read_text())
    for child in [state / "config.yaml", state / "workspace", state / "cache"]:
        refuse_symlink(child)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    os.chown(state, uid, gid)
    atomic_write(marker, MARKER, uid, gid)
    for child in [state / "workspace", state / "cache"]:
        child.mkdir(mode=0o700, exist_ok=True)
        os.chmod(child, 0o700)
        os.chown(child, uid, gid)
    # JSON is valid YAML; keep artifact validation dependency-free.
    atomic_write(state / "config.yaml", json.dumps(config, indent=2) + "\n", uid, gid)
    atomic_write(state / ".env", (
        f"OPENROUTER_API_KEY={upstream_key}\n"
        f"API_SERVER_KEY={api_key}\n"
        "API_SERVER_ENABLED=true\n"
    ), uid, gid)


def main():
    if os.geteuid() != 0:
        raise ValueError("ROOT_REQUIRED")
    refuse_symlink(UNIT)
    unit = (ROOT / UNIT.name).read_text()
    if UNIT.exists() and UNIT.read_text() != unit:
        raise ValueError("EXISTING_UNIT_DIFFERS_REVIEW_REQUIRED")
    account = pwd.getpwnam("argos")
    upstream = read_env(Path("/home/argos/.hermes/.env")).get("OPENROUTER_API_KEY")
    install_profile(STATE, upstream, account.pw_uid, account.pw_gid)
    atomic_write(UNIT, unit, 0, 0, mode=0o644)
    print(json.dumps({"installed": True, "service": UNIT.name, "state": str(STATE)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).isupper() else type(error).__name__
        print(json.dumps({"installed": False, "error": code}))
        raise SystemExit(1) from None
