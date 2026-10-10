# #2261 — Targeted read-only completion of 10 incomplete searches

Read-only offline replay of production workspace revision 11949. Existing 225 instructor-bearing rows kept as fixed occupancy. No production writes, merge, deploy, or save.

- Elapsed: `11373 ms`
- Assignable now: **6 / 10**
- Not assignable (search completed → recruitment certified): **4 / 10**
- Fixed occupancy preserved: `True`
- Plan validation: `True`
- Production after run: still revision 11949, 225 with instructor, 10 searchIncomplete

## Assignable (lawful proposal found)

### `ACT-b9931cca-0dfd-4a9d-82d4-85855230f399`
- Instructor `emp_id`: `1502`
- 14 meetings | `2026-12-18` → `2027-03-19` | `08:00`–`09:30`
- Retained options: 12

### `PAI-cf89bfd8-ffd4-405f-bde1-89d922876b16`
- Instructor `emp_id`: `1542`
- 12 meetings | `2026-12-31` → `2027-03-18` | `08:00`–`09:30`
- Retained options: 12

### `PAI-e0f504c6-65d0-484e-83ac-97cc494fadb3-2`
- Instructor `emp_id`: `1502`
- 10 meetings | `2026-12-14` → `2027-02-15` | `11:00`–`12:30`
- Retained options: 12

### `PAI-e59b8e24-8f73-4d31-97cb-988e3d10aa15`
- Instructor `emp_id`: `1502`
- 8 meetings | `2027-01-04` → `2027-02-22` | `12:30`–`14:00`
- Retained options: 12

### `school_2027_061`
- Instructor `emp_id`: `1502`
- 10 meetings | `2027-02-05` → `2027-04-09` | `09:30`–`11:00`
- Retained options: 12

### `school_2027_114`
- Instructor `emp_id`: `1502`
- 11 meetings | `2027-01-04` → `2027-03-15` | `09:00`–`10:30`
- Retained options: 12

## Not assignable

These four are the Gedera “בינה מלאכותית” cluster (30 sessions each). Deep bounded search completed; no lawful active instructor remains under hard constraints. They are **recruitment**, not search-incomplete.

### `PAI-efbb152e-cd5b-4f10-aa20-765d85d4b990`
- `recruitment` / `נדרש גיוס`
- `searchIncomplete=False`, `recruitmentCertified=True`
- Hard rejection reasons: `overlap, transition_time, transition_distance_exceeded, blocked_authority, home_distance_exceeded, language`

### `PAI-efbb152e-cd5b-4f10-aa20-765d85d4b990-2`
- `recruitment` / `נדרש גיוס`
- `searchIncomplete=False`, `recruitmentCertified=True`
- Hard rejection reasons: `overlap, transition_time, transition_distance_exceeded, blocked_authority, home_distance_exceeded, language`

### `PAI-efbb152e-cd5b-4f10-aa20-765d85d4b990-3`
- `recruitment` / `נדרש גיוס`
- `searchIncomplete=False`, `recruitmentCertified=True`
- Hard rejection reasons: `overlap, transition_time, transition_distance_exceeded, blocked_authority, home_distance_exceeded, language`

### `PAI-efbb152e-cd5b-4f10-aa20-765d85d4b990-4`
- `recruitment` / `נדרש גיוס`
- `searchIncomplete=False`, `recruitmentCertified=True`
- Hard rejection reasons: `overlap, transition_time, transition_distance_exceeded, blocked_authority, home_distance_exceeded, language`

## Production-safe apply route (not activated)

Point-run only these 10 with `targetCourseIds`, `allowGlobalRepair=false`, current workspace rows as `existingRows`/`committedRows`, lock all non-target instructor-bearing rows, then `save_scheduling_planning_snapshot` for changed target rows only after owner approval. Do not national-rerun.
