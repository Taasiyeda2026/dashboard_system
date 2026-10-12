# v37 Stage C — quality priority + scoped coverage

Branch work only. No merge, deploy, or production DB/plan writes.

## Technical plan corrections (pre-implementation)

1. **School days ≠ continuity**  
   `schoolActiveDays` (distinct `schoolId|date`) is measured separately from `sameSchoolSequences`. Lexicographic order:

   `covered ↑ → meetingHours ↑ → schoolActiveDays ↓ → instructorWorkDays ↓ → sameSchoolSequences ↑ → … → waiting ↓ → travel ↓`

   Small waiting/continuity gains cannot open an extra school activity day or instructor workday.

2. **Scoped augmenting**  
   `targetCourseIds` + `allowGlobalRepair:false` previously skipped soft-opt entirely. It now runs `scoped-flexible-coverage`: augmenting chains among flexible proposals only, no national quality stage, approved/locked remain barriers. Candidate pools for search are rebuilt against immovable barriers so movable flexible anchors cannot hide chain options.

3. **Options / diagnostics**  
   Final alternatives are legality-filtered against the final plan; the chosen assignment is always present with a fresh score. `optimization.stopReason` / `optimizationScope` replace a blanket incomplete flag when soft-opt was not attempted.

## Before / after (same fixtures)

Full JSON: `evidence/before-after.json`.

### Priority demo (equal coverage/hours)

| Tradeoff | Old compare accepts? | New compare accepts? |
|---|---|---|
| Extra instructor workday for lower waiting | yes | **no** |
| Extra school activity day for continuity | yes | **no** |

### Scoped coverage trap (067/068-style, focused IDs)

| Metric | Before (`skipSoftOptimization`) | After (scoped coverage) |
|---|---:|---:|
| Covered courses | 2 | **3** |
| Teaching hours | 4 | 5 |
| School active days | 4 | 5 |
| Instructor workdays | 4 | 5 |
| Waiting minutes | 0 | 0 |
| Travel minutes | 80 | 100 |
| Runtime ms | ~5.5 | ~10.1 |
| Constraint violations | 0 | 0 |
| Soft-opt scope | not attempted | `scoped-flexible-coverage` |
| Chosen ∈ options | n/a | **true** |

Coverage rose by 1 via an augmenting chain; school/instructor days rose only with that added course (not at equal coverage). National quality stage did not run.

### National 3-course fixture

Coverage, school days, instructor days, waiting, and travel unchanged; runtime +~1.5ms on this tiny fixture.

## Gates

- Covered does not decrease  
- School active days do not increase when coverage is equal  
- Zero new constraint violations  
- Chosen instructor/score/options consistent  
- Scoped path does not run national `operational-quality`  
- New priority rejects extra school/instructor days for continuity/waiting  

## Cache

- `HOTFIX_VERSION` marker: `scheduling-v37-quality-priority-20261012-v1-…`  
- `CACHE_VERSION`: `2000`  

Awaiting owner approval before merge/deploy.
