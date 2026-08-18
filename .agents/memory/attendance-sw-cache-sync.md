---
name: Attendance SW cache sync
description: The two cache-version markers in the attendance sub-app must stay in lockstep; how the SW update flow works after the v3 hardening.
---

# Attendance SW cache sync

## The rule
Two markers must always be equal:
- `attendance/sw.js` → `const CACHE_VERSION = N;`  (evicts old SW cache `attendance-static-v{old}`)
- `attendance/index.html` → every `<link href="...?v=N">` and `<script src="...?v=N">` (busts HTTP cache before SW is active)

Current value: **3** (set during the attendance-redesign session).

**Why:** Without the `?v=N` on the HTML tags, the browser HTTP cache serves stale CSS/JS on the first load (or while the new SW is still installing). Without the CACHE_VERSION bump, the SW never evicts the old `attendance-static-v{old}` cache and may serve stale assets offline.

**How to apply:** Any time attendance CSS or JS changes, increment BOTH in the same commit. Task #14 tracks adding a build-time check that fails if they diverge.

## SW registration hardening (v3)
`attendance/src/services/sw-registration.service.js` now uses:
- `updateViaCache: 'none'` — browser always fetches a fresh `sw.js` on every navigation, ignoring HTTP cache for the SW script itself
- auto-SKIP_WAITING — if a new SW installs while the tab is open, it posts `SKIP_WAITING` immediately instead of waiting for all tabs to close

## Files
- `attendance/sw.js`
- `attendance/index.html`
- `attendance/src/services/sw-registration.service.js`
- `dist/attendance/` (mirrored by postbuild-dist.mjs on every `npm run build`)
