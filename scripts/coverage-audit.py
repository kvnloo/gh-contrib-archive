#!/usr/bin/env python3
"""Read-only aggregate coverage audit of a frozen public cache; stdlib, no network."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
EVENT_TYPES = ("issue", "pull_request", "comment", "review", "review_comment",
               "discussion", "discussion_comment")
INCREMENTAL_TYPES = frozenset(EVENT_TYPES[:5])
REPOSITORY_CAP = 100  # Collector request limit, not an exhaustion receipt.
MIN_AVAILABLE_KIB = 1572864  # Conservative 1.5 GiB interpretation of the phone limit.


def check_memory() -> None:
    with open("/proc/meminfo") as source:
        for line in source:
            if line.startswith("MemAvailable:"):
                if int(line.split()[1]) < MIN_AVAILABLE_KIB:
                    raise ValueError("memory below 1.5 GiB; audit stopped")
                return
    raise ValueError("available memory unknown; audit stopped")


def audit(db_path: Path, start_year: int, end_year: int,
          as_of: datetime, stale_days: int) -> dict:
    check_memory()
    if db_path.name == "github.db":
        raise ValueError("private database refused")
    db_path = db_path.resolve(strict=True)
    if db_path.name == "github.db":
        raise ValueError("private database refused")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError("active WAL/journal refused; use a frozen checkpointed cache")
    # Immutable mode prevents SQLite sidecar writes. The caller must keep the
    # checkpointed snapshot fixed throughout the audit; no recovery is attempted.
    db = sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        marker = db.execute("SELECT value FROM meta WHERE key='privacy'").fetchone()
        if marker is None or marker["value"] != "public-safe":
            raise ValueError("public-safe marker required")
        rows = db.execute("""
            SELECT type, COUNT(*) AS events,
                   SUM(visibility='public') AS public_events,
                   SUM(visibility!='public') AS private_events,
                   SUM(julianday(ingested_at) IS NULL) AS invalid_times,
                   CAST(ROUND((julianday(?) - MAX(julianday(ingested_at))) * 86400)
                        AS INTEGER) AS age_seconds
            FROM contributions GROUP BY type
        """, (as_of.isoformat(),)).fetchall()
        by_type = {row["type"]: row for row in rows}
        types = []
        for kind in EVENT_TYPES:
            row = by_type.get(kind)
            events = row["events"] if row else 0
            age = row["age_seconds"] if row else None
            if not events:
                freshness = "unknown-no-rows"
            elif row["invalid_times"] or age is None:
                freshness = "unknown-timestamp"
                age = None
            elif age < 0:
                freshness = "unknown-future-row"
                age = None
            else:
                freshness = "stale-row" if age > stale_days * 86400 else "recent-row"
            types.append({
                "type": kind,
                "events": events,
                "publicEvents": row["public_events"] if row else 0,
                "privateEvents": row["private_events"] if row else 0,
                "rowAgeSeconds": age,
                "freshness": freshness,
                "incrementalRefreshSupported": kind in INCREMENTAL_TYPES,
            })
        check_memory()
        buckets = db.execute("""
            SELECT year, COUNT(*) AS buckets, SUM(commit_count) AS commits,
                   SUM(CASE WHEN visibility='public' THEN commit_count END) AS public,
                   SUM(CASE WHEN visibility!='public' THEN commit_count END) AS private,
                   COUNT(DISTINCT CASE WHEN visibility='public' THEN repo END) AS repos
            FROM commit_buckets WHERE year BETWEEN ? AND ? GROUP BY year
        """, (start_year, end_year)).fetchall()
        by_year = {row["year"]: row for row in buckets}
        years = []
        for year in range(start_year, end_year + 1):
            row = by_year.get(year)
            commits = row["commits"] if row else None
            years.append({
                "year": year,
                "status": ("missing-unknown" if row is None else
                           "cached-zero" if commits == 0 else "cached-nonzero"),
                "buckets": row["buckets"] if row else 0,
                "cachedCommits": commits,
                "publicCommits": row["public"] if row else None,
                "privateCommits": row["private"] if row else None,
                "publicRepositories": row["repos"] if row else None,
                "repositoryCapFlag": bool(row and row["repos"] >= REPOSITORY_CAP),
            })
        counts = {
            "events": sum(row["events"] for row in rows),
            "publicEvents": sum(row["public_events"] for row in rows),
            "privateEvents": sum(row["private_events"] for row in rows),
            "unknownTypeEvents": sum(row["events"] for row in rows
                                     if row["type"] not in EVENT_TYPES),
            "missingYears": sum(row["status"] == "missing-unknown" for row in years),
            "cappedYears": sum(row["repositoryCapFlag"] for row in years),
            "staleTypes": sum(row["freshness"] == "stale-row" for row in types),
            "nonRefreshedTypes": sum(not row["incrementalRefreshSupported"] for row in types),
            "emptyTypes": sum(row["events"] == 0 for row in types),
            "unknownFreshnessTypes": sum(row["freshness"].startswith("unknown-") for row in types),
        }
        warnings = [
            "coverage-completeness-unknown",
            "cached-zero-is-not-certified-zero",
            "below-cap-does-not-prove-completeness",
            "private-repository-count-unavailable",
            "commit-refresh-time-unavailable",
            "historical-commit-years-not-continuously-refreshed",
            "row-freshness-is-not-type-completeness",
            "discussion-types-not-incrementally-refreshed",
            "reviews-have-search-and-nested-pagination-limits",
            "bodyless-reviews-not-a-review-state-ledger",
            "no-inbox-or-pending-response-state",
            "incoming-replies-not-generally-collected",
            "public-safe-marker-is-not-live-privacy-verification",
        ]
        for field, warning in (
            ("missingYears", "missing-years-are-unknown-not-zero"),
            ("cappedYears", "repository-cap-reached-possible-truncation"),
            ("staleTypes", "stale-event-types"),
            ("unknownFreshnessTypes", "event-type-freshness-unknown"),
            ("unknownTypeEvents", "unrecognized-event-types"),
        ):
            if counts[field]:
                warnings.append(warning)
        check_memory()
        return {
            "counts": counts,
            "commitsByYear": years,
            "byType": types,
            "coverage": {"completeness": "unknown", "inbox": "unavailable",
                         "incomingReplies": "not-generally-collected"},
            "warnings": warnings,
        }
    finally:
        db.close()


class AggregateParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse normally echoes arbitrary arguments. Never echo identities/URLs.
        self.exit(1, "coverage audit: invalid arguments\n")


def main(argv: list[str] | None = None) -> int:
    parser = AggregateParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "public.db",
                        help="frozen public-safe SQLite snapshot")
    parser.add_argument("--as-of", help="timezone-aware ISO observation time (default: current UTC)")
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year", type=int, help="default: observation year")
    parser.add_argument("--stale-days", type=int, default=7,
                        help="stale when latest row ingestion is older than this many days")
    args = parser.parse_args(argv)
    try:
        as_of = datetime.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc)
        end_year = args.end_year if args.end_year is not None else as_of.year
        if as_of.tzinfo is None or not 1 <= args.start_year <= end_year <= 9999 or args.stale_days < 0:
            raise ValueError("invalid observation time, year range or stale threshold")
    except ValueError:
        print("coverage audit: invalid observation time, year range or stale threshold", file=sys.stderr)
        return 1
    try:
        report = audit(args.db, args.start_year, end_year, as_of, args.stale_days)
    except ValueError as error:
        # Only locally authored errors escape audit(); SQLite/path errors stay opaque.
        print(f"coverage audit: {error}", file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error):
        print("coverage audit: unable to read frozen public cache or available memory", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
