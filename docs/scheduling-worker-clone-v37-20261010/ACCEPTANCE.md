# v37 Worker DataCloneError hotfix — 2026-10-10

## Confirmed cause and scope

Installed `@supabase/functions-js/src/FunctionsClient.ts` returns `{data,error,response}` (lines 318–325). `response` is a native browser `Response`, including on successful invocation; HTTP errors additionally contain it in `error.context`. The previous client posted the entire object to the Worker. Native Chromium postMessage/structuredClone rejects Response with DOMException DataCloneError, numeric code 25. The previous catch sent numeric 25 to the Worker and the client constructed Error(message=25,code=25), reproducing the production message `25|25` exactly. This is a reproduction with the production SDK envelope, not a captured production exception trace. An Error subclass alone is cloneable in Chromium: the decisive field is the top-level `response`.

## Narrow changes

- `course-scheduling-worker-client.js`: route-result contains only data and plain error metadata. Preserve diagnostic errors during dispose; never send numeric DOM codes as domain errors. Uncloneable route data stops the run rather than silently treating it as unavailable travel.
- `course-scheduling-worker-protocol.js`: route DTO preserves data unchanged; removes HTTP Response/headers/streams. On clone failure only, inspect nested arrays, objects, Map and Set for a diagnostic field path. Do not silently strip constraint data or perform a second clone on every normal message.
- Compiled `constraintContext` stays in the Worker, where it is already rebuilt from the versioned snapshots; it is excluded from run options along with callbacks, signal and route client.
- `course-scheduling-point.worker.js`: retain route exception message.
- `course-scheduling-planning-store.js`: display the clear Hebrew clone diagnostic, including field path.
- Frontend release marker and SW cache 1984 refreshed. No algorithm, constraint, schema, permission or production data changes.

## Executed checks

1. Real Chromium old-client route boundary: **fails with code 25/message 25**. Fixed boundary with the same Response-bearing SDK envelope: **passes**. Nested snapshot callback: fails closed with `planning_worker_data_clone_failed` and `snapshot-patch.entries.0.1.deep.callback`; user-facing Hebrew message verified.
2. National v37 calculation in a real browser Worker, anonymous frozen canonical 2027 fixture from the earlier accepted engine work: **20,527.4 ms**, **253 rows / 225 assigned**, 144 calculated activities, 112 protected engine anchors. **220 missing-route invocations**, each with actual FunctionsHttpError + native Response envelope. Missing routes remain unavailable; no travel bypass. 147 progress messages. Source inputs byte-equivalent after calculation; no database calls or writes. Every non-loopback browser URL blocked.
3. Final engine validation **valid=true**, no hard failures; 110 source warning records remain explicitly protected. Independent arithmetic audit: **0 generated violations**, **73 protected-source findings** (16 home distance, 21 availability, 1 calendar end time, 35 transition). The difference is validator/auditor warning granularity, not 73 new faults. Existing source findings are preserved, not erased or repaired by this hotfix.
4. Four targeted automated tests passed (`node tests/scheduling-worker-clone.test.mjs`): SDK envelope/context projection with unchanged route data; nested snapshot diagnostics/worker cleanup; Map/Set paths and original non-clone errors; invalid nested route data rejection. The Node --test wrapper reported only a file-level pass in this environment, so actual 4-case execution was confirmed by running the test module directly.
5. Vite production build passed (9.71 s). Existing large chunk warnings only. Worker bundling verified by build; generated dist changes discarded. `git diff --check` and Worker syntax passed. No workflow additions.

Acceptance harness debugging: the first browser attempt used only the Error subclass without the SDK response and therefore correctly did not reproduce code 25; corrected to the exact SDK envelope. A subsequent attempt was interrupted by Vite HMR during a code edit; final run above completed after edits. No production requests or mutations in any attempt.

## Reproduce

Manual browser-only acceptance (not wired into PR CI):

```
DECISION_CANONICAL=1 DECISION_DIR=<anonymous-fixture-directory> \
BEFORE_CLIENT=<pre-fix-client-path> ACCEPTANCE_OUT=<output-directory> \
node scripts/acceptance/worker-clone-hotfix.mjs
node tests/scheduling-worker-clone.test.mjs
```

Use the previously supplied frozen anonymous snapshot, routes, canonical and saved fixtures. `BEFORE_CLIENT` must be the version preceding this hotfix. Output: full national plan and browser metrics; checked-in metrics and independent summary accompany this report. No secrets required.

## Recommendation / limits

Ready for review as a transport-only fix. The exact 25 failure is reproduced before and absent after. National calculation completes and generated constraints pass, while protected source findings remain visible. No production national run, production commit, migration, merge or deployment performed. Production confirmation can follow only after approval; existing missing travel data and protected source inconsistencies are not resolved by this hotfix.
