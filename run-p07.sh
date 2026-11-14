#!/usr/bin/env bash
# P07 preview build on the MBP: install, run the test suite, static export, pack ./out.
set -uo pipefail
npm ci --no-audit --no-fund >ci.log 2>&1 || { tail -20 ci.log; exit 3; }
node --experimental-strip-types --test tests/*.test.ts >test.log 2>&1; echo "tests exit $?" >>test.log
npm run build >build.log 2>&1 || { tail -30 build.log; exit 4; }
echo "6213b5b" > out/release-commit.txt
tar czf p07-out.tgz out test.log build.log && ls -la p07-out.tgz
