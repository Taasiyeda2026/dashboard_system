# v37 Stage C — quality priority + scoped coverage

Branch work only. No merge, deploy, or production DB/plan writes.

## Technical plan corrections

1. **School days ≠ continuity**
   `schoolActiveDays` (distinct `schoolId|date`) is measured separately from `sameSchoolSequences`. Lexicographic order:

   `covered ↑ → meetingHours ↑ → schoolActiveDays ↓ → instructorWorkDays ↓ → sameSchoolSequences ↑ → … → waiting ↓ → travel ↓`

   Small waiting/continuity gains cannot open an extra school activity day or instructor workday.

2. **Scoped augmenting**
   `targetCourseIds` + `allowGlobalRepair:false` runs `scoped-flexible-coverage`: augmenting chains among flexible proposals only, no national quality stage, approved/locked remain barriers. Candidate pools rebuild against immovable barriers. Each move records `targetCourseId` + `role` (`target` / `displaced-blocker`).

3. **Options / diagnostics**
   Final alternatives are legality-filtered and **re-scored** against the final plan; the chosen assignment is always present with a fresh score.

## Before / after

### Priority demo (equal coverage/hours)

| Tradeoff | Old compare accepts? | New compare accepts? |
|---|---|---|
| Extra instructor workday for lower waiting | yes | **no** |
| Extra school activity day for continuity | yes | **no** |

### Scoped coverage trap (067/068-style, focused IDs)

| Metric | Before (`skipSoftOptimization`) | After (scoped coverage) |
|---|---:|---:|
| Covered courses | 2 | **3** |
| Soft-opt scope | not attempted | `scoped-flexible-coverage` |
| Chosen ∈ options | n/a | **true** |
| Displacement tracking | n/a | `target` + `displaced-blocker` |

### Isolated 238-course planning snapshot (read-only export)

Source: `scheduling_planning_rows` (238) + `school_2027` courses; no production writes. Offline travel fillers for 57 missing cache legs. Evidence: `evidence/load-before-after-238.json`.

| Metric | Before (`skipSoftOptimization`) | After (national soft-opt) | Δ |
|---|---:|---:|---:|
| Covered | 210 | **217** | +7 |
| School active days | 1407 | **1346** | −61 |
| Instructor workdays | 975 | 978 | +3 (with +7 coverage) |
| Waiting minutes | 31022 | **22100** | −8922 |
| Travel minutes | 62270 | **61064** | −1206 |
| Travel km | 53772.8 | **52876.1** | −896.7 |
| Runtime ms | ~16735 | ~42018 | +25283 |
| Constraint failures | 0 | 0 | 0 |
| Soft-opt decisions | 0 | 28 |  |
| Protected instructor IDs unchanged | yes | yes |  |
| Soft-opt touched protected | no | no |  |

Four live rows sync meeting dates to current official activity dates (known stale projection vs source); soft-opt decisions do not include those course IDs.

## Gates

- Covered does not decrease
- School active days do not increase when coverage is equal
- Zero new constraint violations
- Chosen instructor/score/options consistent (all options re-scored)
- Scoped path does not run national `operational-quality`
- Scoped path leaves unrelated flexible proposals outside the exchange chain unchanged
- New priority rejects extra school/instructor days for continuity/waiting

## Cache

- `HOTFIX_VERSION` marker: `scheduling-v37-quality-priority-20261012-v2-…`
- `CACHE_VERSION`: `2001`

Awaiting owner approval before merge/deploy.

## Final acceptance (verified routes, main vs PR)

No production writes. Evidence: `evidence/final-acceptance-report.json`.

### 1. Verified travel only
- Dummy fillers disabled; 57 cache pairs remain missing.
- PR softOpt: covered **215**, constraint failures **0**, valid plan.
- Prior filler claim of +7 coverage (210→217) is **not** accepted as travel/legality proof.
- Verified soft vs skip: 214→215 (+1). Newly covered `school_2027_067` has verified home↔school routes.

### 2. main vs PR (softOpt, same verified cache)
| Metric | main | PR | Δ (PR−main) |
|---|---:|---:|---:|
| Covered | 215 | 215 | 0 |
| School active days | 1325 | 1314 | −11 |
| Instructor workdays | 1001 | 974 | −27 |
| Waiting minutes | 19258 | 21156 | +1898 |
| Travel minutes | 60105 | 59002 | −1103 |
| Runtime ms | ~41511 | ~45153 | +~3642 |

Separate softOpt-vs-skip on PR: +1 covered, −64 school days, −2 instructor days, −4783 waiting.

### 3. Data integrity
- 239 courses vs 238 planning rows: missing `ACT-149a9af7` (רוקחים עולם) — open, undated, no planning row.
- Four live date syncs: emp_id unchanged; result meetings match official `activities.date_*`; saved plan was stale; soft-opt did not move them.

### Merge readiness
No blocker found from these three acceptance tests. Awaiting explicit owner approval before merge/deploy.
