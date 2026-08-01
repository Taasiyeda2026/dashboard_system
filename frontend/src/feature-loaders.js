/**
 * One-shot feature loaders.
 * Heavy screen modules (PDF, annual reviews, Israa, activity drawers, operations)
 * stay out of the initial bootstrap and load only when their route/feature is used.
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

function importAll(paths) {
  return Promise.all(paths.map((path) => import(path)));
}

export const FEATURE_ROUTE_MAP = {
  dashboard: ['dashboard'],
  activities: ['activityDrawer'],
  week: ['activityDrawer'],
  month: ['activityDrawer'],
  archive: ['activityDrawer'],
  exceptions: ['activityDrawer'],
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
      return loadOnce('dashboard', () => importAll([
        './dashboard-kpi-corrections.js?v=20260801-perf-startup-v1',
        './dashboard-exception-count-hotfix.js?v=20260728-unique-exception-activities-v2',
        './dashboard-month-navigation-runtime.js',
        './birthday-popup.js',
        './birthday-popup-session-guard.js',
        './birthday-calendar.js'
      ]));

    case 'proposals':
      return loadOnce('proposals', () => importAll([
        './styles/proposal-editor-compact-fixes.css?v=20260801-v6',
        './proposal-pdf-svg-origin-clean.js',
        './proposal-pdf-storage-key-hotfix.js',
        './proposal-pdf-download-filename-hotfix.js',
        './proposal-pdf-single-generation-hotfix.js',
        './proposal-pdf-school-filename-runtime.js?v=20260730-school-code-name-v1',
        './proposal-incomplete-print-runtime.js?v=20260729-preview-freeze-v2',
        './proposal-next-year-pricing-display.js?v=20260729-next-year-pricing-v1',
        './proposal-next-year-table-alignment.js?v=20260729-next-year-compact-tables-v1',
        './proposal-next-year-workshops.js?v=20260801-next-year-workshops-editor-deps-v1',
        './proposal-next-year-space-workshop-pricing.js?v=20260801-space-workshop-editor-deps-v1',
        './proposal-approval-runtime.js',
        './client-contact-persistence-hotfix.js',
        './school-catalog-bootstrap-hotfix.js?v=20260730-full-school-catalog-v1',
        './school-calendar-runtime.js',
        './gefen-proposal-layout-update.js',
        './gefen-proposal-pdf-header-alignment.js',
        './proposal-full-clone-runtime.js?v=20260729-independent-clone-v2',
        './proposal-summer-creation-retired.js?v=20260731-retire-summer-v1',
        './proposal-activity-linking.js',
        './proposal-domain-routing.js',
        './proposal-editor-compact-fixes.js?v=20260801-v6',
        './screens/client-file-layout-polish.js?v=20260721-client-file-layout-v2',
        './proposal-details-public-cleanup.js?v=20260801-perf-startup-v1'
      ]));

    case 'annualReviews':
      return loadOnce('annualReviews', () => importAll([
        './screens/annual-reviews-v2.js',
        './annual-reviews-language-safe.js?v=20260730-final-pdf-upload-v1',
        './annual-reviews-rating-comment-compact.js',
        './annual-reviews-safe-extension-styles.js',
        './annual-reviews-next-school-year-safe.js',
        './annual-reviews-role-lessons-safe.js',
        './annual-reviews-ui-compact-feedback.js',
        './annual-reviews-print-plain.js',
        './annual-reviews-print-shell-fix.js?v=20260730-blank-print-v1',
        './annual-reviews-manager-question-set.js',
        './annual-reviews-manager-dedup.js?v=20260730-manager-dedup-v1',
        './annual-reviews-readable-print.js?v=20260730-readable-print-v5',
        './annual-reviews-isolated-print.js?v=20260730-compact-print-v4',
        './annual-reviews-final-pdf-safe.js'
      ]));

    case 'israa':
      return loadOnce('israa', () => importAll([
        './israa-tracking-v2-runtime.js?v=20260730-israa-program-menu-visible-v1',
        './israa-tracking-filters-runtime.js?v=20260730-israa-toolbar-filters-v6',
        './israa-tracking-hierarchy-runtime.js?v=20260730-israa-toolbar-filters-v6'
      ]));

    case 'activityDrawer':
      return loadOnce('activityDrawer', () => importAll([
        './activity-2026-season-query-hotfix.js?v=20260730-restore-2026-summer-v1',
        './month-navigation-runtime.js',
        './activities-tabs-corrections.js',
        './styles/activity-drawer-inline-layout.css',
        './activity-drawer-inline-layout.js',
        './styles/activity-drawer-type-layout-fix.css',
        './activity-drawer-type-layout-fix.js',
        './styles/activity-drawer-edit-header-polish.css',
        './styles/activity-drawer-floating-actions.css?v=20260731-floating-overlay-v3',
        './activity-drawer-edit-dedup.js',
        './activity-drawer-floating-actions.js?v=20260731-floating-overlay-v3'
      ]));

    case 'operations':
      return loadOnce('operations', () => importAll([
        './screens/operations-summer-training-matrix.js?v=20260720-proposal-pdf-tainted-canvas-v1',
        './screens/operations-authorities-cleanup.js?v=20260720-proposal-pdf-tainted-canvas-v1',
        './screens/operations-visual-tweaks.js?v=20260720-operations-toolbar-compact-v1',
        './screens/operations-completion-toolbar-compact.js?v=20260720-single-row-v1',
        './screens/operations-inventory-polish.js?v=20260720-proposal-pdf-tainted-canvas-v1'
      ]));

    case 'admin':
      return loadOnce('admin', () => importAll([
        './admin-lists-auth-hotfix.js',
        './admin-permissions-access-hotfix.js',
        './school-catalog-bootstrap-hotfix.js?v=20260730-full-school-catalog-v1'
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
        return import('./screens/instructors.js?v=20260730-instructor-matching-modal-v1');
      case 'archive':
        return import('./screens/archive.js');
      case 'edit-requests':
        return import('./screens/edit-requests.js');
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
