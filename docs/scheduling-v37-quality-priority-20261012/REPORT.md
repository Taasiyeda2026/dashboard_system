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
