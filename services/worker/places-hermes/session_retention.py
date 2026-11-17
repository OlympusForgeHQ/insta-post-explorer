"""Delete idle Places inference sessions before the gateway starts.

Every Places request opens a Hermes API session that is never ended, so the
native prune (ended sessions only) never reclaims them. At startup the gateway
scans the whole transcript store for retained images; after six weeks (18,048
sessions) that scan outlived its loop watchdog and the gateway crash-looped
from 14 to 17 November 2026. Sessions hold no application data: results live
in the application database. Runs as ExecStartPre, with no live writer.
"""

import json
import os
from pathlib import Path
import sqlite3
import sys
import time

HERMES_AGENT = Path("/home/argos/.hermes/hermes-agent")
RETENTION_DAYS = 2
BATCH = 500


def idle_session_ids(db_path, cutoff):
    """Unpinned, unarchived sessions with no activity since ``cutoff``."""
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return [row[0] for row in connection.execute(
            """SELECT s.id FROM sessions s
               WHERE COALESCE(s.archived, 0) = 0 AND COALESCE(s.pinned, 0) = 0
                 AND MAX(COALESCE(s.last_activity_at, 0), COALESCE(s.started_at, 0),
                         COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), 0)) < ?
               ORDER BY s.id""", (cutoff,))]
    finally:
        connection.close()


def retain(db, db_path, sessions_dir, now, days=RETENTION_DAYS):
    ids = idle_session_ids(db_path, now - days * 86400)
    skipped, deleted = [], 0
    for start in range(0, len(ids), BATCH):
        # Hermes' own deletion keeps messages, admissions and transcripts consistent.
        deleted += db.delete_sessions(ids[start:start + BATCH], sessions_dir=sessions_dir,
                                      exclude_active_write_guards=True, skipped_ids=skipped)
    return {"candidates": len(ids), "deleted": deleted, "skipped": len(skipped)}


def main():
    home = Path(os.environ["HERMES_HOME"])
    db_path = home / "state.db"
    if not db_path.is_file():
        print(json.dumps({"stage": "session_retention", "skipped": "NO_STORE"}))
        return
    sys.path.insert(0, str(HERMES_AGENT))
    from hermes_state import SessionDB
    db = SessionDB(db_path)
    try:
        report = retain(db, db_path, home / "sessions", time.time())
    finally:
        getattr(db, "close", lambda: None)()
    print(json.dumps({"stage": "session_retention", **report}))


if __name__ == "__main__":
    main()
