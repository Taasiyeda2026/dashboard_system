import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Explicit, deliberately small suites. Add a test here only when its assertions cover
// the corresponding source area; the full suite is retained separately for regression.
export const TEST_GROUPS = Object.freeze({
  activities: ['tests/activities-screen.test.mjs', 'tests/api-undated-activities.test.mjs'],
  annualReviews: ['tests/annual-reviews-v2.test.mjs', 'tests/annual-reviews-security.test.mjs'],
  auth: ['tests/auth-login-stabilization.test.mjs', 'tests/auth-permissions-routes.test.mjs'],
  catalog: ['tests/catalog-screen-display.test.mjs'],
  clients: ['tests/client-file-unified-screen.test.mjs'],
  dashboard: ['tests/dashboard-stability.test.mjs'],
  db: ['tests/backend-write-flows-guard.test.mjs'],
  editRequests: ['tests/edit-requests-screen.test.mjs'],
  finance: ['tests/finance-screen.test.mjs'],
  instructors: ['tests/instructor-area-screen.test.mjs', 'tests/instructor-scheduling-permissions.test.mjs'],
  operations: ['tests/operations-management-screen.test.mjs'],
  permissions: ['tests/navigation-permissions-routes.test.mjs', 'tests/permissions-role-column-alignment.test.mjs'],
  proposals: ['tests/proposals-agreements-screen.test.mjs', 'tests/proposal-workflow-completion.test.mjs'],
  pwa: ['tests/service-worker-pwa-cache.test.mjs'],
  scheduling: ['tests/course-scheduling-engine.test.mjs', 'tests/course-scheduling-scoring.test.mjs'],
  // This group runs in the conditional Postgres job, not in the dependency-free job.
  schedulingDb: [],
  summerFeedback: ['tests/summer-feedback.test.mjs'],
  calendars: ['tests/calendar-navigation.test.mjs', 'tests/team-calendar-ui.test.mjs']
});

const EXACT_GROUPS = new Map([
  // api.js also contains the Supabase Auth login flow and the role/route
  // permission defaults, so it must select auth + permissions too.
  ['frontend/src/api.js', ['activities', 'auth', 'permissions', 'proposals']],
  ['frontend/src/permissions.js', ['auth', 'permissions']],
  ['frontend/src/supabase-client.js', ['auth', 'db']],
  ['frontend/src/state.js', ['dashboard', 'activities', 'calendars']],
  ['frontend/src/main.js', ['auth', 'permissions']],
  ['frontend/sw.js', ['pwa']],
  ['sw.js', ['pwa']]
]);

const DOMAIN_RULES = [
  [/activities|activity-/, 'activities'], [/annual-reviews/, 'annualReviews'],
  // Negative lookahead keeps 'authorities'/'authority' (school authorities catalog,
  // an operations concern) from being misread as the auth domain.
  [/auth(?!orit)|login|session-security/, 'auth'], [/catalog/, 'catalog'], [/client-|contacts/, 'clients'],
  [/dashboard/, 'dashboard'], [/edit-requests/, 'editRequests'], [/finance/, 'finance'],
  [/instructor/, 'instructors'], [/operations/, 'operations'], [/permission/, 'permissions'],
  [/proposal|gefen/, 'proposals'], [/course-scheduling|school-2027/, 'scheduling'],
  [/summer-feedback/, 'summerFeedback'], [/calendar|\/(week|month)\./, 'calendars']
];

const DOC_RE = /^(docs\/|.*\.md$|\.github\/deploy-trigger\.txt$)/;
const BUILD_RE = /^(frontend\/|index\.html$|vite\.config\.js$|package(?:-lock)?\.json$|scripts\/postbuild-dist\.mjs$)/;
const JS_RE = /\.(?:js|mjs|cjs)$/;

// A changed JS file selects no test group when every added/removed line is
// blank, a comment, or an import statement/dynamic import() — i.e. the diff
// cannot change runtime behavior (e.g. bumping a `?v=` cache-busting suffix).
const NON_SUBSTANTIVE_DIFF_LINE_RE = /^\s*$|^\s*\/\/|^\s*import\b/;

export function isImportOnlyDiff(diffText) {
  let sawChange = false;
  for (const line of (diffText || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const marker = line[0];
    if (marker !== '+' && marker !== '-') continue;
    sawChange = true;
    if (!NON_SUBSTANTIVE_DIFF_LINE_RE.test(line.slice(1))) return false;
  }
  return sawChange;
}

// Only meaningful with explicit base/head commits (the Quick PR Check range);
// with no range there is no diff to inspect, so nothing is treated as import-only
// and the existing (safe, broader) mapping applies unchanged.
export function collectImportOnlyFiles({ repoRoot = process.cwd(), base, head, files = [] } = {}) {
  const baseRef = base || process.env.CI_BASE_SHA;
  const headRef = head || process.env.CI_HEAD_SHA;
  if (!baseRef || !headRef) return new Set();
  const result = new Set();
  for (const file of files) {
    if (!JS_RE.test(file)) continue;
    try {
      const diffText = execFileSync('git', ['diff', '-U0', '--no-color', baseRef, headRef, '--', file], {
        cwd: repoRoot, encoding: 'utf8'
      });
      if (isImportOnlyDiff(diffText)) result.add(file);
    } catch {
      // Any git failure leaves the file out of the set, i.e. falls back to the full mapping.
    }
  }
  return result;
}

export function buildCheckPlan(files, { importOnlyFiles = new Set() } = {}) {
  const normalized = [...new Set(files.map((file) => file.replaceAll(path.sep, '/')))];
  const groups = new Set();
  let postgres = false;

  for (const file of normalized) {
    if (!importOnlyFiles.has(file)) {
      for (const group of EXACT_GROUPS.get(file) || []) groups.add(group);
      if (file.startsWith('frontend/src/') && JS_RE.test(file)) {
        for (const [pattern, group] of DOMAIN_RULES) if (pattern.test(file)) groups.add(group);
      }
    }
    if (/^supabase\/(?:migrations|functions)\//.test(file) || /\.sql$/.test(file)) {
      groups.add('db');
      if (/schedul|instructor.*assign|proposed_dates/.test(file)) {
        groups.add('scheduling');
        groups.add('schedulingDb');
        postgres = true;
      }
    }
  }

  const orderedGroups = [...groups].sort();
  return {
    files: normalized,
    groups: orderedGroups,
    syntaxFiles: normalized.filter((file) => JS_RE.test(file)),
    tests: [...new Set(orderedGroups.flatMap((group) => TEST_GROUPS[group]))],
    build: normalized.some((file) => BUILD_RE.test(file) && !DOC_RE.test(file)),
    postgres
  };
}

export function collectChangedFiles({ repoRoot = process.cwd(), base, head } = {}) {
  const baseRef = base || process.env.CI_BASE_SHA;
  const headRef = head || process.env.CI_HEAD_SHA;
  if (baseRef && headRef) {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef, headRef], {
      cwd: repoRoot, encoding: 'utf8'
    }).trim().split(/\r?\n/).filter(Boolean);
  }
  return execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
}
