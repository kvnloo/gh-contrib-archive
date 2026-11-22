"""Offline factory contract regressions; all fixtures stay in this checkout."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "factory-cache.py"


class FactoryCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".factory-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.db_path = Path(self.temp.name) / "public.db"
        self.db = sqlite3.connect(self.db_path)
        self.db.executescript((ROOT / "lib" / "schema.sql").read_text())
        self.db.execute("INSERT INTO meta VALUES ('privacy', 'public-safe')")
        self.db.commit()
        self.addCleanup(self.db.close)

    def run_cli(self, db_path=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(db_path or self.db_path)],
            cwd=ROOT, capture_output=True, text=True,
        )

    def add_event(self, id, kind, visibility, created, updated, ingested):
        # Synthetic forbidden values must never appear in the metadata sidecar.
        self.db.execute(
            """INSERT INTO contributions
            (id,type,url,html_url,repo,title,excerpt,visibility,created_at,updated_at,ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (id, kind, f"SECRET_URL/{id}", f"SECRET_URL/{id}", "SECRET_REPO", "SECRET_TITLE",
             "SECRET_BODY", visibility, created, updated, ingested),
        )
        self.db.commit()

    def test_freshness_is_per_type_and_not_creation_or_success(self):
        self.add_event("public:1", "issue", "public", "2020-01-01T00:00:00Z",
                       "2026-10-12T00:00:00Z", "2026-10-13 18:00:00")
        self.add_event("private:1", "comment", "private", "2026-10-01T00:00:00Z",
                       None, "2026-10-13 17:00:00")
        self.add_event("public:2", "discussion", "public", "2026-09-07T00:00:00Z",
                       None, "2026-09-11 23:12:00")
        self.db.execute("INSERT INTO meta VALUES ('finished_at', '2026-10-13T18:23:37Z')")
        self.db.commit()
        before = self.db_path.read_bytes()
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["contractVersion"], 1)
        self.assertEqual(report["privacy"], "public-safe")
        self.assertEqual(report["databaseSha256"], hashlib.sha256(before).hexdigest())
        self.assertEqual(self.db_path.read_bytes(), before)
        self.assertNotIn("SECRET", result.stdout)
        self.assertEqual(report["counts"], {"events": 3, "publicEvents": 2, "privateEvents": 1})
        self.assertEqual(report["freshness"], {
            "lastSuccessfulCollectionAt": "2026-10-13T18:23:37Z",
            "lastRowIngestedAt": "2026-10-13T18:00:00Z",
            "latestEventCreatedAt": "2026-10-01T00:00:00Z",
            "eventHighWaterAt": "2026-10-12T00:00:00Z",
        })
        types = {row["type"]: row for row in report["byType"]}
        self.assertEqual(types["discussion"]["lastRowIngestedAt"], "2026-09-11T23:12:00Z")
        self.assertFalse(types["discussion"]["incrementallyRefreshed"])
        self.assertTrue(types["comment"]["incrementallyRefreshed"])
        self.assertEqual(types["review"]["events"], 0)
        self.assertIsNone(types["review"]["lastRowIngestedAt"])

    def test_empty_cache_never_claims_complete_or_an_inbox(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["counts"]["events"], 0)
        self.assertTrue(all(value is None for value in report["freshness"].values()))
        self.assertEqual(report["coverage"]["completeness"], "unknown")
        self.assertEqual(report["coverage"]["notifications"], "not-collected")
        self.assertEqual(report["coverage"]["incomingReplies"], "not-collected")
        self.assertEqual(report["coverage"]["bodies"], "excerpts-only")
        self.assertEqual(report["coverage"]["reviewStates"], "nonempty-review-bodies-only")

    def test_commit_summary_keeps_private_yearly_totals_without_repo_metadata(self):
        self.db.executemany("INSERT INTO commit_buckets VALUES (?, ?, ?, ?, ?, ?)", [
            ("public:2026", 2026, "example/repo", "public", 7, "https://github.com/example/repo"),
            ("private:2026", 2026, "SECRET_REPO", "private", 9, "SECRET_URL"),
        ])
        self.db.commit()
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["commitsByYear"], [{"year": 2026, "publicCommits": 7, "privateCommits": 9}])
        self.assertNotIn("SECRET", result.stdout)
        self.assertNotIn("example/repo", result.stdout)

    def test_refuses_unmarked_or_private_database_and_missing_input(self):
        for marker in (None, "private"):
            self.db.execute("DELETE FROM meta WHERE key='privacy'")
            if marker:
                self.db.execute("INSERT INTO meta VALUES ('privacy', ?)", (marker,))
            self.db.commit()
            result = self.run_cli()
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn("public-safe", result.stderr)
        missing = Path(self.temp.name) / "missing.db"
        result = self.run_cli(missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(missing.exists())
        self.assertEqual(result.stdout, "")

    def test_refuses_uncheckpointed_wal_instead_of_hashing_stale_main_file(self):
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("INSERT INTO meta VALUES ('finished_at', '2026-10-13T18:23:37Z')")
        self.db.commit()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("checkpointed", result.stderr)


if __name__ == "__main__":
    unittest.main()
