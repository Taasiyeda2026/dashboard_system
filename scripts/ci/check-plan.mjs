import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Explicit, deliberately small suites. Add a test here only when its assertions cover
// the corresponding source area; the full suite is retained separately for regression.
export const TEST_GROUPS = Object.freeze({
  activities: [
    'tests/activities-screen.test.mjs',
    'tests/api-undated-activities.test.mjs',
    'tests/activity-drawer-type-layout-fix.test.mjs'
  ],
  annualReviews: ['tests/annual-reviews-v2.test.mjs', 'tests/annual-reviews-security.test.mjs'],
  auth: ['tests/auth-login-stabilization.test.mjs', 'tests/auth-permissions-routes.test.mjs'],
  catalog: ['tests/catalog-screen-display.test.mjs'],
  clients: ['tests/client-file-unified-screen.test.mjs'],
  dashboard: ['tests/dashboard-stability.test.mjs'],
  db: ['tests/backend-write-flows-guard.test.mjs'],
  editRequests: ['tests/edit-requests-screen.test.mjs'],
  finance: ['tests/finance-screen.test.mjs'],
  // instructor-area-screen is a legacy mixed-domain suite with known base failures;
  // Quick PR runs the maintained workspace/permission contracts instead.
  instructors: [
    'tests/instructors-unified-workspace.test.mjs',
    'tests/instructor-scheduling-permissions.test.mjs',
    'tests/instructor-employee-files.test.mjs'
  ],
  operations: ['tests/operations-management-screen.test.mjs', 'tests/operations-lazy-loading.test.mjs'],
  permissions: ['tests/navigation-permissions-routes.test.mjs', 'tests/permissions-role-column-alignment.test.mjs'],
  proposals: ['tests/proposal-submission-regression.test.mjs', 'tests/proposal-workflow-completion.test.mjs'],
  pwa: ['tests/service-worker-pwa-cache.test.mjs'],
  scheduling: [
    'tests/course-scheduling-engine.test.mjs',
    'tests/course-scheduling-scoring.test.mjs',
    'tests/course-scheduling-stage2-matching.test.mjs',
    'tests/course-scheduling-stage2-server-sync.test.mjs'
  ],
  // This group runs in the conditional Postgres job, not in the dependency-free job.
  schedulingDb: [],
  summerFeedback: ['tests/summer-feedback.test.mjs'],
  calendars: ['tests/calendar-navigation.test.mjs', 'tests/team-calendar-ui.test.mjs']
});

const EXACT_GROUPS = new Map([
  ['frontend/src/permissions.js', ['auth', 'permissions']],
  ['frontend/src/supabase-client.js', ['auth', 'db']],
  ['frontend/src/state.js', ['dashboard', 'activities', 'calendars']],
  ['frontend/src/screens/instructor-matching-engine.js', ['scheduling']],
  ['frontend/sw.js', ['pwa']],
  ['sw.js', ['pwa']]
]);

// main.js mixes real auth/permission routing with the per-screen cache-busting
// `?v=` query strings bumped on nearly every frontend change. Only the former
// needs the auth/permissions suites; a diff limited to loader version strings does not.
const MAIN_JS_AUTH_GROUPS = ['auth', 'permissions'];
const SCREEN_LOADER_LINE_RE = /import\(['"]\.\/screens\/[\w.-]+\.js(?:\?v=[\w-]+)?['"]\)/;
const VERSION_QUERY_RE = /\?v=[\w-]+/g;

const API_GROUP_RULES = [
  [/(?:addActivity|saveActivity|updateActivity|deleteActivity|activityDetail|scheduleFilterOptions|\.from\(['"]activities['"]\)|activities_(?:read|write|insert|update|delete))/i, ['activities']],
  [/(?:loadProposal|saveProposal|readProposal|getProposal|buildProposal|normalizeProposal|upsertProposal|proposalRow|proposalItem|proposalAgreement|proposalWorkflow|proposalPdf|proposalTemplate)/i, ['proposals']],
  [/(?:\brole\b|display_role|permissions?|default_view|edit-requests|can_request_edit|view_edit_requests)/i, ['permissions']],
  [/(?:auth(?!orit)|login|session|signIn|user[ _]?projection)/i, ['auth', 'permissions']]
];
const ALL_API_GROUPS = ['activities', 'auth', 'permissions', 'proposals'];

function getApiGroups(diffText) {
  if (!diffText) return ALL_API_GROUPS;
  const changedLines = diffText.split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
    .map((line) => line.slice(1))
    .join('\n');
  if (!changedLines) return ALL_API_GROUPS;
  const groups = new Set();
  for (const [pattern, matches] of API_GROUP_RULES) {
    if (pattern.test(changedLines)) for (const group of matches) groups.add(group);
  }
  return groups.size ? [...groups] : ALL_API_GROUPS;
}

function isCosmeticScreenLoaderDiff(diffText) {
  if (!diffText) return false;
  const removed = [];
  const added = [];
  for (const line of diffText.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  if (!removed.length && !added.length) return false;
  const allLoaderLines = [...removed, ...added].every((line) => SCREEN_LOADER_LINE_RE.test(line));
  if (!allLoaderLines) return false;
  const normalize = (lines) => lines.map((line) => line.replace(VERSION_QUERY_RE, '?v=')).sort();
  const normalizedRemoved = normalize(removed);
  const normalizedAdded = normalize(added);
  return normalizedRemoved.length === normalizedAdded.length
    && normalizedRemoved.every((line, index) => line === normalizedAdded[index]);
}

export function getFileDiff(file, { repoRoot = process.cwd(), base, head } = {}) {
  try {
    if (base && head) {
      return execFileSync('git', ['diff', '--unified=0', base, head, '--', file], { cwd: repoRoot, encoding: 'utf8' });
    }
    const working = execFileSync('git', ['diff', '--unified=0', 'HEAD', '--', file], { cwd: repoRoot, encoding: 'utf8' });
    return working;
  } catch {
    return null;
  }
}

const DOMAIN_RULES = [
  [/activities|activity-/, 'activities'], [/annual-reviews/, 'annualReviews'],
  // Do not read school authority/authorities filenames as the auth domain.
  [/auth(?!orit)|login|session-security/, 'auth'], [/catalog/, 'catalog'], [/client-|contacts/, 'clients'],
  [/dashboard/, 'dashboard'], [/edit-requests/, 'editRequests'], [/finance/, 'finance'],
  [/instructor/, 'instructors'], [/operations/, 'operations'], [/permission/, 'permissions'],
  [/proposal|gefen/, 'proposals'], [/course-scheduling|school-2027/, 'scheduling'],
  [/summer-feedback/, 'summerFeedback'], [/calendar|\/(week|month)\./, 'calendars']
];

const DOC_RE = /^(docs\/|.*\.md$|\.github\/deploy-trigger\.txt$)/;
const BUILD_RE = /^(frontend\/|index\.html$|vite\.config\.js$|package(?:-lock)?\.json$|scripts\/postbuild-dist\.mjs$)/;
const JS_RE = /\.(?:js|mjs|cjs)$/;

export function buildCheckPlan(files, diffContext = {}) {
  const { repoRoot = process.cwd(), base, head, getDiff } = diffContext;
  const hasDiffSource = typeof getDiff === 'function' || Boolean(base && head);
  const resolveDiff = (file) => (typeof getDiff === 'function' ? getDiff(file) : getFileDiff(file, { repoRoot, base, head }));

  const normalized = [...new Set(files.map((file) => file.replaceAll(path.sep, '/')))];
  const groups = new Set();
  let postgres = false;

  for (const file of normalized) {
    const exactGroups = EXACT_GROUPS.get(file) || [];
    for (const group of exactGroups) groups.add(group);
    if (file === 'frontend/src/api.js') {
      const diff = hasDiffSource ? resolveDiff(file) : null;
      for (const group of getApiGroups(diff)) groups.add(group);
    }
    if (file === 'frontend/src/main.js') {
      const diff = hasDiffSource ? resolveDiff(file) : null;
      if (!isCosmeticScreenLoaderDiff(diff)) for (const group of MAIN_JS_AUTH_GROUPS) groups.add(group);
    }
    // CSS and other non-JS frontend assets are build-validated, but should not
    // select business suites merely because their filename contains a domain word.
    // Exact mappings are authoritative for ambiguous cross-domain modules such as
    // instructor-matching-engine.js, whose behavior belongs to scheduling, not instructor UI.
    if (file.startsWith('frontend/src/') && JS_RE.test(file) && !exactGroups.length) {
      for (const [pattern, group] of DOMAIN_RULES) if (pattern.test(file)) groups.add(group);
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
