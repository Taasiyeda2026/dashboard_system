# Paged full scheduling workspace

2026-10-12: Postgres logs showed 57014 during `get_scheduling_planning_workspace` while serializing the full saved plan. It returned up to 9.2 MB of JSONB even before network overhead. Add an authenticated, read-only server RPC that returns the identical row/metadata shape in pages of up to 50 records; the client requests 25 at a time in batches of two.

Every page after the first must match the initial workspace revision; after all pages the client rechecks the RLS-protected current revision to reject mixed-version snapshots. The old endpoint remains unchanged and is only a compatibility fallback when the new endpoint has not yet appeared in the PostgREST schema cache.

**Production verification:** A single read-only SQL test under an explicit 8-second statement timeout retrieved all **247 rows** in 10 pages, matched the exact ordered source `activity_id` list, and finished in **379ms**. No source activities, proposals, locks or workspaces were modified. This is not yet a completed national worker run.
