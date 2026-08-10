---
name: Scheduling matching pipeline
description: Key design facts for the course-scheduling matching engine that are not derivable from reading the code in isolation.
---

## cancelled_meeting_dates filtering — two separate paths

**Rule:** Cancelled meeting dates are handled at TWO distinct layers — do not confuse them.

1. **Existing activities → `activityMeetings()`** (`instructor-scheduling-load.js`).  
   By the time existing activities become flat meeting rows in `existingActivities`, cancelled dates have already been stripped. Trying to filter `cancelled_meeting_dates` again inside `adjacentActivities` or the overlap check is redundant and wrong.

2. **Target activity (course being evaluated) → `meetingRows()`** (`instructor-matching-engine.js`).  
   `meetingRows` calls `cancelled_meeting_dates` on the TARGET activity so that a cancelled meeting on the course itself does not trigger a false conflict against existing activities.

**Why:** `evaluateInstructor` receives `existingActivities` as flat rows (already filtered), but the activity under evaluation comes in as a raw object and is expanded to flat rows internally by `meetingRows`.

## school_id is the canonical same-school identifier

**Rule:** Use `sameSchoolLocation(a, b)` (added in Stage 2).  
- If both rows have a non-empty `school_id`: use `school_id` comparison ONLY. Different IDs = different school even with the same display name.  
- If either `school_id` is absent: fall back to display-name (`same(a.school, b.school)`).

**Why:** Schools can share a name (district headquarters, shared buildings), but `school_id` from the DB is unambiguous.

## planningDraft must gate hard-gate checks in district simulation

**Rule:** In `evaluateCandidate` (course-scheduling-engine.js), `existingActivities` passed to `evaluateInstructor` must be `plannerPeriodMeetings` (persisted + planning draft), not `persistedPeriodMeetings` alone.

**Why:** Without this, the district planner's sequential recommendation loop can assign the same instructor to two overlapping courses — the first recommendation is invisible to the second course's hard-gate check.

**How to apply:** The persisted-only `travel` variable is still computed and returned on the candidate object for UI display; only the gate and the planner-travel use `plannerPeriodMeetings`.

## enforce_end_time applies inside proposeDateAdjustments

**Rule:** `proposeDateAdjustments` applies `enforce_end_time` school-calendar caps to every meeting's `end_time` (via `effectiveEndTime()`) before any availability/overlap/transition check. When only end-time caps are needed (no date shift), it returns a `kind: 'enforce_end_time'` result instead of `null`.

**Why:** The engine uses `adjustment.meetings` as `periodCourse.meetings` for all subsequent checks. If end times were not capped here, shortened school days would be invisible to overlap, travel, and availability gates.
