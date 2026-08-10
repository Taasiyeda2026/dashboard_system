/**
 * One-shot feature loaders.
 * Heavy screen modules (PDF, annual reviews, Israa, activity drawers, operations)
 * stay out of the initial bootstrap and load only when their route/feature is used.
 *
 * Feature CSS is imported through Vite so production builds emit and load real
 * text/css assets instead of serving the application fallback for source paths.
 *
 * Every JS import() below uses a string literal so Rollup/Vite can emit async chunks.
 */

const featurePromises = new Map();

function loadOnce(name, loader) {
  if (featurePromises.has(name)) return featurePromises.get(name);
  const promise = Promise.resolve()
    .then(loader)
    .catch((error) => {
      featurePromises.delete(name);
      console.warn(`[feature-loader] failed: ${name}`, error);
      throw error;
    });
  featurePromises.set(name, promise);
  return promise;
}

function resolveAssetUrl(relativePath) {
  try {
    return new URL(relativePath, import.meta.url).href;
  } catch {
    return relativePath;
  }
}

function loadStylesheet(relativePath) {
  const href = resolveAssetUrl(relativePath);
  if (typeof document === 'undefined') return Promise.resolve();
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find((link) => link.href === href || link.getAttribute('href') === relativePath);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.featureLoaderCss = relativePath;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.appendChild(link);
  });
}

export const FEATURE_ROUTE_MAP = {
  dashboard: ['dashboard'],
  activities: ['activityDrawer'],
  week: ['activityDrawer'],
  month: ['activityDrawer'],
  archive: ['activityDrawer'],
  exceptions: ['activityDrawer'],
  'end-dates': ['endDates'],
  'proposals-agreements': ['proposals'],
  'israa-management': ['israa'],
  'personal-reports': ['annualReviews'],
  'operations-management': ['operations'],
  'admin-lists': ['admin'],
  'admin-settings': ['admin'],
  'admin-home': ['admin']
};

export function ensureFeature(name) {
  switch (name) {
    case 'dashboard':
      return loadOnce('dashboard', () => Promise.all([
        import('./dashboard-kpi-corrections.js?v=20260801-perf-startup-v1'),
        import('./dashboard-exception-count-hotfix.js?v=20260728-unique-exception-activities-v2'),
        import('./dashboard-month-navigation-runtime.js'),
        import('./birthday-popup.js'),
        import('./birthday-popup-session-guard.js'),
        import('./birthday-calendar.js')
      ]));

    case 'proposals':
      return loadOnce('proposals', () => Promise.all([
        import('./styles/proposal-editor-compact-fixes.css'),
        import('./proposal-pdf-svg-origin-clean.js'),
        import('./proposal-pdf-storage-key-hotfix.js'),
        import('./proposal-pdf-download-filename-hotfix.js'),
        import('./proposal-pdf-single-generation-hotfix.js'),
        import('./proposal-pdf-school-filename-runtime.js?v=20260803-school-name-only-v2'),
        import('./proposal-incomplete-print-runtime.js?v=20260729-preview-freeze-v2'),
        import('./proposal-next-year-pricing-display.js?v=20260729-next-year-pricing-v1'),
        import('./proposal-next-year-table-alignment.js?v=20260804-dual-tables-v1'),
        import('./proposal-next-year-workshops.js?v=20260804-dual-tables-shared-picker-v1'),
        import('./proposal-next-year-space-workshop-pricing.js?v=20260801-space-workshop-editor-deps-v1'),
        import('./proposal-next-year-selection-hydration.js?v=20260804-dual-tables-v6'),
        import('./proposal-next-year-option-price-sync.js?v=20260804-dual-tables-v1'),
        import('./proposal-workflow-completion.js?v=20260810-gefen-single-owner-v1'),
        import('./proposal-workflow-ui-integrity.js?v=20260810-gefen-single-owner-v1'),
        import('./proposal-summer-list-runtime.js?v=20260802-v1'),
        import('./proposal-client-home-load-more-fix.js?v=20260803-v1'),
        import('./proposal-gefen-approval-list-status.js?v=20260804-v1'),
        import('./proposal-next-year-approved-form.js?v=20260804-dual-tables-v6'),
        import('./proposal-approval-runtime.js'),
        import('./client-contact-persistence-hotfix.js'),
        import('./school-catalog-bootstrap-hotfix.js?v=20260730-full-school-catalog-v1'),
        import('./school-calendar-runtime.js'),
        import('./gefen-proposal-layout-update.js'),
        import('./gefen-proposal-pdf-header-alignment.js'),
        import('./proposal-full-clone-runtime.js?v=20260729-independent-clone-v2'),
        import('./proposal-summer-creation-retired.js?v=20260731-retire-summer-v1'),
        import('./proposal-activity-linking.js'),
        import('./proposal-domain-routing.js'),
        import('./proposal-editor-compact-fixes.js?v=20260804-dual-tables-v1'),
        import('./screens/client-file-layout-polish.js?v=20260721-client-file-layout-v2'),
        import('./proposal-details-public-cleanup.js?v=20260801-perf-startup-v1')
      ]));

    case 'annualReviews':
      return loadOnce('annualReviews', () => Promise.all([
        import('./screens/annual-reviews-v2.js'),
        import('./annual-reviews-language-safe.js?v=20260730-final-pdf-upload-v1'),
        import('./annual-reviews-rating-comment-compact.js'),
        import('./annual-reviews-safe-extension-styles.js'),
        import('./annual-reviews-next-school-year-safe.js'),
        import('./annual-reviews-role-lessons-safe.js'),
        import('./annual-reviews-ui-compact-feedback.js'),
        import('./annual-reviews-print-plain.js'),
        import('./annual-reviews-print-shell-fix.js?v=20260730-blank-print-v1'),
        import('./annual-reviews-manager-question-set.js'),
        import('./annual-reviews-manager-dedup.js?v=20260730-manager-dedup-v1'),
        import('./annual-reviews-readable-print.js?v=20260730-readable-print-v5'),
        import('./annual-reviews-isolated-print.js?v=20260730-compact-print-v4'),
        import('./annual-reviews-final-pdf-safe.js')
      ]));

    case 'israa':
      return loadOnce('israa', () => Promise.all([
        import('./israa-tracking-v2-runtime.js?v=20260730-israa-program-menu-visible-v1'),
        import('./israa-tracking-filters-runtime.js?v=20260730-israa-toolbar-filters-v6'),
        import('./israa-tracking-hierarchy-runtime.js?v=20260730-israa-toolbar-filters-v6')
      ]));

    case 'activityDrawer':
      return loadOnce('activityDrawer', () => Promise.all([
        import('./birthday-calendar.js'),
        import('./school-calendar-runtime.js'),
        import('./team-calendar-runtime.js'),
        import('./activities-approved-ui-fix.js?v=20260802-v1'),
        import('./activity-2026-season-query-hotfix.js?v=20260730-restore-2026-summer-v1'),
        import('./month-navigation-runtime.js'),
        import('./activities-tabs-corrections.js'),
        import('./styles/activity-drawer-inline-layout.css'),
        import('./activity-drawer-inline-layout.js'),
        import('./styles/activity-drawer-type-layout-fix.css'),
        import('./activity-drawer-type-layout-fix.js'),
        import('./styles/activity-drawer-edit-header-polish.css'),
        import('./styles/activity-drawer-floating-actions.css'),
        import('./activity-drawer-edit-dedup.js'),
        import('./activity-drawer-floating-actions.js?v=20260731-floating-overlay-v3')
      ]));

    case 'endDates':
      return loadOnce('endDates', () => import('./end-dates-live-fix.js?v=20260802-v1'));

    case 'operations':
      return loadOnce('operations', () => Promise.all([
        // Wait for Supabase auth and retry empty lists catalog on direct
        // operations-management entry (2027 workshop inventory) without visiting admin-lists first.
        import('./admin-lists-auth-hotfix.js'),
        import('./screens/operations-summer-training-matrix.js?v=20260805-operations-2027-loading-controller-v1'),
        import('./screens/operations-authorities-cleanup.js?v=20260805-operations-2027-loading-controller-v1'),
        import('./screens/operations-visual-tweaks.js?v=20260720-operations-toolbar-compact-v1'),
        import('./screens/operations-completion-toolbar-compact.js?v=20260720-single-row-v1'),
        import('./screens/operations-inventory-polish.js?v=20260720-proposal-pdf-tainted-canvas-v1'),
        import('./operations-2027-date-range-fix.js?v=20260802-v1')
      ]));

    case 'admin':
      return loadOnce('admin', () => Promise.all([
        import('./admin-lists-auth-hotfix.js'),
        import('./admin-permissions-access-hotfix.js'),
        import('./school-catalog-bootstrap-hotfix.js?v=20260730-full-school-catalog-v1')
      ]));

    default:
      return Promise.resolve();
  }
}

export function ensureFeaturesForRoute(route) {
  const features = FEATURE_ROUTE_MAP[String(route || '')] || [];
  return Promise.all(features.map((feature) => ensureFeature(feature)));
}

export function preloadScreenModule(route) {
  const key = String(route || '');
  if (!key) return Promise.resolve();
  return loadOnce(`screen-module:${key}`, () => {
    switch (key) {
      case 'dashboard':
        return import('./screens/dashboard.js');
      case 'activities':
        return import('./screens/activities.js');
      case 'week':
        return import('./screens/week.js');
      case 'month':
        return import('./screens/month.js');
      case 'exceptions':
        return import('./screens/exceptions.js');
      case 'instructors':
        return import('./screens/instructors.js?v=20260809-guides-list-assignment-filter-fix-v2');
      case 'archive':
        return import('./screens/archive.js');
      case 'edit-requests':
        return import('./screens/edit-requests.js');
      case 'end-dates':
        return Promise.all([
          ensureFeature('endDates'),
          import('./screens/end-dates.js')
        ]);
      case 'proposals-agreements':
        return Promise.all([
          ensureFeature('proposals'),
          import('./screens/proposals-agreements.js')
        ]);
      case 'operations-management':
        return Promise.all([
          ensureFeature('operations'),
          import('./screens/operations-management.js')
        ]);
      case 'invitations':
        return import('./screens/invitations.js');
      case 'catalog':
        return import('./screens/catalog.js');
      case 'finance':
        return import('./screens/finance.js');
      case 'israa-management':
        return Promise.all([
          ensureFeature('israa'),
          import('./screens/israa-management.js')
        ]);
      case 'personal-reports':
        return Promise.all([
          ensureFeature('annualReviews'),
          import('./screens/personal-reports.js')
        ]);
      default:
        return Promise.resolve();
    }
  });
}
