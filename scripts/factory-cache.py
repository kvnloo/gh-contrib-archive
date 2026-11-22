#!/usr/bin/env python3
"""Describe a frozen public archive for factory consumption; stdlib, no network."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
EVENT_TYPES = ("issue", "pull_request", "comment", "review", "review_comment",
               "discussion", "discussion_comment")
INCREMENTAL_TYPES = frozenset(EVENT_TYPES[:5])
_TIME = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?: [0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"|T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z)"
)


def _parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not _TIME.fullmatch(value):
        raise ValueError("invalid archive timestamp")
    try:
        return datetime.fromisoformat(value.removesuffix("Z").replace(" ", "T"))
    except ValueError:
        raise ValueError("invalid archive timestamp") from None


def iso_time(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = _parse_time(value).isoformat(timespec="microseconds")
    return normalized.rstrip("0").rstrip(".") + "Z"


def _time_key(value: str | None) -> str | None:
    # Fixed-width fractions make SQLite's text extrema chronological.
    return None if value is None else _parse_time(value).isoformat(timespec="microseconds") + "Z"


def _file_state(path: Path) -> tuple:
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("use a regular frozen public database")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _check_sidecars(paths: tuple[Path, ...]) -> None:
    for path in paths:
        for suffix in ("-wal", "-journal", "-shm"):
            sidecar = Path(str(path) + suffix)
            try:
                info = sidecar.lstat()
            except FileNotFoundError:
                continue
            # Reject links and special files without following or opening them.
            if not stat.S_ISREG(info.st_mode) or info.st_size:
                raise ValueError("use a frozen, checkpointed public database (no active WAL/journal/SHM)")


def _digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _validate_schema(db: sqlite3.Connection) -> None:
    required = {
        "meta": {"key", "value"},
        "contributions": {"type", "visibility", "created_at", "updated_at", "ingested_at"},
        "commit_buckets": {"year", "visibility", "commit_count"},
    }
    for table, columns in required.items():
        entry = db.execute("SELECT type FROM sqlite_schema WHERE name=?", (table,)).fetchone()
        if entry is None or entry["type"] != "table":
            raise ValueError("unsupported archive schema")
        present = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
        if not columns <= present:
            raise ValueError("unsupported archive schema")
    if any(row[0] != "ok" for row in db.execute("PRAGMA quick_check")):
        raise ValueError("invalid archive database")


def _validate_aggregates(db: sqlite3.Connection) -> None:
    placeholders = ",".join("?" for _ in EVENT_TYPES)
    invalid = db.execute(f"""
        SELECT 1 FROM contributions
        WHERE typeof(type) != 'text' OR type COLLATE BINARY NOT IN ({placeholders})
           OR typeof(visibility) != 'text' OR visibility COLLATE BINARY NOT IN ('public','private')
           OR typeof(created_at) != 'text' OR typeof(ingested_at) != 'text'
           OR (updated_at IS NOT NULL AND typeof(updated_at) != 'text')
        LIMIT 1
    """, EVENT_TYPES).fetchone()
    if invalid:
        raise ValueError("invalid contribution aggregate fields")
    invalid = db.execute("""
        SELECT 1 FROM commit_buckets
        WHERE typeof(year) != 'integer' OR year NOT BETWEEN 1 AND 9999
           OR typeof(commit_count) != 'integer' OR commit_count < 0
           OR typeof(visibility) != 'text' OR visibility COLLATE BINARY NOT IN ('public','private')
        LIMIT 1
    """).fetchone()
    if invalid:
        raise ValueError("invalid commit aggregate fields")


def summarize(db_path: Path) -> dict:
    # Immutable SQLite does not lock writers. Detect changes around both the
    # queries and hashes; the caller must still supply a frozen snapshot.
    requested = db_path.absolute()
    db_path = requested.resolve(strict=True)
    if "github.db" in (requested.name.casefold(), db_path.name.casefold()):
        raise ValueError("refusing the private database; use public-safe public.db")
    paths = (requested, db_path)
    _check_sidecars(paths)
    before = _file_state(db_path)
    digest = _digest(db_path)
    if _file_state(db_path) != before:
        raise ValueError("database changed during consumption; use a frozen snapshot")
    _check_sidecars(paths)
    db = sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA trusted_schema=OFF")
        _validate_schema(db)
        metadata = db.execute(
            "SELECT key, value FROM meta WHERE key COLLATE BINARY IN ('privacy','finished_at')"
        ).fetchall()
        if len({row["key"] for row in metadata}) != len(metadata):
            raise ValueError("duplicate archive contract metadata")
        metadata = {row["key"]: row["value"] for row in metadata}
        if metadata.get("privacy") != "public-safe":
            raise ValueError("database is not marked public-safe")
        if "finished_at" in metadata and metadata["finished_at"] is None:
            raise ValueError("invalid archive timestamp")
        finished = iso_time(metadata.get("finished_at"))
        _validate_aggregates(db)
        db.create_function("cache_time", 1, _time_key, deterministic=True)
        freshness = db.execute("""
            SELECT MAX(cache_time(ingested_at)) AS ingested, MAX(cache_time(created_at)) AS created,
                   MAX(cache_time(COALESCE(updated_at, created_at))) AS high_water
            FROM contributions
        """).fetchone()
        rows = db.execute("""
            SELECT type, COUNT(*) AS events,
                   SUM(CASE WHEN visibility='public' THEN 1 ELSE 0 END) AS public_events,
                   MIN(cache_time(created_at)) AS earliest, MAX(cache_time(created_at)) AS latest,
                   MAX(cache_time(ingested_at)) AS ingested,
                   MAX(cache_time(COALESCE(updated_at, created_at))) AS high_water
            FROM contributions GROUP BY type ORDER BY type
        """).fetchall()
        by_type = {row["type"]: row for row in rows}
        types = []
        for kind in sorted(EVENT_TYPES):
            row = by_type.get(kind)
            events = row["events"] if row else 0
            public = row["public_events"] if row else 0
            types.append({
                "type": kind,
                "events": events,
                "publicEvents": public,
                "privateEvents": events - public,
                "earliestEventCreatedAt": iso_time(row["earliest"]) if row else None,
                "latestEventCreatedAt": iso_time(row["latest"]) if row else None,
                "lastRowIngestedAt": iso_time(row["ingested"]) if row else None,
                "eventHighWaterAt": iso_time(row["high_water"]) if row else None,
                "incrementallyRefreshed": kind in INCREMENTAL_TYPES,
            })
        commits = db.execute("""
            SELECT year,
                   SUM(CASE WHEN visibility='public' THEN commit_count ELSE 0 END) AS public,
                   SUM(CASE WHEN visibility='private' THEN commit_count ELSE 0 END) AS private
            FROM commit_buckets GROUP BY year ORDER BY year
        """).fetchall()
        if (_digest(db_path) != digest or _file_state(db_path) != before
                or requested.resolve(strict=True) != db_path):
            raise ValueError("database changed during consumption; use a frozen snapshot")
        _check_sidecars(paths)
        return {
            "contractVersion": 1,
            "privacy": "public-safe",
            "purpose": "contribution-context",
            "databaseSha256": digest,
            "counts": {
                "events": sum(row["events"] for row in types),
                "publicEvents": sum(row["publicEvents"] for row in types),
                "privateEvents": sum(row["privateEvents"] for row in types),
            },
            "freshness": {
                "lastSuccessfulCollectionAt": finished,
                "lastRowIngestedAt": iso_time(freshness["ingested"]),
                "latestEventCreatedAt": iso_time(freshness["created"]),
                "eventHighWaterAt": iso_time(freshness["high_water"]),
            },
            "byType": types,
            "commitsByYear": [{"year": row["year"], "publicCommits": row["public"],
                               "privateCommits": row["private"]} for row in commits],
            "coverage": {
                "completeness": "unknown",
                "notifications": "not-collected",
                "incomingReplies": "not-collected",
                "bodies": "excerpts-only",
                "reviewStates": "nonempty-review-bodies-only",
                "incrementalLimits": {
                    "reviewSearchPullRequests": 400,
                    "reviewsPerPullRequest": 20,
                    "commentsPerReview": 20,
                    "commitRepositoriesPerYear": 100,
                },
            },
        }
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "public.db",
                        help="frozen public-safe SQLite snapshot (default: checkout data/public.db)")
    args = parser.parse_args(argv)
    try:
        report = summarize(args.db)
    except sqlite3.Error:
        # SQLite messages can contain untrusted schema names or data.
        print("factory cache: invalid or unsupported archive database", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"factory cache: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
