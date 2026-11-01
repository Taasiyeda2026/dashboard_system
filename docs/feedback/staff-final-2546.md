# Staff final questionnaire — issue #2546

The 11 existing educational-staff final drafts retain their IDs and their 33 Hebrew questions verbatim. Arabic working text follows the owner's supplemental specification dated 2026-11-01; it is not represented as an independently verified official translation.

The migration adds bilingual section headings/instructions, all six rating labels, 0–10 endpoint labels, required other details, exclusive no-evidence selection and 250-character limits for questions 12, 13 and 26. Question 26 is required only if any of questions 23–25 equals 1 or 2. Questions 10 and 28 retain their parent-specific triggers. Both client and server enforce these rules. Hidden answers/details are discarded. Choice IDs remain language-independent; 0 and 10 remain the corresponding snapshotted option IDs. N/A persists with null numeric value.

Other details share the original choice answer's `value_text`; the selected values remain in `value_options`. Raw exports and AI open-answer input include these details as well as all seven open questions.

## Validation

- Hebrew and Arabic DOM interaction tests: all questions, eight headings, exact question text, rating captions, endpoints, required other details, character limits, exclusive choices, conditional clearing and full submission callbacks.
- Disposable PostgreSQL 17: migration and publication of all 11 drafts; 44 synthetic submissions covering both languages and active/hidden follow-ups; server-side invalid-input rejection; idempotent submissions; preservation of historical question snapshots and answered campaign versions; retargeting of unanswered active campaigns.
- Actual XLSX serialization/readback from stored answers through the AI package builder preserves Hebrew, Arabic, every open question and other details.
- Relevant existing domain, analysis, AI package, conditional-form, UI and PWA regression cases were checked. Two source-contract assertions needed alignment with the final rendering code; the corrected cases passed. The database harness was rerun after extending persistence/export/publication coverage and fixing a missing function terminator in the initial migration draft. Form tests and build were repeated after correcting the legacy student scale argument; the final checks passed.
- Production build passed; existing unrelated Vite chunk-size/import warnings remain.
- Browser installation is blocked by network policy (`cdn.playwright.dev`); the production Pages origin is outside the environment allowlist. No real browser or visual production acceptance was performed. The owner explicitly authorized continuing with available checks, without changing network policy.

## Release order

1. Merge the reviewed PR and verify the GitHub Pages deployment for its merge commit.
2. Apply `20261101011222_feedback_staff_final_33_rules.sql` through migration history.
3. Run `scripts/feedback/publish-staff-final-2546.sql` as one transaction. It publishes exactly the 11 reviewed drafts and updates active campaign version references only when they have no responses. Existing link tokens, recipients, scheduling/status fields and historical responses remain intact.
4. Verify published counts, all bilingual snapshots, conditional rules, historical hashes and synthetic RPC submissions rolled back in the production database. No messages to real staff are part of acceptance.

No automatic browser/PR workflow was added. Cache release marker and the single service worker version were refreshed.
