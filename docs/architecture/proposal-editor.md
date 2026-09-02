# Proposal editor ownership

## Before issue #1737

The proposals feature loader installed independent editor listeners from
`proposal-next-year-selection-hydration.js`, `proposal-next-year-option-price-sync.js`,
`proposal-workflow-completion.js`, `proposal-workflow-ui-integrity.js`,
`proposal-next-year-approved-form.js`, and `proposal-editor-compact-fixes.js`.
Several calculated totals or reacted to editor DOM mutations while
`proposals-agreements.js` also calculated totals and rendered the live preview.

A source-level count of modules loaded by `case 'proposals'` at `7c14531` found **22
MutationObserver installations and 40 document listeners**. Six observers and thirteen
document listeners belonged to the overlapping editor/presentation layers above.

## Current model

- `ProposalEditorController` owns the editor snapshot, the canonical totals transaction
  and the sole live-preview schedule. A newer revision cancels the pending animation
  frame; one accepted revision performs one HTML commit and then the deterministic
  document normalizer once.
- `screens/proposals-agreements.js` supplies pure DOM adapters for GEFEN, next-year and
  tour calculations to the controller. No other module initiates an editor calculation.
- `proposal-next-year-workshops.js`, `proposal-next-year-pricing-display.js`, and
  `proposal-next-year-table-alignment.js` expose pure payload/document normalizers. They
  have no auto-install and no observers. `proposal-workflow-completion.js` explicitly
  composes them for loader payloads and preview/snapshot/print/PDF roots.
- `proposal-workflow-completion.js` is an API/snapshot adapter only. It does not subscribe
  to editor inputs or observe application DOM.

The loaded proposal stack now has **16 MutationObserver installations and 27 document
listeners**: reductions of 6 and 13 respectively. The remaining observers/listeners are
outside editor ownership and are retained for explicit PDF-button single-flight and
filename UI, browser-print lifecycle, list/tab counts, client-file/detail enhancement,
contact persistence, GEFEN saved-document layout, retired-summer routing guards, activity
linking, operational naming, domain routing, and screen layout. None calculates editor
totals or observes/re-writes `[data-pa-live-preview]`.

The controller exposes `data-pa-preview-render-count` on the active form so Playwright
stress scenarios assert a maximum of one full preview render per settled action. The
performance budget is one animation-frame preview commit per action, no repeated long
tasks above 250 ms, and zero stale commits for superseded edits.
