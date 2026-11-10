# Reproduce isolated attendance validation

Requires Docker, Node and installed repository dependencies. No production token or linked Supabase project is used. The helper refuses non-local URLs and refuses to reset any database without the explicit disposable-fixture marker. Each integration suite resets only this disposable fixture, so run them sequentially.

```bash
node scripts/qa/attendance-stability-runtime.mjs
export ATTENDANCE_STABILITY_STATUS="$PWD/work/attendance-stability-qa/status.json"
# Install Playwright Chromium, or point to a compatible system Chromium:
export ATTENDANCE_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
node --test tests/attendance-stability-requests.test.mjs tests/attendance-travel-hang-recovery.test.mjs tests/attendance-missing-travel-direct-navigation.test.mjs
node --test tests/attendance-travel-browser-recovery.test.mjs
node --test tests/attendance-stability-local.test.mjs
node --test tests/attendance-production-contract-local.test.mjs
node --test tests/attendance-stability-browser-local.test.mjs
node scripts/qa/attendance-stability-runtime.mjs stop
```

The runtime uses PostgreSQL 17, GoTrue v2.187.0, PostgREST v14.5 and Kong 2.8.1. It binds ports 54321 and 54332 to loopback only. Local keys/passwords are randomly generated in the ignored work directory and must never be committed. `stop` removes only labelled fixture containers. No CI workflow was added or expanded.

[Hebrew findings and acceptance limits](REPORT.md).

For focused PR review follow-ups only, use the existing browser suite with `--test-skip-pattern="desktop Chrome|Android-sized|iPhone-sized|existing attendance editor"`. Storage upload responses are simulated in that scenario; Auth and report/receipt metadata RPCs are real localhost services. See [REVIEW.md](REVIEW.md) for the scope and remaining live Storage check.
