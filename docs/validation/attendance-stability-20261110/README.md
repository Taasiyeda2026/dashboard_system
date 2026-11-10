# Existing isolated attendance validation

Use previous passing results unless the relevant behavior changes. The existing disposable runtime is sufficient for attendance/RPC checks; no Storage runtime is required.

```bash
node scripts/qa/attendance-stability-runtime.mjs
export ATTENDANCE_STABILITY_STATUS="$PWD/work/attendance-stability-qa/status.json"
export ATTENDANCE_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
# Select only tests relevant to the change being checked:
node --test tests/attendance-production-contract-local.test.mjs
node --test tests/attendance-stability-local.test.mjs
node --test tests/attendance-stability-browser-local.test.mjs
node scripts/qa/attendance-stability-runtime.mjs stop
```

Run DB suites sequentially: each resets only the explicitly marked disposable local fixture. Non-local URLs are rejected. Local keys remain in the ignored work directory. The production-contract fixture contains metadata/function definitions only, without production rows or credentials.

[Final scope and evidence](REVIEW.md) · [Deployment and rollback](RELEASE.md).
