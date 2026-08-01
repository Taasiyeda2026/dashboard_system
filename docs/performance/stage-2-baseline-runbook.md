# Stage 2 local baseline monitor

The monitor is local, opt-in, and collects metadata only. It never reads request or response bodies, headers, authorization data, query values, document text, form values, or business names. Real baseline exports must not be committed.

## Enable in development

Run `npm run dev`, then open the local URL with `?dsBaseline=1`. The parameter is consumed with `history.replaceState`. Alternatively set `localStorage.setItem('ds_baseline_enabled', '1')` and reload.

## Enable in preview or staging

Build only the non-production deployment with `VITE_DS_BASELINE_MONITOR=true npm run build`, serve that build, and separately enable the browser flag with `?dsBaseline=1` or `ds_baseline_enabled=1`. The build flag alone never installs the monitor. Do not deploy this flagged build to the normal production site.

## Scenarios

Record cold and warm runs for login, dashboard, activities, week, month, end dates, exceptions, archive, operations schedule, operations authorities, completion approvals, inventory, client-file list/open/edit/linked-documents/final-PDF, instructors, and contacts. In operations also record returning to a loaded tab; in client files record returning to the list.

Do not click PDF, image, or completion-approval download controls while measuring automatic loading. A request observed before an explicit allowlisted action is reported as an early load.

Use `window.__dsLocalBaseline.startScenario({ name: 'activities-cold', temperature: 'cold' })`, perform one scenario, then call `endScenario()` and `snapshot()`. Save the snapshot JSON manually outside the repository.

## Generate the local report

Run `npm run baseline:report -- /absolute/path/to/export.json`. Output is written only to the operating-system temporary directory `ds-stage-2-baseline`, outside the repository. It includes normalized JSON, summary CSV, Markdown, heavy requests, duplicates, early loads, and cold/warm data. Missing browser size metrics are reported as `N/A`.

## Remove

Call `window.__dsLocalBaseline.uninstall()`. This disconnects observers, removes listeners, clears timers and in-memory data, and restores the original fetch only if the monitor wrapper is still active. To disable future development runs, remove `ds_baseline_enabled` manually and reload.
