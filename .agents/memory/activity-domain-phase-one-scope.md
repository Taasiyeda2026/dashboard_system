---
name: Activity-domain phase-one scope
description: The approved boundary for the initial E/Y activity-domain rollout.
---

`activity_domain` is an independent nullable field on activities, limited to `E` or `Y` when populated. Phase one only backfills unambiguous Y-linked `school_2027` activities and exposes the field in the school-2027 activity create/edit forms.

**Why:** The activity rollout must not implicitly change the separate proposal-price workflow or the existing E/Israa routing behavior.

**How to apply:** Do not alter `proposal_domain`, proposal UI/defaults, or Israa routing while working on this phase. Do not infer domains for unlinked activities, do not surface the field in activity view mode or list tables, and do not backfill other seasons.