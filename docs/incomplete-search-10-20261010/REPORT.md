# #2261 — Targeted completion of 10 incomplete searches

Offline point-run of production workspace revision 11949, then owner-approved atomic save of the 6 assignable proposals + 4 Gedera recruitment rows.

- Elapsed (read-only replay): `11373 ms`
- Assignable proposals saved: **6 / 10**
- Gedera recruitment certified: **4 / 10**
- Fixed occupancy preserved: `True` (225 existing instructor rows unchanged)
- Plan validation: `True`
- Save path: `acquire_scheduling_planning_run_lease` + `save_scheduling_planning_incremental_snapshot` (v37 trusted validation)
- Production after save: revision **11950**, **231** with instructor, no constraint violations
- Activities table: unchanged (no final assignment confirmation)

## Assignable (lawful proposal saved)

### `ACT-b9931cca-0dfd-4a9d-82d4-85855230f399`
- Instructor `emp_id`: `1502`
- 14 meetings | `2026-12-18` → `2027-03-19` | `08:00`–`09:30`
- Status: `הצעה מוכנה`

### `PAI-cf89bfd8-ffd4-405f-bde1-89d922876b16`
- Instructor `emp_id`: `1542`
- 12 meetings | `2026-12-31` → `2027-03-18` | `08:00`–`09:30`
- Status: `מתאים טכנית ונדרש טיפול`

### `PAI-e0f504c6-65d0-484e-83ac-97cc494fadb3-2`
- Instructor `emp_id`: `1502`
- 10 meetings | `2026-12-14` → `2027-02-15` | `11:00`–`12:30`
- Status: `הצעה מוכנה`

### `PAI-e59b8e24-8f73-4d31-97cb-988e3d10aa15`
- Instructor `emp_id`: `1502`
- 8 meetings | `2027-01-04` → `2027-02-22` | `12:30`–`14:00`
- Status: `הצעה מוכנה`

### `school_2027_061`
- Instructor `emp_id`: `1502`
- 10 meetings | `2027-02-05` → `2027-04-09` | `09:30`–`11:00`
- Status: `הצעה מוכנה`

### `school_2027_114`
- Instructor `emp_id`: `1502`
- 11 meetings | `2027-01-04` → `2027-03-15` | `09:00`–`10:30`
- Status: `הצעה מוכנה`

## Not assignable (Gedera recruitment)

These four remain without an instructor, status `נדרש גיוס`. Deep bounded search completed; no lawful active instructor under hard constraints.

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

## Save verification

- Pre-save: revision still 11949; activity `updated_at` stamps matched; 225 fixed instructor rows unchanged; no new overlaps involving targets
- Atomic save succeeded → revision **11950**
- Post-save re-read: 231 with instructor; 6 proposals + 4 Gedera recruitment as above
- `scheduling_v37_workspace_validation` completed with no violations
- No final confirmations; `activities.emp_id` for all 10 targets remains null
