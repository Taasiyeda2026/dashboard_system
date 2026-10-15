# תעשיידע — העברת הבעלות על מנוע השיבוצים לסוכן

## החלטת מוצר מחייבת
**הסוכן (שרת חישוב + שיחה ב־ChatGPT) הוא בעל הסמכות היחיד לחישוב, לתכנון, לאופטימיזציה ולהצעת שיבוצים. הדשבורד הוא צרכן תצוגה בלבד בתחום השיבוצים.**

ChatGPT conversation is a client; a durable, backend Node.js worker (the agent engine) performs computation without an open browser. There must never be two independent scheduling engines or two write paths for calculated plans.

## מצב ומניע
The currently deployed chat tool `request_optimization` writes a DB queue entry; an open dashboard screen claims it and calls `runCoursePlanning` in browser. This violates the desired architecture and makes browser availability a dependency. The previous incremental request `bcefc9af-7f12-4348-90ad-3f31b931a562` finished with `failed` / `P0001`. The existing v38 pure planning algorithm lives in `frontend/src/screens/course-scheduling-planning.js` and is Node-compatible; server entrypoint `services/scheduling-agent/compute-plan.mjs` calls that exact algorithm and validates its output.

## Architecture after cutover

```
ChatGPT staff/owner (authenticated user JWT)
       |
       v
Team MCP gateway (tool whitelist, identity/role checks, audit)
       |
       v
Scheduling service: queued jobs + durable Node.js worker
       |-- atomic source snapshot + locked/approved assignments
       |-- verified travel cache and availability
       |-- exact shared v38 scheduling/optimization algorithms
       |-- checkpoint, lease, restart, affected-course dependency closure
       |-- hard constraints + owner-only exception approval
       |-- compare source + workspace revisions under DB transaction
       +-- validated proposal rows -> transactional commit
                                     |
                                     v
                                Supabase DB
                                     |
                                     v
                               Dashboard READ-ONLY
```

## Implementation steps (must finish BEFORE production cutover)
1. **Centralize algorithm:** preserve the existing tested v38 core and build it for the server worker, with no browser, UI modules or raw user inputs that can skip constraints. The core accepts an authenticated, server-built snapshot. This PR introduces its computation-only entrypoint.
2. **Backend input adapter:** fetch a consistent current-year snapshot using least-privilege service credentials; include activities, instructors, scheduling profiles, availability, exceptions, school calendar, program catalog, existing approved/locked and protected rows, cached verified routes. Abort if any critical source is missing; never approximate travel distances.
3. **Durable runner:** a dedicated always-available Node.js process claims work from the existing optimization queue, stores checkpoint and lease heartbeats, emits progress/metrics, resumes interrupted runs, and avoids duplicate execution. In-progress requests and invalidated source revisions are not accepted as completed results. `request_optimization` must wake the worker or the worker must poll reliably without a browser.
4. **Server-side atomic persistence:** re-read source revision, workspace revision, verified engine version and run ownership inside the existing database fenced snapshot RPC; save only validated proposals and separate audit metadata. Never change confirmed instructor assignments when optimizing. A specific staff-approved assignment may be committed through an explicitly authorized RPC; exception approvals are owner-only.
5. **Remove dashboard ownership:** after backend shadow-mode parity verification, turn off `runCoursePlanning`, background browser queue polling, the local planning web worker and all 'run/optimize/recalculate' actions. Keep a read-only list, options, exception status, run status, metrics, and refresh from DB. This must be a **server-enforced** single-owner switch, not merely hiding buttons in the browser. Existing activity management outside scheduling needs separate scoping before removing it.
6. **Hard security/functional acceptance:** test Idan/owner vs Eden and Esraa worker actions and read visibility; ensure data is not leaked to the MCP tool; verify 30/45km transitions, separate home-to-school distance policy, Arab/Druze Saturday, school continuity, travel, mandatory availability, school date locks, approved assignments, concurrent requests, idempotent resumes and revision conflicts.
7. **Cutover:** back up live workspace, compare server shadow results with existing engine on the same frozen input, start worker and verify one real incremental optimization creates only proposals, then set DB `compute_owner='agent'` and remove browser compute privileges. Rollback must restore prior service owner without overwriting any already confirmed assignments.

## Hosting requirement
Do **not** implement national CPU-heavy planning inside Supabase Edge Functions: hosted Edge Functions have a 2-second CPU budget per request as documented at https://supabase.com/docs/guides/functions/limits. Host the Node.js worker in a durable, private compute environment with health checks and a restart policy (or an auditable scheduled job runner with adequate CPU/time limits). Supabase remains the data/auth/audit store, not the calculation engine.

## Current status
- Backend compute-only wrapper: staged in this PR, not deployed.
- Durable job worker: **not implemented**.
- Verified live snapshot adapter: **not implemented**.
- Server-side job claim/save: **not implemented**.
- Dashboard read-only cutover: **not implemented**.
- Existing production plan stays unchanged by this branch.

No false claims of a completed autonomous optimizer until the above steps pass real authenticated integration testing.
