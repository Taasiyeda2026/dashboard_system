---
name: SW version management rules
description: Rules for managing Service Worker CACHE_VERSION — baseline, update flow, and forbidden actions.
---

# Service Worker / Cache Version Rules

**Baseline: v1400** (set 2026-08-07). Every future version must be higher.

## Single source of truth
`frontend/sw.js` — the line `const CACHE_VERSION = NNN;`  
`dist/sw.js` is a loader only — no independent CACHE_VERSION.  
`dist/frontend/sw.js` mirrors `frontend/sw.js` exactly after each build.

## Forbidden
- Never go below 1400.
- Never reuse 1300, 1301, 1330, or any number already used.
- Never write CACHE_VERSION manually into dist/ files that contradict frontend/sw.js.

## Update flow (after any JS/CSS/HTML change)
1. `sed -i 's/CACHE_VERSION = NNN/CACHE_VERSION = NNN+1/' frontend/sw.js`
2. `npm run build` (from workspace root)
3. `cp frontend/sw.js dist/sw.js && cp frontend/sw.js dist/frontend/sw.js`
4. Verify no active file has a lower CACHE_VERSION than the new one.
5. Update "Current versions" in replit.md.
6. `gitPush({})` via CodeExecution.
7. Restart workflow "Start application".

**Why:** Multiple sessions used conflicting version numbers (1229→1300→1301→1400), causing cache misses and user-visible stale content. 1400 is the agreed clean baseline going forward.

**How to apply:** Before any frontend edit, check the current version in frontend/sw.js. Increment by 1. Never skip or reuse.
