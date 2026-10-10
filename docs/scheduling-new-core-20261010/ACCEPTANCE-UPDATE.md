# PR #2236 — final engine acceptance update, 10 October 2026

Scope follows the latest user instruction: finish replacement of the scheduling core and validate national calculation → constraints → save → reload. No UI improvement, server infrastructure or unrelated process was added. No merge/deployment/production migration/data changes.

## 30 CI failures addressed

Case-by-case mapping: `evidence/ci-resolution.json`. Real fixes: cold home/inter-school route acquisition and trusted cache; final checkpoint route validation; incomplete official-hours classification; explicit upgrade-recruitment target scope; legal adjacency candidates and optimization-only instructor/date preservation; draft/locked/count adapter compatibility and actual performance instrumentation. Test updates replace legacy algorithm phases, direct Main Thread calls and outdated version/status labels, and fix invalid synthetic proposals lacking official dates or real instructors/cached routes. Overlap, locked/approved identity, official dates, strict availability, source immutability, bounded scope and trusted save rejection protections remain mandatory. No failed case was skipped or removed from CI selection.

28 core regressions (26 as a full run plus added missing-data and flexible Saturday cases; cold-route case repeated after strengthening its school-to-school assertion), 98 planning contracts, 36 checkpoint contracts, five performance scenarios passed. Netanya suite passed ten cases with one obsolete phase expectation, then that corrected optimization-only case passed individually. Simulation/invalidation suites passed 21/13 cases, then their one corrected contract each passed individually. Full automatic scheduling selection is verified on GitHub, with all existing files retained and the 28 core cases added. Historical failure evidence stays checked in for comparison.

## One end-to-end acceptance pipeline — passed

`new-engine-end-to-end.mjs` runs national calculation, an independent arithmetic audit, disposable PostgreSQL 17 bootstrap/anonymous seed, actual trusted SQL commit and full reload. Same representative anonymous input/hashes as the prior decision test. No browser/RPC stub in this pipeline; identity uses modeled SQL test roles rather than full Supabase Auth. The pipeline was repeated after the final route-scope and date-exception corrections, using the same inputs; earlier runs do not substitute for final evidence.

- 253 result activities, **225 assigned**, 28 unfilled with explicit reasons.
- **Zero new hard-constraint violations** in independent audit. All 109 visible protected assignments and official schedules are source-authoritative; SQL also rejects source date/identity tampering.
- 73 existing protected-source findings remain unchanged and explicitly flagged (16 home-distance, 21 availability, one calendar end time, 35 transitions). They are not certified as newly legal assignments and were not silently changed.
- National calculation **13,924.75 ms**, CPU **12,991.98 ms**, peak RSS **399,404 KiB**. Old paired baseline: 43,005.02 ms / 550,240 KiB / 198 assigned / 59 new violations. Final runtime is ~67.7% lower and coverage +27. Final v37 is slower than the preliminary 11.86-second v37 measurement because of added trusted route acquisition/validation and changed candidate selection; this is disclosed, not treated as an unexplained win.
- Atomic checkpoint commit **2,635.56 ms**; full reload JSON matches every one of the 253 rows. All **16 SQL cases passed**, including invalid-source/identity/date/new-lock rejection, rollback, cancellation fence, permission/ACL checks, full and incremental writers and v37 downgrade rejection.
- Offline route misses: **220 requests**, all return unavailable in the isolated route stub; **zero network/DB requests** during calculation. Unknown travel is never guessed or assigned. SQL save/reload follows calculation against the actual local DB.
- Best verified result retained when the five-second optimizer budget expires; no global optimality/minimum hiring proof.

Raw final results: `evidence/final-end-to-end.json`, `final-national-metrics.json`, `final-independent-audit.json`, `final-sql-acceptance.json`; updated per-activity/instructor CSVs. Final build and syntax results are included. Build was repeated because engine source changed after the earlier build. Frontend release marker/cache bumped as required by AGENTS.md; no UI behavior was expanded.

Recommendation: after the final GitHub scheduling and SQL checks pass, submit this engine replacement for **user approval to merge**, with the preserved-source exceptions and bounded optimization limits above. Applying the migration/deployment requires separate explicit approval. Earlier mobile-start/complete-browser-auth requirements are outside this narrowed engine completion task; no claim that they have been resolved.

Final source also allows flexible Arab/Druze Saturday generation from a positive date exception when weekly Saturday availability is false; Friday still needs separate permission. All 52 representative exceptions are negative; the dedicated positive-exception regression covers the additional case. The final E2E was repeated after this change. National coverage varied 225–226 in these bounded-budget runs (a build overlapped the last run); this is not a proof of deterministic optimal coverage or a strictly load-matched performance comparison. No legal-result validation or source-preservation guarantee depends on optimizer completion.

A CI run on the older base failed unrelated impact-feedback contracts before running scheduling; PostgreSQL regression passed. Main was refreshed and the feature branch rebased to remove stale-base feedback differences, without changing feedback files or loosening tests.
