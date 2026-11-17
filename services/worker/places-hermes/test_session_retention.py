import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("session_retention", ROOT / "session_retention.py")
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)
DAY = 86400
NOW = 100 * DAY


class FakeSessionDB:
    def __init__(self, guarded=()):
        self.calls, self.guarded = [], set(guarded)

    def delete_sessions(self, ids, sessions_dir=None, exclude_active_write_guards=False, skipped_ids=None):
        self.calls.append((list(ids), sessions_dir, exclude_active_write_guards))
        skipped_ids.extend(i for i in ids if i in self.guarded)
        return len([i for i in ids if i not in self.guarded])


def store(path, sessions, messages=()):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE sessions (id TEXT, started_at REAL, last_activity_at REAL, archived INT, pinned INT)")
    connection.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, timestamp REAL)")
    connection.executemany("INSERT INTO sessions VALUES (?,?,?,?,?)", sessions)
    connection.executemany("INSERT INTO messages (session_id, timestamp) VALUES (?,?)", messages)
    connection.commit()
    connection.close()


class SessionRetentionTests(unittest.TestCase):
    def test_deletes_only_idle_unpinned_unarchived_sessions(self):
        with tempfile.TemporaryDirectory() as parent:
            path = Path(parent) / "state.db"
            store(path, [
                ("old", NOW - 9 * DAY, None, 0, 0),
                ("recent-start", NOW - 1 * DAY, None, 0, 0),
                ("old-start-recent-activity", NOW - 9 * DAY, NOW - DAY, 0, 0),
                ("old-start-recent-message", NOW - 9 * DAY, None, 0, 0),
                ("pinned", NOW - 9 * DAY, None, 0, 1),
                ("archived", NOW - 9 * DAY, None, 1, 0),
            ], [("old-start-recent-message", NOW - 3600)])
            db = FakeSessionDB()
            report = retention.retain(db, path, Path(parent) / "sessions", NOW)
            self.assertEqual(report, {"candidates": 1, "deleted": 1, "skipped": 0})
            self.assertEqual(db.calls, [(["old"], Path(parent) / "sessions", True)])

    def test_batches_and_reports_guarded_sessions(self):
        with tempfile.TemporaryDirectory() as parent:
            path = Path(parent) / "state.db"
            store(path, [(f"s{i:04d}", NOW - 9 * DAY, None, 0, 0) for i in range(1203)])
            db = FakeSessionDB(guarded={"s0007"})
            report = retention.retain(db, path, None, NOW)
            self.assertEqual(report, {"candidates": 1203, "deleted": 1202, "skipped": 1})
            self.assertEqual([len(call[0]) for call in db.calls], [500, 500, 203])

    def test_reads_the_store_without_writing(self):
        with tempfile.TemporaryDirectory() as parent:
            path = Path(parent) / "state.db"
            store(path, [("old", NOW - 9 * DAY, None, 0, 0)])
            before = path.read_bytes()
            retention.idle_session_ids(path, NOW)
            self.assertEqual(before, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
