#!/usr/bin/env python3
"""Describe a frozen public archive for factory consumption; stdlib, no network."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
EVENT_TYPES = ("issue", "pull_request", "comment", "review", "review_comment",
               "discussion", "discussion_comment")
INCREMENTAL_TYPES = frozenset(EVENT_TYPES[:5])


def iso_time(value: str | None) -> str | None:
    if value and len(value) == 19 and value[10] == " ":
        return value.replace(" ", "T") + "Z"
    return value


def summarize(db_path: Path) -> dict:
    # Immutable mode avoids creating WAL/SHM files. Only a frozen, checkpointed
    # checkout is supported; the consumer must keep it fixed throughout reading.
    db_path = db_path.resolve(strict=True)
    if db_path.name == "github.db":
        raise ValueError("refusing the private database; use public-safe public.db")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError("use a frozen, checkpointed public database (no active WAL/journal)")
    db = sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        marker = db.execute("SELECT value FROM meta WHERE key='privacy'").fetchone()
        if marker is None or marker["value"] != "public-safe":
            raise ValueError("database is not marked public-safe")
        finished = db.execute("SELECT value FROM meta WHERE key='finished_at'").fetchone()
        freshness = db.execute("""
            SELECT MAX(ingested_at) AS ingested, MAX(created_at) AS created,
                   MAX(COALESCE(updated_at, created_at)) AS high_water
            FROM contributions
        """).fetchone()
        rows = db.execute("""
            SELECT type, COUNT(*) AS events,
                   SUM(CASE WHEN visibility='public' THEN 1 ELSE 0 END) AS public_events,
                   MIN(created_at) AS earliest, MAX(created_at) AS latest,
                   MAX(ingested_at) AS ingested,
                   MAX(COALESCE(updated_at, created_at)) AS high_water
            FROM contributions GROUP BY type ORDER BY type
        """).fetchall()
        by_type = {row["type"]: row for row in rows}
        types = []
        for kind in sorted(set(EVENT_TYPES) | by_type.keys()):
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
                   SUM(CASE WHEN visibility!='public' THEN commit_count ELSE 0 END) AS private
            FROM commit_buckets GROUP BY year ORDER BY year
        """).fetchall()
        with db_path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
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
                "lastSuccessfulCollectionAt": iso_time(finished["value"]) if finished else None,
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
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"factory cache: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
