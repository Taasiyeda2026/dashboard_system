---
name: Supabase migration history drift
description: Safe response when the linked remote database has migration versions absent from the local repository.
---

The linked Supabase remote can contain migration history that is not present in the local `supabase/migrations` directory. In that state, `supabase db push` refuses even an otherwise valid new migration.

**Why:** Repairing the history or pulling the entire remote schema as a shortcut can alter unrelated migration records and create a broad, hard-to-review workspace diff.

**How to apply:** First run a dry run. If it reports missing local migration versions, do not use `migration repair` for a focused application change. Preserve the idempotent migration in source control and, only when a targeted schema fix is required immediately, apply and verify that exact DDL through the authenticated Supabase management SQL endpoint.