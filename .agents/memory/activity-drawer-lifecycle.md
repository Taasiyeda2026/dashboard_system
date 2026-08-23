---
name: Activity drawer lifecycle
description: Safe point for applying one-time structural enhancements to activity drawer forms.
---

Apply activity-drawer structural enhancements when every mounted activity drawer opens, independent of edit permission.

**Why:** Detached templates and lightweight test fixtures use the same form markup but rely on their original controls and field ownership. Conversely, read-only users must receive the same stable, compact presentation as editors.