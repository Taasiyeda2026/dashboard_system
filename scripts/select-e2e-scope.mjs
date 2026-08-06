import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_SCREEN_KEYS = [
  'dashboard',
  'activities',
  'week',
  'month',
  'proposals-agreements',
  'operations-management',
  'instructors',
  'contacts'
];

const NON_RUNTIME_PATTERNS = [
  /^readme(?:\..*)?$/i,
  /^docs\//,
  /^attached_assets\//,
  /^artifacts\//,
  /^prototypes\//,
  /^dist\//,
  /^\.github\/issue_template\//,
  /(^|\/)license(?:\..*)?$/i,
  /\.md$/i
];

const FULL_IMPACT_PATTERNS = [
  /^\.github\/workflows\//,
  /^e2e\//,
  /^tests\//,
  /^scripts\//,
  /^supabase\//,
  /^package(?:-lock)?\.json$/,
  /^vite\.config\./,
  /^index\.html$/,
  /^frontend\/sw\.js$/,
  /^sw\.js$/,
  /^frontend\/src\/(main|api|supabase-client|state|config|permissions|feature-loaders)\.js$/,
  /^frontend\/src\/screens\/shared\//,
  /^frontend\/src\/styles\//
];

const SCREEN_RULES = [
  {
    pattern: /dashboard/,
    screens: ['dashboard']
  },
  {
    pattern: /activities|activity-/,
    screens: ['activities', 'week', 'month']
  },
  {
    pattern: /(^|\/)week(?:[./_-]|$)/,
    screens: ['week']
  },
  {
    pattern: /(^|\/)month(?:[./_-]|$)|calendar/,
    screens: ['week', 'month']
  },
  {
    pattern: /proposal|proposals|agreement|client-file|gefen/,
    screens: ['proposals-agreements']
  },
  {
    pattern: /operations?/,
    screens: ['operations-management']
  },
  {
    pattern: /instructor/,
    screens: ['instructors']
  },
  {
    pattern: /contact/,
    screens: ['contacts']
  }
];

function normalizeFiles(files) {
  return [...new Set(files.map((file) => String(file || '').trim().replaceAll('\\', '/')).filter(Boolean))];
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

export function isNonRuntimeFile(file) {
  return matchesAny(file.toLowerCase(), NON_RUNTIME_PATTERNS);
}

function matchedScreensForFile(file) {
  const screens = new Set();
  const normalized = file.toLowerCase();

  for (const rule of SCREEN_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    for (const screen of rule.screens) screens.add(screen);
  }

  return screens;
}

function orderScreens(screens) {
  return CORE_SCREEN_KEYS.filter((screen) => screens.has(screen));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGrep(screenKeys) {
  const terms = ['authenticate test user', 'Authentication', ...screenKeys];
  if (screenKeys.includes('proposals-agreements')) terms.push('Client file');
  return terms.map(escapeRegex).join('|');
}

export function classifyE2EScope(files, { forceFull = false } = {}) {
  const changedFiles = normalizeFiles(files);

  if (changedFiles.length === 0) {
    return {
      mode: 'full',
      screens: CORE_SCREEN_KEYS,
      grep: '',
      reason: forceFull ? 'manual full run requested' : 'no changed-file list was available',
      changedFiles
    };
  }

  if (changedFiles.every(isNonRuntimeFile)) {
    return {
      mode: 'docs',
      screens: [],
      grep: '',
      reason: 'documentation or non-runtime files only',
      changedFiles
    };
  }

  if (forceFull) {
    return {
      mode: 'full',
      screens: CORE_SCREEN_KEYS,
      grep: '',
      reason: 'full PR checkpoint requested',
      changedFiles
    };
  }

  const screens = new Set();
  let fullReason = '';

  for (const file of changedFiles) {
    const normalized = file.toLowerCase();
    if (isNonRuntimeFile(normalized)) continue;

    if (matchesAny(normalized, FULL_IMPACT_PATTERNS)) {
      fullReason = `shared, infrastructure or test file changed: ${file}`;
      break;
    }

    if (normalized.startsWith('frontend/src/')) {
      const matched = matchedScreensForFile(normalized);
      if (matched.size === 0) {
        fullReason = `unmapped live frontend file changed: ${file}`;
        break;
      }
      for (const screen of matched) screens.add(screen);
      continue;
    }

    if (normalized.startsWith('frontend/public/') || normalized.startsWith('frontend/assets/')) {
      fullReason = `runtime asset changed: ${file}`;
      break;
    }

    fullReason = `unclassified runtime file changed: ${file}`;
    break;
  }

  if (fullReason) {
    return {
      mode: 'full',
      screens: CORE_SCREEN_KEYS,
      grep: '',
      reason: fullReason,
      changedFiles
    };
  }

  const orderedScreens = orderScreens(screens);

  if (orderedScreens.length === 0) {
    return {
      mode: 'full',
      screens: CORE_SCREEN_KEYS,
      grep: '',
      reason: 'runtime changes did not map to a covered screen',
      changedFiles
    };
  }

  return {
    mode: 'targeted',
    screens: orderedScreens,
    grep: buildGrep(orderedScreens),
    reason: `mapped runtime files: ${orderedScreens.join(', ')}`,
    changedFiles
  };
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const entries = {
    mode: result.mode,
    screens: result.screens.join(','),
    grep: result.grep,
    reason: result.reason
  };

  for (const [key, value] of Object.entries(entries)) {
    fs.appendFileSync(outputPath, `${key}<<__E2E_SCOPE__\n${value}\n__E2E_SCOPE__\n`);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const input = fs.readFileSync(0, 'utf8');
  const files = input.split(/\r?\n/);
  const result = classifyE2EScope(files, {
    forceFull: parseBoolean(process.env.FORCE_FULL)
  });

  console.log(`[e2e-scope] mode=${result.mode}`);
  console.log(`[e2e-scope] screens=${result.screens.join(',') || 'none'}`);
  console.log(`[e2e-scope] reason=${result.reason}`);
  writeGithubOutput(result);
}
