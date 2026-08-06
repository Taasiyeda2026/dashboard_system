import fs from 'node:fs';
import path from 'node:path';
import { NETWORK_LOG_DIR, CONSOLE_LOG_DIR } from './env.mjs';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    url.hash = '';
    // Drop volatile supabase prefer/range noise from identity for duplicate detection carefully:
    // keep path + method + sorted search params that define the query.
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(rawUrl || '');
  }
}

function resourceKind(url, resourceType) {
  const lower = String(url || '').toLowerCase();
  if (resourceType === 'script' || lower.endsWith('.js') || lower.includes('.js?')) return 'js';
  if (resourceType === 'stylesheet' || lower.endsWith('.css') || lower.includes('.css?')) return 'css';
  if (lower.includes('supabase.co') || lower.includes('/rest/v1/') || lower.includes('/auth/v1/') || lower.includes('/rpc/')) {
    return 'api';
  }
  if (resourceType === 'xhr' || resourceType === 'fetch') return 'api';
  return resourceType || 'other';
}

function isSupabase(url = '') {
  return /supabase\.co|\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\//i.test(url);
}

function supabaseIdentity(method, url) {
  try {
    const parsed = new URL(url);
    // Prefer header-less identity: method + path + filtered query (ignore apikey noise in query).
    const params = new URLSearchParams(parsed.search);
    params.delete('apikey');
    const keys = [...params.keys()].sort();
    const stable = keys.map((k) => `${k}=${params.get(k)}`).join('&');
    return `${method.toUpperCase()} ${parsed.origin}${parsed.pathname}?${stable}`;
  } catch {
    return `${method} ${normalizeUrl(url)}`;
  }
}

function restTableName(url = '') {
  try {
    const parsed = new URL(url, 'http://localhost');
    const marker = '/rest/v1/';
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return '';
    return decodeURIComponent(parsed.pathname.slice(index + marker.length)).split('/')[0] || '';
  } catch {
    return '';
  }
}

function pathEndsWithPdf(url = '') {
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return /\.pdf(?:$|[?#])/i.test(String(url || ''));
  }
}

function selectListIncludesColumn(url = '', column = '') {
  try {
    const select = new URL(url, 'http://localhost').searchParams.get('select') || '';
    return new RegExp(`(?:^|,)${column}(?:$|,)`, 'i').test(select);
  } catch {
    return false;
  }
}

function activitySeasonFilterValue(url = '') {
  try {
    return new URL(url, 'http://localhost').searchParams.get('activity_season') || '';
  } catch {
    return '';
  }
}

function looksLikePdfOrSnapshot(url = '', contentType = '') {
  const lower = String(url || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/pdf')) return true;
  if (pathEndsWithPdf(url)) return true;
  // Heavy proposal payloads only when those columns are actually selected.
  if (selectListIncludesColumn(url, 'document_snapshot') || selectListIncludesColumn(url, 'document_html_snapshot')) {
    return true;
  }
  // Real Storage object fetch — not metadata fields like final_pdf_path / final_pdf_file_name.
  if (lower.includes('/storage/v1/object/') && (pathEndsWithPdf(url) || lower.includes('.pdf') || /\/proposal/i.test(lower))) {
    return true;
  }
  return false;
}

function looksLikeFullContactsDirectory(url = '') {
  const table = restTableName(url);
  // Exact pathname tables only — never substring-match contacts_instructors as contacts.
  return table === 'contacts_schools' || table === 'contacts_unified_view' || table === 'contacts_full';
}

function looksLikeFullCatalog(url = '') {
  const table = restTableName(url);
  return (
    table === 'proposal_activity_pricing' ||
    table === 'catalog_workshops' ||
    table === 'next_year_workshops' ||
    table === 'proposal_activity_groups'
  );
}

function extractRangeCount(headers = {}) {
  const contentRange = headers['content-range'] || headers['Content-Range'] || '';
  const match = String(contentRange).match(/(\d+)-(\d+)\/(\d+|\*)/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start + 1;
}

function extractRequestedRange(headers = {}) {
  const range = headers.range || headers.Range || '';
  const match = String(range).match(/bytes=(\d+)-(\d+)/i);
  // Supabase uses Prefer / Range header differently — also check request header "Range: 0-49"
  if (match) {
    return { start: Number(match[1]), end: Number(match[2]) };
  }
  return null;
}

/**
 * Attaches console + network observers to a Playwright page.
 */
export function attachNetworkTracker(page, { screen = 'unknown' } = {}) {
  const state = {
    screen,
    startedAt: Date.now(),
    consoleErrors: [],
    pageErrors: [],
    requests: [],
    failedRequests: [],
    supabaseIdentities: new Map(),
    duplicateSupabase: [],
    jsCssApiErrors: [],
    missingCss: [],
    heavyClientFileLoads: [],
    periodLeakCandidates: [],
    proposalsDirectoryLoads: [],
    bytesByKind: { js: 0, css: 0, other: 0 }
  };

  const onConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Ignore benign browser / extension / SW noise
    if (/favicon\.ico|Download the React DevTools|net::ERR_ABORTED|ResizeObserver loop/i.test(text)) return;
    state.consoleErrors.push({ text, location: msg.location(), at: Date.now() });
  };

  const onPageError = (err) => {
    state.pageErrors.push({ message: String(err?.message || err), at: Date.now() });
  };

  const onRequest = (request) => {
    const url = request.url();
    const method = request.method();
    const kind = resourceKind(url, request.resourceType());
    const entry = {
      id: `${method}:${url}:${Date.now()}:${Math.random()}`,
      method,
      url,
      kind,
      resourceType: request.resourceType(),
      start: Date.now(),
      headers: request.headers()
    };
    state.requests.push(entry);

    if (isSupabase(url) && method.toUpperCase() === 'GET' && !/\/auth\/v1\//i.test(url)) {
      const identity = supabaseIdentity(method, url);
      const prev = state.supabaseIdentities.get(identity) || 0;
      state.supabaseIdentities.set(identity, prev + 1);
      // Flag true duplicate storms (3+ identical GETs), not a single legitimate refetch.
      if (prev + 1 >= 3) {
        state.duplicateSupabase.push({ identity, count: prev + 1, url });
      }
      if (url.includes('proposals_agreements_directory_view')) {
        const rangeHeader = request.headers()['range'] || request.headers()['Range'] || '';
        // PostgREST may use Range: 0-49, while supabase-js often uses offset/limit query params.
        const rangeMatch = String(rangeHeader).match(/(\d+)-(\d+)/);
        let offset = 0;
        let end = null;
        let limit = null;
        if (rangeMatch) {
          offset = Number(rangeMatch[1]);
          end = Number(rangeMatch[2]);
          limit = end - offset + 1;
        } else {
          try {
            const parsed = new URL(url);
            const offsetParam = parsed.searchParams.get('offset');
            const limitParam = parsed.searchParams.get('limit');
            if (offsetParam != null && offsetParam !== '') offset = Number(offsetParam) || 0;
            if (limitParam != null && limitParam !== '') {
              limit = Number(limitParam) || null;
              if (limit != null) end = offset + limit - 1;
            }
          } catch {
            /* ignore */
          }
        }
        state.proposalsDirectoryLoads.push({
          url,
          method,
          offset,
          end,
          limit,
          rangeHeader,
          at: Date.now(),
          search: (() => {
            try {
              return new URL(url).searchParams.get('or') || new URL(url).searchParams.get('school_framework') || '';
            } catch {
              return '';
            }
          })()
        });
      }
    }
  };

  const onResponse = async (response) => {
    const request = response.request();
    const url = response.url();
    const status = response.status();
    const kind = resourceKind(url, request.resourceType());
    const headers = response.headers();
    const entry = state.requests.find((r) => r.url === request.url() && r.method === request.method() && !r.status);
    const size = Number(headers['content-length'] || 0) || 0;
    if (entry) {
      entry.status = status;
      entry.end = Date.now();
      entry.durationMs = entry.end - entry.start;
      entry.contentType = headers['content-type'] || '';
      entry.size = size;
      entry.contentRange = headers['content-range'] || '';
    }
    if (kind === 'js') state.bytesByKind.js += size;
    if (kind === 'css') state.bytesByKind.css += size;

    let responseBody = '';
    if (status >= 400 && kind === 'api') {
      try {
        responseBody = String(await response.text()).slice(0, 2000);
      } catch {
        responseBody = '';
      }
    }
    if (status >= 400 && (kind === 'js' || kind === 'css' || kind === 'api')) {
      state.jsCssApiErrors.push({
        url,
        status,
        kind,
        method: request.method(),
        body: responseBody || undefined
      });
      if (entry) entry.responseBody = responseBody || undefined;
    }
    if (kind === 'css' && (status === 404 || status >= 400)) {
      state.missingCss.push({ url, status });
    }
    if (looksLikePdfOrSnapshot(url, headers['content-type'] || '')) {
      state.heavyClientFileLoads.push({ type: 'pdf_or_snapshot', url, status });
    }
    if (looksLikeFullContactsDirectory(url)) {
      state.heavyClientFileLoads.push({ type: 'full_contacts', url, status });
    }
    if (looksLikeFullCatalog(url)) {
      state.heavyClientFileLoads.push({ type: 'full_catalog', url, status });
    }

    // Cross-period leak heuristic: while working in 2027, requests filtering regular/2026 season.
    // The 2026 period is queried as a season list, so both eq. and in.(...) forms count.
    if (isSupabase(url) && /activity_season/i.test(url)) {
      if (/(?:^|[^a-z_])(?:regular|summer_2026)(?:[^a-z_0-9]|$)/i.test(activitySeasonFilterValue(url))) {
        state.periodLeakCandidates.push({ url, note: '2026-season filter observed' });
      }
    }
  };

  const onRequestFailed = (request) => {
    state.failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'failed'
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    state,
    resetScreen(nextScreen) {
      state.screen = nextScreen;
      state.startedAt = Date.now();
      state.consoleErrors = [];
      state.pageErrors = [];
      state.requests = [];
      state.failedRequests = [];
      state.supabaseIdentities = new Map();
      state.duplicateSupabase = [];
      state.jsCssApiErrors = [];
      state.missingCss = [];
      state.heavyClientFileLoads = [];
      state.periodLeakCandidates = [];
      state.proposalsDirectoryLoads = [];
      state.bytesByKind = { js: 0, css: 0, other: 0 };
    },
    markPeriod(period) {
      state.activePeriod = period;
    },
    summary() {
      const supabaseRequests = state.requests.filter((r) => isSupabase(r.url));
      return {
        screen: state.screen,
        requestCount: state.requests.length,
        supabaseRequestCount: supabaseRequests.length,
        jsBytes: state.bytesByKind.js,
        cssBytes: state.bytesByKind.css,
        consoleErrors: state.consoleErrors,
        pageErrors: state.pageErrors,
        jsCssApiErrors: state.jsCssApiErrors,
        missingCss: state.missingCss,
        duplicateSupabase: state.duplicateSupabase,
        heavyClientFileLoads: state.heavyClientFileLoads,
        periodLeakCandidates: state.periodLeakCandidates,
        proposalsDirectoryLoads: state.proposalsDirectoryLoads,
        failedRequests: state.failedRequests,
        requests: state.requests.map((r) => ({
          method: r.method,
          url: r.url,
          status: r.status,
          kind: r.kind,
          durationMs: r.durationMs,
          size: r.size,
          contentRange: r.contentRange
        }))
      };
    },
    async persist(label = state.screen) {
      ensureDir(NETWORK_LOG_DIR);
      ensureDir(CONSOLE_LOG_DIR);
      const safe = String(label).replace(/[^\w.-]+/g, '_');
      const networkPath = path.join(NETWORK_LOG_DIR, `${safe}.json`);
      const consolePath = path.join(CONSOLE_LOG_DIR, `${safe}.json`);
      const summary = this.summary();
      fs.writeFileSync(networkPath, JSON.stringify(summary, null, 2));
      fs.writeFileSync(
        consolePath,
        JSON.stringify({ consoleErrors: state.consoleErrors, pageErrors: state.pageErrors }, null, 2)
      );
      return { networkPath, consolePath };
    },
    dispose() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
  };
}

export function assertNoTransportErrors(tracker, { allowPeriodLeakCheck = false, expectPeriod = '' } = {}) {
  const s = tracker.summary();
  const problems = [];
  if (s.pageErrors.length) {
    problems.push(`JavaScript page errors: ${s.pageErrors.map((e) => e.message).join(' | ')}`);
  }
  if (s.consoleErrors.length) {
    problems.push(`Console errors: ${s.consoleErrors.map((e) => e.text).slice(0, 5).join(' | ')}`);
  }
  if (s.jsCssApiErrors.length) {
    problems.push(
      `JS/CSS/API status >= 400: ${s.jsCssApiErrors
        .slice(0, 8)
        .map((e) => {
          const body = e.body ? ` body=${e.body.replace(/\s+/g, ' ').slice(0, 300)}` : '';
          return `${e.status} ${e.kind} ${e.url}${body}`;
        })
        .join(' | ')}`
    );
  }
  if (s.missingCss.length) {
    problems.push(`Missing CSS: ${s.missingCss.map((e) => e.url).join(' | ')}`);
  }
  if (s.duplicateSupabase.length) {
    problems.push(
      `Duplicate identical Supabase requests: ${s.duplicateSupabase
        .slice(0, 5)
        .map((d) => d.identity)
        .join(' | ')}`
    );
  }
  if (allowPeriodLeakCheck && expectPeriod === 'school_2027' && s.periodLeakCandidates.length) {
    problems.push(
      `Loaded 2026-season data while working in 2027: ${s.periodLeakCandidates
        .slice(0, 3)
        .map((p) => p.url)
        .join(' | ')}`
    );
  }
  if (problems.length) {
    throw new Error(problems.join('\n'));
  }
}

export function assertClientFileInitialLoads(tracker) {
  const loads = tracker.state.proposalsDirectoryLoads || [];
  const problems = [];
  if (!loads.length) {
    // Soft: some warm navigations may reuse in-memory data; still require no page-2 auto load.
  }
  const autoPage2 = loads.filter((l) => Number(l.offset) >= 50);
  if (autoPage2.length) {
    problems.push(`Automatic page-2+ directory loads detected (offsets: ${autoPage2.map((l) => l.offset).join(', ')})`);
  }
  for (const load of loads) {
    if (load.end != null && load.offset === 0 && load.end - load.offset + 1 > 50) {
      problems.push(`First page requested more than 50 rows (Range ${load.offset}-${load.end})`);
    }
  }
  if (loads.length > 3) {
    // More than a couple identical first-page fetches suggests a paging loop
    const page0 = loads.filter((l) => Number(l.offset) === 0);
    if (page0.length > 4) {
      problems.push(`Possible full-page load loop: ${page0.length} offset=0 directory requests`);
    }
  }
  const heavy = tracker.state.heavyClientFileLoads || [];
  const blocked = heavy.filter((h) => ['pdf_or_snapshot', 'full_contacts', 'full_catalog'].includes(h.type));
  if (blocked.length) {
    problems.push(
      `Forbidden heavy loads on client-file open: ${blocked
        .slice(0, 6)
        .map((h) => `${h.type}:${h.url}`)
        .join(' | ')}`
    );
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

export { extractRangeCount, extractRequestedRange, isSupabase, supabaseIdentity };
