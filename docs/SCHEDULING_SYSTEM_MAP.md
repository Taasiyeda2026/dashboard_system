# Scheduling System Map

Living map of the **course scheduling / national planning** system as implemented on `main`.

Related docs (do not treat as overrides of this map):

- `docs/course-scheduling-smart-logic.md` — scoring / block-first / quality bands (business rules that the code aims to implement)
- `docs/specifications/course-scheduling-2027.md` — product specification (may lag code)

If this map and the code disagree, **the code wins**. Update this file after any material scheduling change.

**Engine version observed while writing:** `PLANNING_ENGINE_VERSION = planning-v21-20260927-self-invalidation` in `frontend/src/screens/course-scheduling-planning.js`.

---

## 1. Screens and tabs

Route: `course-scheduling` (Instructors workspace).

Workspace tabs (`frontend/src/screens/shared/instructors-workspace-nav.js`):

| Tab id | Label | Route / behavior |
|--------|-------|------------------|
| `list` | רשימת מדריכים | `instructors` |
| `scheduling` | שיבוצים | `course-scheduling` (main workboard) |
| `work-schedule` | סידור עבודה | `operations-management` |
| `payroll-control` | בקרת נוכחות | `operations-management` |
| `maintenance` | תחזוקה | `course-scheduling` with `courseSchedulingTab === 'maintenance'` |

Inside `course-scheduling.js`:

- Effective internal tabs via `activeTab(state)`: **`courses`** (default workboard) and **`maintenance`**.
- Legacy values `planning` / `calendar` are forced back to `courses` on render.
- `planningTabHtml` is still imported but **not rendered** on the current path; `calendarTabHtml` helpers exist for legacy calendar UI and are likewise unused by current `render`.
- Capability registry may still list `instructors.planning` — UI remaps it to the workboard. **Needs verification** if any deep-link still expects a separate planning pane.
- UI is a **simple compact workboard** (`data-cs-ui="simple-workboard-20260924-v1"`): list of activities + detail drawer, not a separate planning-only screen.
- Focus mode: arriving from Activities with a selected id shows only that activity (`is-activity-focus`); “הצג את כל הפעילויות” clears focus.
- Inner period controls (not screen tabs): `first` | `second` | `year` via `periodOptions()` / `data-period-key`.

Permissions:

- Workboard / planning: `view_operations_scheduling`
- Maintenance tab: `manage_instructor_maintenance`

---

## 2. Central frontend files

| File | Role |
|------|------|
| `course-scheduling.js` | Screen shell, workboard, detail, draft/confirm UI, planning run orchestration, shared-workspace load/save |
| `course-scheduling-planning.js` | National planner (`buildDynamicCoursePlan`), row kinds, fingerprints, repair/rescue/recruitment packing, overview HTML helpers |
| `course-scheduling-planning-store.js` | Supabase RPCs for workspace/rows/locks/checkpoints; `sharedPlanningAffectedCourseIds`; fingerprint upgrade |
| `course-scheduling-engine.js` | Multi-course block-first planner; mirrors accepted proposals as in-memory drafts |
| `course-scheduling-engine-core.js` | Per-course evaluation, prepared run context, sector calendar filter, urgency ordering for engine path |
| `course-scheduling-score.js` | `SCORE_WEIGHTS`, day placement / travel / workload / preservation / gaps scoring |
| `course-scheduling-travel.js` | `scheduling_travel_cache` client, route matrix, candidate travel context |
| `course-scheduling-date-adjustments.js` | Stage-2 meeting shifts; Saturday block; sector calendar |
| `course-scheduling-meetings.js` | Meeting load / completed meetings / cancellations |
| `course-scheduling-calendar.js` | Week calendar helpers (legacy/auxiliary) |
| `course-scheduling-periods.js` | Period keys (`year` / `first` / `second`) and date bounds |
| `course-scheduling-distance-build.js` | Distance maintenance loop for travel cache |
| `course-scheduling-planning-export.js` | Excel export; Hebrew labels for row kinds |
| `course-scheduling-reason-labels.js` | Human labels for failure/reason codes |
| `instructor-matching-engine.js` | Hard eligibility: language, gender, availability, exceptions, Friday, distance, transition buffer |
| `instructor-scheduling-data.js` | Loads profiles / rules / exceptions |
| `shared/course-scheduling-manual-picker-access.js` | What manual assign may / may not override |
| `shared/course-scheduling-manager-approval.js` | Manager approval UI + RPCs for distance exceptions |
| `shared/school-calendar-logic.js` | `normalizeCalendarSector`, sector filtering |
| `shared/activity-scheduling-eligibility.js` | Which activity types are schedulable |

---

## 3. Activity lifecycle

```
פעילות (school_2027, open)
  → תכנון ארצי / נקודתי (planning rows in shared workspace)
  → הצעה (proposal / fixed-proposal)
  → בחירה / נעילה בתכנון (planning-locked)
  → טיוטה על הפעילות (draft_emp_id / draft_proposed_meetings)
  → אישור / חריגה (confirm planning draft OR assign RPCs; manager approval when required)
  → שיבוץ סופי (emp_id + official dates)
```

Important separation:

- **Planning rows** live in `scheduling_planning_*` and do **not** mutate `activities` until an explicit confirm/assign action.
- **Drafts** on `activities` (`draft_emp_id`, `draft_proposed_meetings`) block the instructor calendar but are not final assignment.
- **Approved** (`emp_id`) is a hard anchor for planning context.

---

## 4. Planning row kinds and statuses

Set mainly in `course-scheduling-planning.js` / export labels in `course-scheduling-planning-export.js`.

| Kind | Meaning in code |
|------|-----------------|
| `live` | Activity already has `emp_id` (approved). Taken as-is; not rewritten by planner options. |
| `draft` | Overview of existing activity draft (`draft_emp_id` without `emp_id`) via `liveRow`. |
| `proposal` | Flexible activity: planner proposes instructor + schedule. |
| `fixed-proposal` | Official dates exist; planner proposes instructor for the fixed schedule (does not invent a new calendar). |
| `planning-locked` | User-selected option stored in `locked_option`; other activities replan around it (`applyPlanningLockToRow` / `lockedPlanningRow`). |
| `recruitment` | Exhaustive search found no eligible existing staff; recruitment packing may attach a synthetic profile. |
| `missing` | Needs treatment / incomplete / no feasible option (and not classified as recruitment). |
| `fixed` | Official schedule exists / activity already started — **dates must not auto-move**; often “מועד קיים — לא מזיזים”. |

Workboard also overlays UI buckets (`assigned` / `draft` / warning) from live activity fields + planning row.

---

## 5. Hard constraints vs scoring / preferences

### Hard (eligibility / failures) — mostly `instructor-matching-engine.js` + DB guards

- Instructor `active`
- Instruction language match (profile languages required)
- Gender when activity requires `male`/`female` (`any` = no gender filter, profile gender still required)
- Weekly availability rules + date exceptions
- Friday when not `friday_allowed`
- Saturday blocked unless `calendar_sector === 'arab'`
- School-calendar blocking days (sector-filtered)
- Overlap with other approved/draft meetings
- Transition time + buffer between adjacent meetings
- Home→school route: missing/unverified route is **not selectable**; distance > `MAX_HOME_DISTANCE_KM` (40) fails hard
- Manual picker: many of the above are non-overridable (`MANUAL_NON_OVERRIDABLE_REASON` in manual-picker-access)

### Soft (scoring after eligibility) — `course-scheduling-score.js`

```js
SCORE_WEIGHTS = {
  continuityEfficiency: 35,
  travelDistance: 25,
  actualWorkload: 20,
  originalSchedulePreservation: 15,
  gapsAndNewDays: 5
}
```

Quality bands (`schedulingQualityBand`): ≥60 recommended, 40–59 warning, &lt;40 technical. Low score ≠ recruitment; recruitment only when **no eligible** instructor.

Planning also uses `PLANNING_OPTIMIZATION_WEIGHTS` (continuity / capacity / travel / geography / stability) for plan-level objective — separate from per-candidate 100-point score.

---

## 6. Instructor availability

| Concern | Where |
|---------|--------|
| Weekday hours | `instructor_availability_rules` (loaded via `instructor-scheduling-data.js`); weekday map in `evaluateInstructor` |
| Exceptions | `instructor_availability_exceptions`; override weekday rule for that date |
| Friday | **Client matching:** weekday `5` is gated by the weekly availability rule (`available`), not by reading `profile.friday_allowed` inside `evaluateInstructor` (the field exists on `DEFAULT_SCHEDULING_PROFILE` / data load). **Server:** still enforces `friday_allowed` → `scheduling_friday_not_allowed`. Treat client/server Friday semantics as a known split — do not “fix” one side without checking the other. |
| Saturday | Blocked by default; allowed when `normalizeCalendarSector(activity.calendar_sector) === 'arab'` |
| Language | `instruction_languages` vs activity language |
| Gender | `required_instructor_gender` vs profile |
| Distance | Cached home→school km; auto hard cap 40 km (`MAX_HOME_DISTANCE_KM`); see manager-approval rules below |
| School calendar sector | `filterSchoolCalendarRowsBySector`: if sector normalizes to empty, **no filter** (all calendar rows returned) — callers must pass activity sector |

Stage-2 date adjustment (`course-scheduling-date-adjustments.js`): when weekly availability fits but a point exception blocks a meeting, propose shifting that meeting (and following) to the next feasible weekly slot, skipping Shabbat/holidays/exceptions. Cap: `MAX_RECOVERABLE_EXCEPTION_MEETINGS = 2` — more instructor-exception meetings → not recoverable via stage-2. Proposal does not write official activity dates until confirm.

---

## 7. Travel logic

| Concept | Implementation |
|---------|----------------|
| Route cache | Table `scheduling_travel_cache`; client `createRouteClient` / `loadSchedulingTravelCacheRows` in `course-scheduling-travel.js` |
| Transition minutes | Driving duration between consecutive meetings of same instructor |
| Buffer | `transitionBufferMinutes(km)`: **5** min if ≤5 km, else **15** min (`NEARBY_*` / `TRANSITION_BUFFER_MINUTES`); must match DB `scheduling_transition_buffer_minutes` |
| Consecutive / adjacency | `adjacentActivities` + gap check in `evaluateInstructor`; score placement in `analyzeDayPlacement` |
| Unknown route | Hard: unverified home/transition → not eligible for draft/final (workboard comments + failure codes) |
| Hard block vs approval | Auto path: home &gt; 40 km fails eligibility. Manual draft: `scheduling_manual_draft_requires_manager_approval` — pure home-distance exception under 60 km may proceed without admin; **≥60 km** or any non-distance manual exception reason requires manager approval. Missing addresses / null cached km also require approval. |
| Inter-school km cap | Consecutive school-to-school transitions hard-capped at **20 km** (`MAX_TRANSITION_DISTANCE_KM` / `scheduling_transition_distance_exceeded`). Restored in `20260930210000_scheduling_transition_buffer_5_15_and_20km_cap.sql` after a temporary removal. |

Distance maintenance UI lives under the **maintenance** tab (`course-scheduling-distance-build.js`).

---

## 8. How planning scenarios / candidates are created

### National planner — `buildDynamicCoursePlan`

1. Build target courses for district/period (`planningWorkspaceCourses`).
2. Context activities = approved assignments only for blocking calendar (existing drafts intentionally **not** treated as hard blockers so planner may replace them).
3. For each target:
   - If `emp_id` → `live` row, skip planning.
   - If `locked_option` → `planning-locked` + virtual plan.
   - If incremental and not in `targetCourseIds` → reuse existing planning row + virtualize its meetings.
   - Else split into **fixed-date unassigned** vs **flexible / missing schedule**.
4. Sort queues (fixed by first date; flexible by `comparePlanningDifficulty`).
5. Build scenarios (`generatePlanningScenarios` / steps): fixed dates → `buildFixedDatePlanningMeetings`; flexible → weekday × times × start dates via `buildWeeklyPlanningMeetings`, heuristically sorted (availability coverage + **travel-aware** adjacency + existing-workday preference). Weekdays that already host work for the instructor/context are generated before fresh days. Limits differ for `fast` vs `deep` planning profiles.
6. Evaluate fixed via `evaluateFixedCourse`; flexible via `evaluateScenarioOptions` → preliminary candidates → travel → engine `calculateCourseSchedule`, producing `options[]`.
7. Accept best option → row kind `proposal` / `fixed-proposal` / `recruitment` / `missing`; push `blockingVirtualActivity` into context.
8. **Day-consolidation pass** (local, not a national rebuild): for flexible proposals that opened a brand-new weekday while the same instructor already has an open day, try reseating onto an open weekday with travel+buffer. Accept only when workdays decrease, or workdays stay equal **and** measured travel km improves (`dayConsolidationAcceptsMove`). Skips fixed/locked/live/started anchors.
9. Optional global repair pass (full runs only, coverage/recruitment only).
10. Recruitment packing for remaining `recruitment` rows.

### Engine path — `calculateCourseSchedule` / block-first (`course-scheduling-engine.js`)

- Core (`course-scheduling-engine-core.js`) evaluates eligibility; adapter applies the 100-point score contract.
- Evaluate candidates per course, sort by urgency / scarce candidates.
- Build **operational blocks** (same `school_id`, same date series, 0–30 minute gaps extend a lane).
- Prefer one instructor for whole block; else fall back per course.
- Accepted proposal mirrored as in-memory draft for subsequent courses.
- Note: scenario **heuristic** adjacency is travel-aware: same `school_id` may abut exactly; different schools use `previousEnd + travelMinutes + transitionBuffer` (rounded to the planning slot) via cached `routeClient.peek` only — no Google calls during scenario generation. Verified km/transition checks still happen in matching/travel validation.

---

## 9. Candidate scoring (continuity / geography / workload / travel / stability)

Per-candidate (`computeSchedulingScore`):

- **Continuity / day efficiency (35):** same school &gt; same authority &gt; short known route &gt; existing workday.
- **Travel distance (25):** from loaded route stats only (no network during score).
- **Actual workload (20):** half-year hours vs eligible peers (approved, drafts, virtual planning drafts, proposed meetings).
- **Original schedule preservation (15):** penalties for stage-2 moves / half overflow.
- **Gaps & new days (5):** new workdays + non-travel waiting.

Stable sort also prefers continuity before fairness; fairness must not split an efficient same-school block only to spread work (`docs/course-scheduling-smart-logic.md` + engine comments).

Plan-level weights (`PLANNING_OPTIMIZATION_WEIGHTS`): continuity 30, capacity 25, travel 20, geography 15, stability 10.

---

## 10. Virtual plans at runtime

`blockingVirtualActivity(activity, option)` clones the activity as:

- `row_id: planning-block:${id}`
- clears approved `emp_id*`
- sets `draft_emp_id` / `draft_proposed_meetings` from the chosen option

`rememberVirtualPlan` appends it to `currentContextActivities`, travel context, and all prepared run contexts so later courses see conflicts/transitions.

---

## 11. Activity processing order

**Inside `buildDynamicCoursePlan`:**

1. Fixed unassigned sorted by first official meeting date, then `row_id`.
2. Flexible/missing sorted by `comparePlanningDifficulty`: fewer estimated instructors → known dates → has time → more sessions/duration → `row_id`.
3. Repair pass reorders with `_repairPriorityIds` first (recruitment/missing/fixed priorities).

**Inside engine-core multi-course path:**

1. `urgencyBand` (`within_7` → `within_14` → `later` → `none`)
2. Lower `baselineEligibleCandidateCount`
3. Earlier `nextUpcomingMeetingDate`
4. `row_id`

---

## 12. Fixed dates / anchors — what may move

| Situation | May auto-move dates? |
|-----------|----------------------|
| Approved assignment (`emp_id`) | No — hard anchor |
| Official school dates on activity (`date_1`… / meetings) | Prefer keep; fixed path assigns instructor to existing dates |
| Activity already started (`planningActivityHasStarted`) | No auto date move (`kind: 'fixed'`) |
| Flexible undated activity | Yes — planner invents start/time alternatives |
| Stage-2 exception adjustment | Proposes alternate meetings in **candidate/planning**; writes only on confirm |
| Shared planning lock | Treated as anchor until unlock |
| Existing draft instructor | Flexible for national planner (drafts removed from blocking context) but school-agreed times still preferred |

---

## 13. Incremental planning vs full rebuild

Orchestration in `course-scheduling.js` when running planning:

```js
fullRun = forceFull
  || !shared?.workspace
  || !existingRows.length
  || unrecoverableGlobalContextChange
```

- **Full run:** all workspace course ids (or resume remainder from checkpoint).
- **Incremental:** `sharedPlanningAffectedCourseIds` from activity dirtiness + granular `contextDiff` (instructors/profiles/availability/exceptions/calendar/catalog parts).
- `contextChanged` alone must **not** force full run (post granular-recalc fix).
- Legacy plain fingerprint match upgrades storage without recalc (see pitfalls).

### `needs_recalc`

- Column on `scheduling_planning_rows`.
- Set by `mark_scheduling_planning_needs_recalc` / trigger on sensitive activity changes.
- Narrowed (migration `20260930001500_...`): mark **that activity**, not the whole workspace blindly.
- Lock changes ripple only to unlocked non-live rows sharing instructor **and** overlapping dates.
- UI: locked row with `needsRecalc` releases lock presentation and waits for targeted rerun.

### Workspace / rows / checkpoints

| Entity | Table | Role |
|--------|-------|------|
| Workspace | `scheduling_planning_workspaces` | Scope `(period_key, district)`, fingerprints, `engine_version`, `revision` |
| Rows | `scheduling_planning_rows` | Per-activity `row_data`, `locked_option`, `needs_recalc`, `activity_updated_at` |
| Checkpoints | `scheduling_planning_checkpoints` | Silent resume mid-run (`data_fingerprint` + `context_fingerprint` keyed) |

Key RPCs: `get_scheduling_planning_workspace`, `save_scheduling_planning_snapshot`, `set_scheduling_planning_lock`, `confirm_scheduling_planning_draft`, `upgrade_scheduling_planning_context_fingerprint`, checkpoint get/save/clear.

### Invalidation flow

1. Sensitive activity/profile/availability/calendar/travel change → mark `needs_recalc` and/or bump revision.
2. Client loads workspace → `resolvePlanningContextChange` + `sharedPlanningAffectedCourseIds`.
3. User runs update → recalculate only affected ids unless unrecoverable global.
4. Snapshot save upserts rows and deletes missing `activity_id`s from payload (full snapshot semantics — callers must pass complete intended set).

---

## 14. Global repair / rescue / recruitment

- **Global repair:** second full `buildDynamicCoursePlan` with `_repairPass` when first pass still has recruitment/missing/fixed needing coverage; accepted only if `comparePlanningPlanQuality` + `globalOptimizationImprovesPlan` improve (more covered staff, fewer recruitment profiles, fewer real draft changes, etc.). Disabled for incremental/`fast` profile when `runGlobalRepair` is false.
- **Rescue:** on incremental touch of a `recruitment` row, `recruitmentRescueProbe` tries existing staff on rescue schedules before keeping recruitment.
- **Recruitment packing:** after planning, group recruitment rows into non-overlapping synthetic profiles (`recruitmentProfileId` / label) for hiring packages.

---

## 15. Manual assignment / manager approval / exception flow

- Detail drawer: auto candidates + manual search (`data-manual-candidate`).
- Recommended path often uses `save_course_assignment_draft(_with_dates)` then assign; manual path uses `save_course_assignment_manual_draft` (+ reason).
- Final write: `assign_activity_instructor` or `assign_activity_instructor_with_dates` (with `draft_proposed_meetings`).
- Confirm planning choice: `confirm_scheduling_planning_draft` (may create single-meeting substitutions).
- Manager approval panel: `course_assignment_manager_approval_state` / `submit_course_assignment_manager_approval` / `review_course_assignment_manager_approval` — gates confirm when `approval_required` (see distance rules in §7).
- Manual picker cannot bypass hard feasibility patterns listed in `MANUAL_NON_OVERRIDABLE_REASON` (language/gender/overlap/unknown routes/impossible transitions/Fri–Sat policy, etc.). Soft quality / pure 40 km preference may be overrideable under the manual+approval policy — still subject to server hard gates.
- Single-meeting substitute / operational replacement flows use dedicated scheduling RPCs (`scheduling_course_meeting_substitutions`, etc.).
- Cancel paths: `cancel_course_assignment_draft` / `cancel_confirmed_course_assignment` (and related).

---

## 16. Supabase — tables, RPCs, triggers (central)

### Tables

- `scheduling_planning_workspaces`
- `scheduling_planning_rows` (+ `needs_recalc`)
- `scheduling_planning_checkpoints`
- `scheduling_travel_cache`
- `instructor_scheduling_profiles` (includes `friday_allowed`)
- `instructor_availability_rules`
- `instructor_availability_exceptions`
- `activities` (assignment + draft + `date_1`…`date_35` + scheduling fields)
- Related: `instructor_assignment_audit`, `edit_requests` (manager-approval request type `course_assignment_exception`) — confirm exact columns/RLS when changing approval UX

### RPCs (representative)

Planning: `get_scheduling_planning_workspace`, `save_scheduling_planning_snapshot`, `set_scheduling_planning_lock`, `confirm_scheduling_planning_draft`, `clear_scheduling_planning_workspace`, checkpoint trio, `upgrade_scheduling_planning_context_fingerprint`, `mark_scheduling_planning_needs_recalc`(_many)

Assignment / validation: `assign_activity_instructor`, `assign_activity_instructor_with_dates`, `scheduling_assert_*`, `scheduling_validate_*`, `scheduling_manual_assignment_hard_violations`, `scheduling_guard_manual_exception_approval`, revalidation helpers after availability/calendar/travel/instructor changes

Travel / geo: `scheduling_authority_school_locations`, `scheduling_active_instructor_locations`, cached travel helpers

### Triggers / invalidation

- Activity update → `scheduling_planning_sensitive_changed` → `mark_scheduling_planning_needs_recalc` when sensitive fields change
- Broader revalidation chain after profile/availability/cancellation/travel/school address/calendar changes (`scheduling_revalidate_after_*`)

---

## 17. Cache / Service Worker / versions

- Manual SW version: `CACHE_VERSION` in `frontend/sw.js` only (root `sw.js` is an entry shim).
- Deployable frontend changes also append a marker to `HOTFIX_VERSION` in `frontend/src/config.js`.
- Scheduling-related hotfix markers present on main include (non-exhaustive): `granular-planning-recalc-…`, `legacy-fingerprint-compat-…`, `scheduling-exception-recovery-…`.
- Do **not** precache bulky archives / `attached_assets` / test paths in the SW.

---

## 18. Permissions (scheduling-relevant)

| Permission / capability | Use |
|-------------------------|-----|
| `view_operations_scheduling` | View/run scheduling workboard & planning RPCs |
| `manage_instructor_maintenance` | Maintenance / distance tab |
| `instructors.scheduling` / `instructors.maintenance` | Workspace nav capabilities |
| Admin-only paths | Some approval reviews / direct overrides (role checks in UI) |

Exact role→permission matrix: see permissions migrations / `permission-policy.js` — **Needs verification** when changing who can confirm drafts.

---

## 19. Important UX rules (from code)

- Recalculation is **explicit** (button); entering the screen only restores the shared plan.
- Search uses **local DOM filtering** (`applyCourseListSearchInPlace`) — typing must not full-render the workboard, rebuild the detail panel, run planning, or hit the network. Scroll/selection/focus stay put because the input node is not replaced.
- Focus mode from Activities: auto-open detail, scroll selected card to center.
- Desktop workboard: list scrolls independently; selected activity shows one continuous work panel (name → school → authority → schedule → status → instructor → warnings → actions → optional details disclosure).
- Stale reasons:
  - Unrecoverable global: “נתוני ההקשר השתנו באופן רוחבי ולכן נדרש חישוב מלא”
  - Recoverable/incremental: activity/availability/rules changed → update changes only
- Empty affected set → toast “התכנון כבר מעודכן” (may still upgrade fingerprint).
- Unknown home routes never selectable for draft/final.
- Workboard actions differ by planning kind (choose proposal / confirm / unlock / alternatives).

---

## 20. Known pitfalls already found and fixed (landed on main)

| Pitfall | What went wrong | Direction of fix |
|---------|-----------------|------------------|
| Sector-specific school calendar leak | Calendar rows from other sectors affected packing/eligibility; empty sector = **no filter** | Always pass activity sector into `filterSchoolCalendarRowsBySector` / normalize (`jewish`/`arab`/`druze`/`general`) |
| Full rerender on search | List search re-rendered the entire workboard each keystroke | `applyCourseListSearchInPlace` filters mounted cards only; no planning/detail rebuild on `input` |
| Focus/navigation to one activity | Handoff from Activities lost selection | Focus mode + `data-course-scroll-target` + auto detail (`course-scheduling-activity-focus-ux` tests) |
| Day packing / continuity | Blocks/lanes wrong when gaps/schools mis-grouped | Operational blocks require verified `school_id` + same date series; 0–30 min lane extend |
| Travel-aware adjacency | Scenario heuristic rewarded `end === start` across schools; real travel validation later rejected it and lost the true slot (e.g. Netanya 8 km / 19 min → +15 buffer → 13:00) | `travelAwareAdjacentStartMinutes` + heuristic/workday preference + local day-consolidation pass |
| False / overly broad `needs_recalc` | Whole workspace dirtied on point edits | Narrow `mark_scheduling_planning_needs_recalc`; lock ripple only overlapping instructor rows |
| Granular context change → full run | Any fingerprint change forced all courses | Granular fingerprint `parts` + `sharedPlanningAffectedCourseIds`; `contextChanged` ≠ `fullRun` |
| Legacy plain fingerprint → unrecoverable | Stored hash like `1gl1u9a` lacked `parts`; new hash used `text(emp_id)` | `planningLegacyPlainContextFingerprint` + upgrade-in-place RPC; no full run just to migrate format |
| Planning activity_id ambiguity | PL/pgSQL variable clash in snapshot/lock | Dedicated migrations fixing ambiguity |
| Exception recovery / substitutes | Confirm path losing single-meeting substitutes | `confirm_scheduling_planning_draft` updates + recovery hotfix |

If a pitfall is only suspected and not proven in tests/migrations, mark new findings as **Needs verification** before documenting as fixed.

---

## 21. Fingerprints (planning context)

- **Data fingerprint:** activity workspace content (`planningDataFingerprint`).
- **Context fingerprint:** instructors/profiles/rules/exceptions/calendar/catalog (+ period). Current storage is JSON `{ v, hash, parts }` (`serializePlanningContextFingerprint`).
- **Legacy plain hash:** pre-granular FNV string; compared via `planningLegacyPlainContextFingerprint`; upgrade via `upgrade_scheduling_planning_context_fingerprint` without touching rows/locks.

---

## Rules that future changes must preserve

1. **Approved assignments are hard anchors** — never auto-reassign or auto-move their official dates.
2. **School-agreed official dates** are not casually moved; flexible invention is only for undated/unstarted flexible activities (or explicit stage-2 proposals awaiting confirm).
3. **Eligibility before scoring** — soft scores never override hard failures; unknown travel is not “good enough”.
4. **Recruitment means no eligible staff**, not a low score.
5. **Planning rows ≠ activity drafts ≠ final assignment** — persist to `activities` only through explicit confirm/assign RPCs.
6. **Incremental by default** — do not force full national rebuild for recoverable/granular context changes or fingerprint format upgrades.
7. **`needs_recalc` must stay precise** — avoid workspace-wide dirty storms; ripple only when instructor/date overlap requires it.
8. **Sector calendar isolation** — never apply another sector’s holidays/closures to an activity.
9. **Virtual plans must remain in-run only** until the user saves/confirms — but they must block later courses in the same run.
10. **Block-first continuity** — do not break an efficient same-school block solely for fairness/workload spreading.
11. **Transition buffer applied once** — nearby ≤5 km → +5 min; above 5 km (and ≤20 km) → +15 min; do not invent a second hidden buffer. >20 km consecutive is a hard reject.
12. **Home distance:** auto eligibility hard-fails above 40 km; manual pure-distance exceptions require manager approval at **≥60 km** (other manual exception reasons still require approval) — do not silently weaken either threshold.
13. **Saturday default blocked**; Arab sector may allow Saturday — keep sector-aware. Do not assume client `friday_allowed` matching mirrors the server without checking both.
14. **Cache discipline** — bump `CACHE_VERSION` + `HOTFIX_VERSION` for deployable frontend scheduling UI/logic; never stash archives in SW precache.
15. **Permission gate** — scheduling RPCs/UI require `view_operations_scheduling` (maintenance separate).
16. **When changing a business rule**, state the rule change explicitly in the PR; update this map in the same change set.
17. **If code and this map disagree**, stop and report the contradiction before shipping a “fix” that assumes the map.

---

## Needs verification (explicit)

- Full inventory of manager-approval physical tables and RLS policies (RPCs/`edit_requests` usage confirmed; column-level contracts not fully re-listed here).
- Whether every `scheduling_revalidate_after_*` trigger is still attached after later migrations — re-check when touching invalidation.
- Exact production district scoping conventions when `district === ''` (national workspace) vs filtered districts — confirm against current ops usage before changing scope keys.
- Workshop / tour activity categories: eligibility helpers exist; product still treats courses as primary — confirm before enabling new types in the national planner.
- Whether any runtime deep-link still renders `planningTabHtml` / calendar pane (current `render` remaps `planning`/`calendar` → `courses`).
- Client Friday gate (weekly rule weekday 5) vs server `friday_allowed` — intentional split or drift; verify before changing either side.
- Exact latest SQL body of overwritten gate functions without replaying the full migration chain on a live DB.
