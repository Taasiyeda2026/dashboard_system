import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const PROJECT = 'szinlhjuwyiyszdpsdop';
const SITE = 'https://taasiyeda2026.github.io/dashboard_system';
const CONSENT = '/scheduling-agent-approval.html';

function sectionLines(source, name) {
  let inSection = false;
  const result = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      inSection = heading[1] === name;
      continue;
    }
    if (inSection && line && !line.startsWith('#')) result.push(line);
  }
  return result;
}

function rawValue(lines, key) {
  for (const line of lines) {
    const pair = /^([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (pair && pair[1] === key) return pair[2];
  }
  return null;
}

function stringValue(lines, key) {
  const value = rawValue(lines, key);
  return value === null ? null : (/^"([^"]+)"(?:\s*#.*)?$/.exec(value)?.[1] ?? null);
}

function arrayValues(lines, key) {
  const index = lines.findIndex(line => line.startsWith(key + ' ') || line.startsWith(key + '='));
  if (index < 0) return [];
  const all = [];
  for (let i = index; i < lines.length; i++) {
    all.push(lines[i]);
    if (lines[i].includes(']')) break;
  }
  return [...all.join(' ').matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

export function validateProductionAuthConfig(source) {
  const problems = [];
  const remote = sectionLines(source, 'remotes.main');
  const auth = sectionLines(source, 'remotes.main.auth');
  const oauth = sectionLines(source, 'remotes.main.auth.oauth_server');
  const globalAuth = sectionLines(source, 'auth');

  if (stringValue(remote, 'project_id') !== PROJECT) {
    problems.push('Production project_ref must remain the approved Supabase project.');
  }
  if (stringValue(auth, 'site_url') !== SITE) {
    problems.push('Production auth.site_url must use the public Taasiyeda dashboard URL, not localhost.');
  }
  if (!arrayValues(auth, 'additional_redirect_urls').includes(SITE)) {
    problems.push('Production redirect allow-list must include the dashboard URL.');
  }
  if (rawValue(oauth, 'enabled') !== 'true' ||
      rawValue(oauth, 'allow_dynamic_registration') !== 'true' ||
      stringValue(oauth, 'authorization_url_path') !== CONSENT) {
    problems.push('The existing scheduling OAuth consent route and enabled server must be preserved.');
  }
  if (globalAuth.some(line => /^site_url\s*=/.test(line))) {
    problems.push('Do not set an unscoped [auth].site_url: keep production URLs in [remotes.main.auth].');
  }
  return problems;
}

export function workflowConfigPushViolations(files) {
  return files.filter(({ path, source }) =>
    /\.ya?ml$/.test(path) &&
    /(?:^|[\s;&])(?:npx\s+)?supabase\s+config\s+push\b/m.test(source));
}

const here = dirname(fileURLToPath(import.meta.url));
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const root = resolve(here, '../..');
  const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
  const problems = validateProductionAuthConfig(config);
  const workflowsDir = join(root, '.github/workflows');
  const workflows = readdirSync(workflowsDir)
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => ({ path: name, source: readFileSync(join(workflowsDir, name), 'utf8') }));
  for (const match of workflowConfigPushViolations(workflows)) {
    problems.push('Remote supabase config push is prohibited in automated workflow: ' + match.path);
  }
  if (problems.length) {
    console.error('Production Supabase Auth guard FAILED:\n' + problems.map(x => '- ' + x).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Production Supabase Auth guard OK (static config/workflow check; not a live Auth test).');
  }
}
