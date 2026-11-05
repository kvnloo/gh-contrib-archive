#!/usr/bin/env python3
"""Freeze a bounded list of public HTTP files with curl's normal TLS validation."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

root = Path(sys.argv[1] if len(sys.argv) > 1 else "evidence")
base = "https://kvnloo.github.io/gh-contrib-archive/"
html = (root / "archive.html").read_text() + (root / "worlds.html").read_text()
urls = sorted({"https://kvnloo.github.io" + s for s in re.findall(r'<script[^>]+src="([^"]+)"', html)})
urls += [base + "worlds/" + name + "/" for name in ["mycelium", "night", "phase", "metro", "constellation"]]
urls += ["https://api.github.com/repos/gazebosim/gz-sensors/pulls/664"]
(root / "frozen-http").mkdir(exist_ok=True)
receipts = {}
for index, url in enumerate(urls):
    if urlparse(url).hostname not in {"kvnloo.github.io", "api.github.com"}:
        raise ValueError("unexpected host")
    relative = "frozen-http/" + str(index) + ".body"
    command = ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60", "--dump-header", str(root / (relative + ".headers")), "--output", str(root / relative), "--write-out", "%{http_code}", url]
    result = subprocess.run(command, text=True, capture_output=True)
    row = {"url": url, "file": relative, "status": int(result.stdout or "0"), "exit": result.returncode, "observed_at": datetime.now(timezone.utc).isoformat(), "command": command}
    print(json.dumps(row), flush=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    receipts[url] = row
(root / "frozen-http.json").write_text(json.dumps(receipts, indent=2) + "\n")
