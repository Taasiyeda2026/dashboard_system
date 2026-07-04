# Proposal print / PDF layout notes

## The bug

Printing / "Save as PDF" for a price proposal (`הצעת מחיר`) produced a PDF whose
first page showed only the logo and the "לכבוד" (recipient) block. The entire
proposal body — title, opening paragraph, activity sections, cost table,
terms, signature — started on page 2, even for short proposals with plenty of
unused space left on page 1.

Confirmed with real `page.pdf()` output from Playwright/Chromium (not just a
visual guess): page-1 text occupied ~2–7% of the page height while everything
else landed on page 2.

## The two real causes (found in `frontend/src/styles/main.css`)

**1. A "keep together" rule chained `break-after: avoid` across six elements.**
A print rule set `break-after: avoid` / `page-break-after: avoid` on
`.proposal-document-header`, `.pa-page-header`, `.pa-to-block`,
`.pa-doc-divider`, `.pa-doc-date` and `.pa-doc-title` all at once. That glues
each of them to whatever comes immediately after — so the recipient block,
divider, date and title all end up chained to the opening paragraph as one
unbreakable run. When that whole run didn't fit in the space left on page 1,
the browser pushed the entire chain to page 2.

**2. A dead pre-redesign `@media print` block still matched the real DOM.**
An old block (originally ~main.css:13228-13612), left over from an earlier
2-column header layout, still matched the current elements by their shared
base classes (`.proposal-document`, `.proposal-document-header`,
`.proposal-document-body`, `.proposal-document-content`, `.pa-doc-address`)
even though the visible layout had long since moved on to `.pa-page-header` /
`.pa-to-block` / `.pa-doc-title`. It included `.proposal-document-body {
padding: 0 0 30mm }` (space reserved for a fixed footer that no longer
exists) and `.pa-doc-address { position: absolute }` (from the old layout).
Most of its declarations were already overridden by newer, more specific
rules, but its sheer presence skewed the total computed content height enough
to tip borderline-length proposals (content just barely over one page) into
shoving the whole body to page 2 instead of breaking naturally mid-content.
Confirmed by automated bisection against a real generated PDF: removing this
block was the single largest fix for the reproduced bug.

A third, related landmine was cleaned up preventively: a few later rules
re-applied `display: flex` + `min-height: 297mm` (or `calc(297mm - 24mm)`) to
`.proposal-document.pa-document` for the base and `--next-year` variants.
Chromium cannot fragment a flex column that's forced to a full A4 height
across pages — the whole box gets pushed to the next page instead. This
hadn't been proven to reproduce the bug on its own in testing, but it
contradicts the "no flex on the main print document" rule below, so it was
removed rather than left as a landmine for the next edit.

## Second round: more of the same pattern, found scattered across the file

The first fix (above) didn't fully resolve the bug — the same anti-patterns
were duplicated in several other places in `main.css` that the first pass
missed. A second, more exhaustive sweep found and neutralized, at every
occurrence (not just the ones "already overridden by a later rule"):

- `.proposal-document.pa-document .proposal-document-content { padding-bottom:
  14mm !important; }` (base rule and its print duplicate) — artificial space
  reserved at the bottom of the content box "for the footer", which can push
  the tail of the content past the page boundary. Changed to `0`.
- `.pa-page-footer { margin-top: auto; }` and several duplicates of it
  (including one still marked `!important` inside an older `@media print`
  block) — `margin-top: auto` only means something meaningful when the
  footer's ancestor is a flex/grid container with a fixed height; once that's
  gone it's a landmine that can resurface if flex ever gets reintroduced
  upstream. Changed to a fixed `6px`.
- `.pa-section, .pa-cost-section, .pa-cost-table-block, .pa-catalog-appendix-notice,
  .pa-footer-signature, .pa-page-footer { break-inside: avoid; }` — a single
  rule (without `!important`, so easy to miss when grepping for `!important`)
  bundled small blocks (signature, footer — fine to avoid) together with large
  ones (section, cost section, cost table block — must never avoid). Split
  it: kept `avoid` only for `.pa-footer-signature` / `.pa-page-footer`,
  removed it for the three large containers.
- A bare `.pa-cost-table-block { break-inside: avoid; }` with no media query
  and no `!important` at all, that was technically "already overridden" by
  later `!important` rules but left as a landmine for the next unrelated
  edit. Changed to `auto` directly instead of relying on the override chain.

An `ABSOLUTE FINAL PRINT OVERRIDE` block was added as the literal last rule in
the file, restating all of the above with maximum `!important` so no future
edit inserted earlier in the file can quietly resurrect any of it. **Extend
that block instead of adding new proposal print rules elsewhere in the
file.**

## Do not reintroduce

- `min-height: 297mm` (or any A4-height value) on `.proposal-document` /
  `.proposal-document.pa-document` or its `-body` / `-content` children.
- `display: flex` on the main proposal document wrapper during print.
- `break-after: avoid` / `page-break-after: avoid` chained across the
  header/recipient/divider/date/title elements — that glues them to the
  paragraph that follows and can push the whole chain to the next page.
- `break-inside: avoid` / `page-break-inside: avoid` on a container that
  wraps the *entire* proposal body (only small blocks — a single heading,
  the signature block, a table row — should ever get `avoid`).
- A fixed-position footer (`position: fixed` on any proposal footer element)
  — it makes Chrome reserve artificial space and pushes content to its own
  page. The footer must stay `position: static` in normal document flow.
- Old/legacy proposal print rules "just in case" — if a class isn't emitted
  by `buildProposalDocumentHtml` (in `frontend/src/screens/proposals-agreements.js`)
  anymore, or its declarations are fully superseded by a later, more specific
  rule, delete it instead of leaving it to silently affect layout math later.
- `padding-top: 17mm` (or any nonzero value) on
  `.proposal-document.pa-document.pa-document--next-year`. A pre-redesign
  leftover rule with this exact 3-class selector used to survive past the
  final override block because it matches with equal specificity — being
  last in the file is what makes the override win, not lower specificity.
  Confirmed via real computed styles: it pushed the next-year variant's logo
  ~17mm below the top of the content box, with the base/summer variants
  unaffected (already at 0). The final override block now pins padding-top
  and padding-bottom to `0` for the base document and both the
  `--next-year` / `--summer` modifier classes explicitly — extend that list
  instead of adding a new, lower-specificity rule elsewhere.

## How to verify a future change

Don't trust visual preview alone — generate a real PDF and inspect it:

1. Render the actual (or a faithful fixture of the) proposal document HTML
   with the built `dist/assets/style-*.css`.
2. Print it with Playwright/Chromium: `page.emulateMedia({ media: 'print' })`
   then `page.pdf({ format: 'A4', ... })`.
3. Extract page 1's text (e.g. `pdfjs-dist`) and confirm, in order: the logo,
   "לכבוד", the recipient name, the date, the proposal title, the opening
   paragraph, and the start of the body all appear on page 1 — not just the
   logo and "לכבוד".
4. Test at least: a short proposal (fits on one page), a proposal whose
   content is just barely over one page (the most bug-prone boundary), and a
   longer proposal that must legitimately break to page 2 — the break should
   land naturally mid-content, not push the entire body to the next page.

## Service worker reminder

Any print/CSS change to the proposal document must ship with:
- `npm run build`
- `npm run check:pwa`
- a real PDF check per the steps above
- a `CACHE_VERSION` bump in `frontend/sw.js`, then rebuild so `dist/sw.js` and
  `dist/frontend/sw.js` pick it up (see the Service Worker section in the
  main README).
