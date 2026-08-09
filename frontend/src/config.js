import './proposal-recipient-search-row-fix.js?v=20260801-v10';
import './instructors-header-cleanup.js?v=20260807-guides-search-fix-v1';

/**
 * frontend/src/config.js — המקור היחיד לכתובת ה-API בכל הפרויקט.
 *
 * אין לשים URL של Google Apps Script בשום קובץ אחר בפרויקט.
 * כל שינוי ב-API URL חייב להיעשות כאן בלבד.
 *
 * סדר עדיפויות לקביעת ה-URL:
 *  1. window.__DASHBOARD_CONFIG__.apiUrl  — מוגדר ב-index.html לפני טעינת האפליקציה (מומלץ לייצור)
 *  2. ?apiUrl=...                         — פרמטר query בכתובת הדפדפן (לבדיקות/dev)
 *  3. DEFAULT_API_URL                     — כתובת פריסה ברירת מחדל (production)
 *
 * כדי להחליף סביבה (dev/staging/prod), שנו את DEFAULT_API_URL כאן או השתמשו
 * ב-window.__DASHBOARD_CONFIG__ מחוץ לבאנדל.
 */
const runtimeConfig = (typeof globalThis !== 'undefined' && globalThis.__DASHBOARD_CONFIG__) || {};

/**
 * כתובת פריסת Web App הנוכחית.
 * ניתן לדרוס ב-`window.__DASHBOARD_CONFIG__.apiUrl` או ב-`?apiUrl=` בלא שינוי קוד.
 */
const DEFAULT_API_URL =
  'https://script.google.com/macros/s/AKfycbwOE07-PLbJiWAK-Rf58ymMvgu0b0WSaIn040nOKjKyQSecju3Bsdcl6oLgZnlvtc0_/exec';

function resolveApiUrl() {
  if (runtimeConfig.apiUrl) return String(runtimeConfig.apiUrl).trim();

  try {
    const fromQuery = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    ).get('apiUrl');
    if (fromQuery) return fromQuery.trim();
  } catch {}

  return DEFAULT_API_URL;
}

const resolvedUrl = resolveApiUrl();

if (!resolvedUrl) {
  console.warn(
    '[Dashboard] API URL לא הוגדר. הגדירו window.__DASHBOARD_CONFIG__.apiUrl לפני טעינת האפליקציה, '
    + 'או העבירו ?apiUrl= בכתובת, או עדכנו DEFAULT_API_URL ב-frontend/src/config.js.'
  );
}

export const config = {
  apiUrl: resolvedUrl,
  DIAGNOSTICS_UI_ENABLED: false,
  HOTFIX_VERSION: 'client-contact-secure-rpc-auth-session-security-timeouts-20260726-v2-activity-drawer-cache-20260727-v1-edit-dedup-v1-performance-cache-20260727-v1-dashboard-exceptions-unique-20260728-v2-completion-approval-performance-20260728-v1-always-fresh-data-20260728-v1-nonblocking-fetch-20260728-v1-month-navigation-20260728-v1-dashboard-august-navigation-20260728-v1-progressive-route-warmup-20260728-v1-next-year-pricing-20260729-v1-next-year-workshops-20260729-v1-login-sw-refresh-20260729-v1-restore-2026-summer-20260730-v1-sw-cache-refresh-20260730-v1-proposal-pdf-school-filename-20260730-v1-instructor-matching-modal-20260730-v1-israa-excel-drawer-20260730-v1-israa-approved-fields-20260730-v2-israa-toolbar-filters-20260730-v1-israa-compact-drawer-multiselect-20260730-v1-israa-program-multiselect-click-fix-20260730-v1-israa-program-menu-visible-20260730-v1-annual-review-print-shell-20260730-v1-annual-review-isolated-print-20260730-v2-proposal-editor-compact-cache-20260801-v1-proposal-editor-flat-layout-20260801-v1-proposal-template-switch-stability-20260801-v1-proposal-contact-save-button-20260801-v1-proposal-contact-edit-source-recovery-20260801-v1-nextyear-workshop-row-20260801-v1-recipient-meta-single-row-20260801-v1-proposal-recipient-meta-alignment-20260801-v2-proposal-recipient-search-same-row-20260801-v1-school-2027-default-cutover-20260801-v1-stage2-local-baseline-monitor-20260801-v1-performance-continuation-20260801-v1-proposal-recipient-final-ui-20260801-v1-proposal-recipient-single-source-20260801-v2-perf-projections-lazy-20260801-v1-proposal-recipient-workshops-final-20260801-v1-recipient-single-row-grid-20260801-v1-recipient-date-domain-130-20260801-v1-perf-startup-client-file-20260801-v1-e2e-gate-fixes-20260802-v1-proposal-editor-reference-ui-20260802-v1-proposal-editor-cascade-20260802-v1-ui-regressions-proposal-activities-scheduling-20260802-v1-proposal-error-return-20260802-v1-2026-readonly-complete-history-20260802-v1-proposal-type-tashpaz-totals-20260802-v1-district-assignment-exceptions-20260802-v1-proposal-pdf-full-document-20260802-v1-simplify-activity-scheduling-requirements-20260802-v1-next-year-editor-stability-20260802-v1-final-calendar-proposals-regressions-20260802-v1-instructors-header-cleanup-20260802-v1-proposal-summer-list-complete-20260802-v1-approved-ui-regressions-20260802-v1-activities-loop-proposal-tables-20260802-v1-proposal-pdf-school-name-only-20260803-v1-next-year-workshop-live-refresh-20260803-v1-next-year-mixed-workshop-selection-20260803-v1-course-scheduling-travel-cache-readiness-20260803-v1-course-scheduling-blocking-fixes-20260803-v2-course-scheduling-cache-key-alignment-20260803-v3-single-route-expiry-ui-20260803-v4-course-scheduling-isolated-design-20260803-v1-course-scheduling-ux-redesign-20260804-v1-course-scheduling-ux-polish-20260804-v1-course-scheduling-ux-polish-20260804-v2-course-scheduling-ux-polish-20260804-v3-course-scheduling-empty-action-btn-20260804-v4-instruction-language-default-he-20260804-v1-tashpaz-unified-activities-20260804-v1-course-scheduling-results-travel-checks-20260804-v1-activities-funding-filters-20260804-v1-tashpaz-dual-tables-shared-picker-20260804-v1-gefen-approval-list-status-20260804-v1-pr1333-ops2027-fixes-20260805-v1-scheduling-permission-removal-20260804-v1-scheduling-age-layer-removal-20260804-v1-half-year-authority-scheduling-20260804-v1-school-2027-district-normalization-20260804-v1-course-scheduling-compact-layout-20260804-v1-course-scheduling-hierarchy-polish-20260805-v1-course-scheduling-density-redesign-20260805-v1-course-scheduling-structural-layout-20260805-v1-proposals-table-widths-20260805-v1-proposals-signed-column-final-align-20260805-v1-course-scheduling-compact-symmetric-20260805-v1-operations-2027-loading-cache-cleanup-20260805-v1-course-scheduling-row-structure-final-20260805-v1-course-scheduling-ui-actions-constraints-20260805-v1-activity-requirements-matching-20260805-v1-scheduling-candidate-classification-20260805-v1-ops-2027-workshop-inventory-table-20260805-v1-activity-meetings-autofill-20260805-v1-activity-sessions-and-signed-marker-20260806-v1-existing-activity-edit-session-rows-20260806-v1-session-holiday-generation-20260806-v1-school-2027-monthly-activities-20260806-v1-course-scheduling-authority-maintenance-tab-20260806-v1-scheduling-quality-tiers-20260806-v1-scheduling-distance-nonblocking-20260806-v1-scheduling-proposed-dates-20260807-v1-proposed-dates-review-fixes-20260807-v2-pr1389-review-20260807-v3-scheduling-stage3-global-optimization-20260807-v1-pr1391-review-fixes-20260807-v2-pr1391-review2-20260807-v3-pr1391-stage3-scoring-priority-20260807-v4-pr1391-prelim-empid-fix-20260807-v5-scheduling-stage-4-ui-20260806-v1-scheduling-stage-4-ui-nav-perm-20260807-v2-scheduling-logic-ui-corrections-20260807-v1-scheduling-hidden-planning-state-20260807-v1-district-scheduling-simulation-20260807-v1-district-sim-review-fixes-20260807-v2-route-reliability-selected-candidate-20260807-v3-unresolved-transition-route-20260807-v4-ops-2027-workshop-inventory-lists-auth-hotfix-20260807-v1-district-sim-save-drafts-20260807-v1-workshop-inventory-2027-opening-balances-20260807-v1-course-scheduling-e2e-alignment-20260807-v1-cache-1455-20260807-v2-workshop-stock-location-holder-status-20260807-v1-guides-page-redesign-cache-1458-20260807-v1-guides-page-search-removal-depth-cache-1459-20260807-v1-guides-card-shadow-fix-cache-1460-20260807-v1-session-expiry-proposal-recovery-20260809-v1-course-scheduling-production-stability-20260809-v1-course-scheduling-draft-ownership-20260809-v1-route-record-refresh-separation-20260809-v1-course-scheduling-contract-sync-20260809-v1-distance-coverage-card-20260809-v1-course-scheduling-legacy-cleanup-20260809-v1-instructor-assignment-sync-20260809-v1-course-scheduling-operational-split-view-20260809-v1-instructors-heading-cleanup-20260809-v1'

};
