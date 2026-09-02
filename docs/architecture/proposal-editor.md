# Proposal editor ownership

## Before issue #1737

The proposals feature loader installed independent editor listeners from
`proposal-next-year-selection-hydration.js`, `proposal-next-year-option-price-sync.js`,
`proposal-workflow-completion.js`, `proposal-workflow-ui-integrity.js`,
`proposal-next-year-approved-form.js`, and `proposal-editor-compact-fixes.js`.
Several of those listeners calculated totals or reacted to editor DOM mutations while
`proposals-agreements.js` also calculated totals and rendered the live preview.

## Current model

- `screens/proposals-agreements.js` is the canonical owner of GEFEN, next-year and
  tour row hydration and calculations. It updates row, group, discount and grand totals.
- `ProposalEditorController` owns the latest editor snapshot and the sole live-preview
  schedule. A newer revision cancels the pending animation frame; one accepted revision
  performs one HTML commit and then the deterministic document normalizer once.
- `proposal-workflow-completion.js` is an API/snapshot adapter only. It no longer
  subscribes to editor inputs or observes application DOM.
- PDF, approval, list, client-file and print runtimes remain lifecycle-specific. They
  do not own editor totals or live-preview rendering.

The controller exposes `data-pa-preview-render-count` on the active form so Playwright
stress scenarios can assert a maximum of one full preview render per settled action.
The performance budget is one animation-frame preview commit per action; superseded
edits must commit zero stale renders.
