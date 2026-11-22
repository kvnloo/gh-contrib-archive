"""Offline coverage regressions; synthetic SQLite fixtures stay in this checkout."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "coverage-audit.py"
AS_OF = "2026-10-14T00:00:00Z"


class CoverageAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".coverage-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "public.db"
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript((ROOT / "lib" / "schema.sql").read_text())
        self.db.execute("INSERT INTO meta VALUES ('privacy', 'public-safe')")
        self.db.commit()

    def run_cli(self, *args, path=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(path or self.path),
             "--as-of", AS_OF, "--start-year", "2020", "--end-year", "2026", *args],
            cwd=ROOT, capture_output=True, text=True,
        )

    def report(self, *args):
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("SECRET", result.stdout)
        self.assertNotIn("https://", result.stdout)
        return json.loads(result.stdout)

    def event(self, kind, ingested, visibility="public", created="2016-01-01T00:00:00Z"):
        key = str(self.db.execute("SELECT COUNT(*) FROM contributions").fetchone()[0])
        self.db.execute("""INSERT INTO contributions
            (id, type, url, html_url, repo, title, excerpt, visibility,
             created_at, updated_at, ingested_at, extra_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("SECRET_ID" + key, kind, "https://SECRET_URL/" + key,
             "https://SECRET_URL/" + key, "SECRET_IDENTITY", "SECRET_TITLE", "SECRET_BODY",
             visibility, created, AS_OF, ingested, '{"identity":"SECRET_IDENTITY"}'))
        self.db.commit()

    def bucket(self, year, count, visibility="public", repo=None):
        key = str(self.db.execute("SELECT COUNT(*) FROM commit_buckets").fetchone()[0])
        self.db.execute("INSERT INTO commit_buckets VALUES (?, ?, ?, ?, ?, ?)",
                        ("SECRET_ID" + key, year, repo or "SECRET_REPO" + key,
                         visibility, count, "https://SECRET_URL/" + key))
        self.db.commit()

    def test_missing_year_and_missing_visibility_are_not_zero(self):
        self.bucket(2020, 9, "private")
        self.bucket(2022, 0)
        self.bucket(2023, 3)
        report = self.report("--end-year", "2023")
        years = {row["year"]: row for row in report["commitsByYear"]}
        self.assertEqual(years[2021]["status"], "missing-unknown")
        self.assertIsNone(years[2021]["cachedCommits"])
        self.assertIsNone(years[2021]["publicCommits"])
        self.assertIsNone(years[2021]["privateCommits"])
        self.assertEqual(years[2022]["status"], "cached-zero")
        self.assertEqual(years[2022]["cachedCommits"], 0)
        self.assertEqual(years[2022]["publicCommits"], 0)
        self.assertIsNone(years[2022]["privateCommits"])
        self.assertIsNone(years[2020]["publicCommits"])
        self.assertEqual(years[2020]["privateCommits"], 9)
        self.assertEqual(years[2023]["status"], "cached-nonzero")
        self.assertEqual(report["counts"]["missingYears"], 1)
        self.assertIn("missing-years-are-unknown-not-zero", report["warnings"])

    def test_repository_cap_boundaries_and_private_aggregate(self):
        for year, count in ((2020, 99), (2021, 100), (2022, 101)):
            for index in range(count):
                self.bucket(year, 1, repo=f"SECRET_REPO{index}")
        # A private aggregate is not one repository, and duplicates are not distinct repos.
        self.bucket(2020, 2000, "private")
        self.bucket(2020, 1, repo="SECRET_REPO0")
        report = self.report("--end-year", "2022")
        years = report["commitsByYear"]
        self.assertEqual([row["publicRepositories"] for row in years], [99, 100, 101])
        self.assertEqual([row["repositoryCapFlag"] for row in years], [False, True, True])
        self.assertEqual(years[0]["privateCommits"], 2000)
        self.assertEqual(report["counts"]["cappedYears"], 2)
        self.assertIn("below-cap-does-not-prove-completeness", report["warnings"])
        self.assertIn("private-repository-count-unavailable", report["warnings"])

    def test_freshness_uses_ingestion_and_stale_boundary_not_global_success(self):
        self.event("issue", "2026-10-13 00:00:00")
        self.event("issue", "2026-10-13T02:00:00+02:00")
        self.event("discussion", "2026-09-11 23:12:00", created=AS_OF)
        self.event("discussion_comment", "2026-10-13 00:00:00")
        self.event("comment", "2026-10-07T00:00:00Z", "private")
        self.event("review", "2026-10-06T23:59:59Z")
        self.db.execute("INSERT INTO meta VALUES ('finished_at', ?)", (AS_OF,))
        self.db.commit()
        report = self.report()
        types = {row["type"]: row for row in report["byType"]}
        self.assertEqual(types["issue"]["freshness"], "recent-row")
        self.assertEqual(types["issue"]["rowAgeSeconds"], 86400)
        self.assertEqual(types["discussion"]["freshness"], "stale-row")
        self.assertFalse(types["discussion"]["incrementalRefreshSupported"])
        self.assertEqual(types["discussion_comment"]["freshness"], "recent-row")
        self.assertFalse(types["discussion_comment"]["incrementalRefreshSupported"])
        self.assertEqual(types["comment"]["freshness"], "recent-row")
        self.assertEqual(types["review"]["freshness"], "stale-row")
        self.assertEqual(types["review"]["rowAgeSeconds"], 604801)
        self.assertEqual(types["review_comment"]["freshness"], "unknown-no-rows")
        self.assertIsNone(types["review_comment"]["rowAgeSeconds"])
        self.assertEqual(report["counts"]["staleTypes"], 2)
        self.assertEqual(report["counts"]["nonRefreshedTypes"], 2)
        self.assertEqual(types["comment"]["privateEvents"], 1)

    def test_empty_cache_retains_no_inbox_and_incoming_reply_caveats(self):
        report = self.report("--start-year", "2026")
        self.assertEqual(report["counts"]["events"], 0)
        self.assertEqual(report["counts"]["emptyTypes"], 7)
        self.assertTrue(all(row["freshness"] == "unknown-no-rows" for row in report["byType"]))
        self.assertEqual(report["coverage"]["completeness"], "unknown")
        self.assertEqual(report["coverage"]["inbox"], "unavailable")
        self.assertEqual(report["coverage"]["incomingReplies"], "not-generally-collected")
        for warning in ("no-inbox-or-pending-response-state", "incoming-replies-not-generally-collected",
                        "cached-zero-is-not-certified-zero", "row-freshness-is-not-type-completeness",
                        "commit-refresh-time-unavailable", "discussion-types-not-incrementally-refreshed"):
            self.assertIn(warning, report["warnings"])

    def test_untrusted_type_and_invalid_timestamp_are_not_echoed(self):
        self.event("SECRET_IDENTITY", "https://SECRET_URL/SECRET_BODY", "private")
        self.event("issue", "SECRET_BODY")
        self.event("comment", "2026-10-15T00:00:00Z")
        report = self.report()
        self.assertEqual(report["counts"]["events"], 3)
        self.assertEqual(report["counts"]["unknownTypeEvents"], 1)
        self.assertIn("unrecognized-event-types", report["warnings"])
        types = {row["type"]: row for row in report["byType"]}
        self.assertEqual(types["issue"]["freshness"], "unknown-timestamp")
        self.assertEqual(types["comment"]["freshness"], "unknown-future-row")
        self.assertIsNone(types["issue"]["rowAgeSeconds"])

    def test_success_preserves_database_bytes_and_creates_no_sidecars(self):
        self.event("issue", "2026-10-13 00:00:00", "private")
        self.bucket(2026, 5, "private")
        self.db.close()
        before = self.path.read_bytes()
        files = sorted(path.name for path in self.path.parent.iterdir())
        self.report()
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sorted(path.name for path in self.path.parent.iterdir()), files)

    def test_refuses_unsafe_missing_private_and_active_sidecars_without_disclosure(self):
        for marker in (None, "SECRET_PRIVATE"):
            self.db.execute("DELETE FROM meta WHERE key='privacy'")
            if marker:
                self.db.execute("INSERT INTO meta VALUES ('privacy', ?)", (marker,))
            self.db.commit()
            result = self.run_cli()
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("SECRET", result.stderr)
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('privacy', 'public-safe')")
        self.db.commit()
        for name in ("SECRET_MISSING.db", "github.db"):
            path = self.path.parent / name
            result = self.run_cli(path=path)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertNotIn(str(path), result.stderr)
            self.assertFalse(path.exists())
        for suffix in ("-wal", "-journal"):
            sidecar = Path(str(self.path) + suffix)
            sidecar.write_bytes(b"SECRET_BODY")
            before = self.path.read_bytes()
            result = self.run_cli()
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("SECRET", result.stderr)
            self.assertEqual(self.path.read_bytes(), before)
            self.assertEqual(sidecar.read_bytes(), b"SECRET_BODY")
            sidecar.unlink()

    def test_invalid_cli_values_do_not_echo_input(self):
        for args in (("--as-of", "SECRET_IDENTITY"), ("--as-of", "2026-10-14"),
                     ("--stale-days", "-1"), ("--start-year", "2027"),
                     ("--start-year", "SECRET_IDENTITY")):
            result = self.run_cli(*args)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("SECRET", result.stderr)


if __name__ == "__main__":
    unittest.main()
