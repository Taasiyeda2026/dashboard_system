# Manual isolated reproduction

Requires Node 24, existing npm dependencies, Chromium at /usr/bin/chromium; local PostgreSQL 17 for SQL cases. Do not point any script at production. Browser scripts block non-loopback requests. The bootstrap script intentionally resets the **disposable local** test schema.

Decode `fixtures/*.json.gz.b64` into a writable scratch directory with Python base64 + gzip. `fixtures/manifest.json` records hashes. Use that directory as DECISION_DIR, set DECISION_CANONICAL=1, and set ACCEPTANCE_OUT to a separate writable directory.

```sh
node tests/scheduling-new-core.test.mjs
node tests/instructor-matching-engine.test.mjs
node tests/course-scheduling-shared-planning.test.mjs
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-results node scripts/acceptance/new-engine-national.mjs
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-results node scripts/acceptance/new-engine-worker.mjs
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-results node scripts/acceptance/new-engine-recovery.mjs
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-results node scripts/acceptance/new-engine-process-recovery.mjs
WORKER_RESULT=/tmp/browser.json node scripts/acceptance/new-engine-browser.mjs
```

Browser modes: WORKER_UI_ONLY=1, WORKER_FAULT_ONLY=1, WORKER_START_ONLY=1, WORKER_NETWORK_ONLY=1, WORKER_EXCEL_ONLY=1; optional WORKER_DEVICE=desktop or mobile-cpu4. Default compressed browser fixture is checked in. Browser APIs are stubbed deliberately; this is not an auth/RLS test.

For old engine comparison use ENGINE_MODULE pointing to the old v36 planning module at e3ad085f704697ef1ec58423ea277f439b3fecaf and a separate ACCEPTANCE_OUT. See the SQL scripts' explicit localhost-only connection guards and prerequisites before running bootstrap → seed → save. Do not acquire or embed production secrets. Audit script uses DECISION_PLAN and DECISION_AUDIT_FILE; input paths must remain separate from output paths.

Final single-pipeline command (same prerequisites, disposable loopback PostgreSQL only):

```sh
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-results node scripts/acceptance/new-engine-end-to-end.mjs
```
