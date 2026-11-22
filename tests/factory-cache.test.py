"""Offline factory contract regressions; all fixtures stay in this checkout."""
from __future__ import annotations

import hashlib
import json
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "factory-cache.py"

SPEC = importlib.util.spec_from_file_location("factory_cache", SCRIPT)
CACHE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE)

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

    def assert_refused(self, result):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn("SECRET", result.stderr)

    def test_rejects_unknown_types_and_visibility_without_disclosure(self):
        self.add_event("private:bad", "issue", "private", "2026-01-01T00:00:00Z",
                       None, "2026-01-01 00:00:00")
        for column, value in (("type", "SECRET_TYPE"), ("visibility", "SECRET_VISIBILITY")):
            with self.subTest(column=column):
                self.db.execute(f"UPDATE contributions SET {column}=?", (value,))
                self.db.commit()
                self.assert_refused(self.run_cli())
                self.db.execute("UPDATE contributions SET type='issue', visibility='private'")

    def test_rejects_invalid_timestamps_including_non_extrema(self):
        self.add_event("public:bad", "issue", "public", "2026-01-01T00:00:00Z",
                       None, "2026-01-01 00:00:00")
        self.add_event("public:good", "issue", "public", "2026-10-01T00:00:00Z",
                       None, "2026-10-01 00:00:00")
        for column in ("created_at", "updated_at", "ingested_at"):
            for value in ("SECRET_TIME", "", "2026-02-30T00:00:00Z", "2026-01-01"):
                with self.subTest(column=column, value=value):
                    self.db.execute(f"UPDATE contributions SET {column}=? WHERE id='public:bad'", (value,))
                    self.db.commit()
                    self.assert_refused(self.run_cli())
            self.db.execute(f"UPDATE contributions SET {column}=? WHERE id='public:bad'",
                            (None if column == "updated_at" else "2026-01-01T00:00:00Z",))
        self.db.execute("INSERT INTO meta VALUES ('finished_at', 'SECRET_TIME')")
        self.db.commit()
        self.assert_refused(self.run_cli())

    def test_timestamp_extrema_use_chronology_not_raw_text(self):
        self.add_event("public:1", "issue", "public", "2026-10-13T00:00:00Z",
                       "2026-10-13T00:00:00Z", "2026-10-13T01:00:00Z")
        self.add_event("private:1", "issue", "private", "2026-10-13T00:00:00.001Z",
                       "2026-10-13 02:00:00", "2026-10-13 02:00:00")
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["freshness"]["latestEventCreatedAt"], "2026-10-13T00:00:00.001Z")
        self.assertEqual(report["freshness"]["eventHighWaterAt"], "2026-10-13T02:00:00Z")
        self.assertEqual(report["freshness"]["lastRowIngestedAt"], "2026-10-13T02:00:00Z")
        issue = next(row for row in report["byType"] if row["type"] == "issue")
        self.assertEqual(issue["earliestEventCreatedAt"], "2026-10-13T00:00:00Z")
        self.assertEqual(issue["latestEventCreatedAt"], "2026-10-13T00:00:00.001Z")

    def test_rejects_invalid_commit_aggregates_without_disclosure(self):
        self.db.execute("INSERT INTO commit_buckets VALUES ('private:1', 2026, 'SECRET_REPO', 'private', 9, 'SECRET_URL')")
        for column, values in (
            ("year", ("SECRET_YEAR", 2026.5, 0, 10000)),
            ("commit_count", ("SECRET_COUNT", -1, 1.5)),
            ("visibility", ("SECRET_VISIBILITY",)),
        ):
            for value in values:
                with self.subTest(column=column, value=value):
                    self.db.execute(f"UPDATE commit_buckets SET {column}=?", (value,))
                    self.db.commit()
                    self.assert_refused(self.run_cli())
            self.db.execute("UPDATE commit_buckets SET year=2026, commit_count=9, visibility='private'")

    def test_rejects_missing_schema_corruption_and_views(self):
        paths = []
        for label, sql in (
            ("empty", ""),
            ("missing-column", "CREATE TABLE meta(key, value); INSERT INTO meta VALUES ('privacy','public-safe');"
                               "CREATE TABLE contributions(type); CREATE TABLE commit_buckets(year);"),
            ("view", "CREATE VIEW meta AS SELECT 'privacy' AS key, 'public-safe' AS value;"
                     "CREATE VIEW contributions AS SELECT 'SECRET_TYPE' AS type, 'private' AS visibility,"
                     "'2026-01-01T00:00:00Z' AS created_at, NULL AS updated_at,"
                     "'2026-01-01 00:00:00' AS ingested_at;"
                     "CREATE VIEW commit_buckets AS SELECT 2026 AS year, 'private' AS visibility, 0 AS commit_count;"),
        ):
            path = Path(self.temp.name) / f"{label}.db"
            with sqlite3.connect(path) as db:
                db.executescript(sql)
            paths.append(path)
        corrupt = Path(self.temp.name) / "corrupt.db"
        corrupt.write_bytes(b"not SQLite SECRET_CONTENT")
        paths.append(corrupt)
        for path in paths:
            with self.subTest(path=path.name):
                before = path.read_bytes()
                self.assert_refused(self.run_cli(path))
                self.assertEqual(path.read_bytes(), before)

    def test_rejects_duplicate_contract_metadata(self):
        self.db.execute("ALTER TABLE meta RENAME TO old_meta")
        self.db.execute("CREATE TABLE meta(key TEXT, value TEXT)")
        self.db.executemany("INSERT INTO meta VALUES (?, ?)", [
            ("privacy", "public-safe"), ("privacy", "SECRET_MARKER"),
        ])
        self.db.commit()
        self.assert_refused(self.run_cli())

    def test_rejects_null_success_timestamp_in_malformed_schema(self):
        self.db.execute("ALTER TABLE meta RENAME TO old_meta")
        self.db.execute("CREATE TABLE meta(key TEXT, value TEXT)")
        self.db.executemany("INSERT INTO meta VALUES (?, ?)", [
            ("privacy", "public-safe"), ("finished_at", None),
        ])
        self.db.commit()
        self.assert_refused(self.run_cli())

    def test_commit_integer_overflow_fails_without_partial_json(self):
        self.db.executemany("INSERT INTO commit_buckets VALUES (?, ?, ?, ?, ?, ?)", [
            ("private:1", 2026, "SECRET_REPO", "private", 2**63 - 1, "SECRET_URL"),
            ("private:2", 2026, "SECRET_REPO", "private", 1, "SECRET_URL"),
        ])
        self.db.commit()
        self.assert_refused(self.run_cli())

    def test_rejects_main_file_changed_during_consumption(self):
        original_digest = CACHE.hashlib.file_digest
        changed = False

        def change_and_hash(source, algorithm):
            nonlocal changed
            if not changed:
                changed = True
                self.db.execute("INSERT INTO meta VALUES ('finished_at', '2026-10-13T00:00:00Z')")
                self.db.commit()
            return original_digest(source, algorithm)

        with mock.patch.object(CACHE.hashlib, "file_digest", side_effect=change_and_hash):
            with self.assertRaises(ValueError):
                CACHE.summarize(self.db_path)

    def test_rejects_sidecar_appearing_during_consumption(self):
        original_digest = CACHE.hashlib.file_digest

        def sidecar_and_hash(source, algorithm):
            Path(str(self.db_path) + "-wal").write_bytes(b"SECRET_WAL")
            return original_digest(source, algorithm)

        with mock.patch.object(CACHE.hashlib, "file_digest", side_effect=sidecar_and_hash):
            with self.assertRaises(ValueError):
                CACHE.summarize(self.db_path)

    def test_refuses_private_filename_even_through_symlink(self):
        alias = Path(self.temp.name) / "github.db"
        alias.symlink_to(self.db_path)
        self.assert_refused(self.run_cli(alias))

    def test_sidecars_are_never_modified_and_unsafe_ones_are_refused(self):
        for suffix in ("-wal", "-journal", "-shm"):
            sidecar = Path(str(self.db_path) + suffix)
            with self.subTest(suffix=suffix):
                sidecar.write_bytes(b"SECRET_SIDECAR")
                before = self.db_path.read_bytes()
                self.assert_refused(self.run_cli())
                self.assertEqual(sidecar.read_bytes(), b"SECRET_SIDECAR")
                self.assertEqual(self.db_path.read_bytes(), before)
                sidecar.unlink()

    def test_dangling_sidecar_is_not_treated_as_absent(self):
        sidecar = Path(str(self.db_path) + "-wal")
        sidecar.symlink_to(Path(self.temp.name) / "missing-wal")
        self.assert_refused(self.run_cli())
        self.assertTrue(sidecar.is_symlink())

    def test_deterministic_output_and_zero_sidecars_are_preserved(self):
        self.add_event("private:1", "comment", "private", "2026-01-01T00:00:00Z",
                       None, "2026-01-01 00:00:00")
        for suffix in ("-wal", "-journal", "-shm"):
            Path(str(self.db_path) + suffix).touch()
        before = {path.name: path.read_bytes() for path in Path(self.temp.name).iterdir()}
        first = self.run_cli()
        second = self.run_cli()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual({path.name: path.read_bytes() for path in Path(self.temp.name).iterdir()}, before)


if __name__ == "__main__":
    unittest.main()
