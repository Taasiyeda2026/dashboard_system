# Proposals list loading contract

The initial proposals list must remain lightweight. Before the first list content is
painted, it must not load contacts or authority/school editor catalogs, editor pricing,
proposal templates, the school calendar, PDF dependencies, or full proposal document
snapshots.

Proposal pagination and search remain server-side and limited. Heavy editor and PDF
features remain deferred until after the first list paint. A list enrichment must not
silently turn a lightweight request into a heavy request without a measured performance
justification, a regression test, and review of its first-paint impact.

`ProposalEditorController` is the sole owner of editor totals and live-preview
scheduling. No parallel listener, observer, or calculation owner should be added.

Future performance work must preserve GEFEN eligibility semantics, saved GEFEN approval
status, the proposal approval/send/lock workflow, and PDF/document snapshot behavior.
