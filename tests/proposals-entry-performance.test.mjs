import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const featureLoaders = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
const routeLoader = await readFile(new URL('../frontend/src/feature-route-loader.js', import.meta.url), 'utf8');
const proposalsScreen = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const editorController = await readFile(new URL('../frontend/src/proposal-editor-controller.js', import.meta.url), 'utf8');
const workflowRuntime = await readFile(new URL('../frontend/src/proposal-workflow-completion.js', import.meta.url), 'utf8');
const mainEntry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
const baselineMonitor = await readFile(new URL('../frontend/src/local-baseline-monitor.js', import.meta.url), 'utf8');

test('proposal hover/focus preload warms only the screen module, not the heavy proposal feature bundle', () => {
  const match = featureLoaders.match(/case 'proposals-agreements':[\s\S]*?case 'operations-management':/);
  assert.ok(match, 'proposal preload case must exist');
  assert.match(match[0], /import\('\.\/screens\/proposals-agreements\.js'\)/);
  assert.doesNotMatch(match[0], /ensureFeature\('proposals'\)/);
});

test('proposal route features wait for first screen paint and browser idle time', () => {
  assert.match(routeLoader, /DEFERRED_FEATURE_ROUTES = new Set\(\['proposals-agreements'\]\)/);
  assert.match(routeLoader, /screenHasFirstPaint\(\)/);
  assert.match(routeLoader, /requestIdleCallback/);
  assert.match(routeLoader, /DEFERRED_FEATURE_MAX_WAIT_MS/);
  assert.match(routeLoader, /scheduleRouteFeatures\(route\)/);
});

test('non-proposal routes keep immediate feature loading behavior', () => {
  assert.match(routeLoader, /if \(!DEFERRED_FEATURE_ROUTES\.has\(key\)\) \{[\s\S]*?loadRouteFeatures\(key\);[\s\S]*?return;/);
});

test('initial proposal request is one limited metadata page with no editor dependencies', () => {
  const loadBlock = proposalsScreen.slice(proposalsScreen.indexOf('export const proposalsAgreementsScreen'), proposalsScreen.indexOf('render(data'));
  assert.match(loadBlock, /limit:\s*50/);
  assert.match(loadBlock, /offset:\s*0/);
  assert.doesNotMatch(loadBlock, /proposalsAgreementsContacts|proposalsAgreementsEditorDeps|proposalActivityPricing|proposalTemplateSections|schoolCalendar|document_snapshot|document_html_snapshot/);

  const listColumns = apiSource.match(/const PROPOSALS_AGREEMENTS_LIST_COLUMNS = '([^']+)'/)?.[1] || '';
  assert.doesNotMatch(listColumns, /document_snapshot|document_html_snapshot/);
  const listLoader = apiSource.slice(apiSource.indexOf('async function readProposalsAgreementsFromSupabase'), apiSource.indexOf('const USER_PUBLIC_COLUMNS', apiSource.indexOf('async function readProposalsAgreementsFromSupabase')));
  assert.doesNotMatch(listLoader, /readContactsSchoolsForProposals|readAuthoritySchoolCatalog|readProposalActivityPricingFromSupabase|readProposalTemplateSectionsFromSupabase|readSchoolCalendarForProposalValidity/);
});

test('proposal pagination and search remain explicit and server-side', () => {
  assert.match(proposalsScreen, /loadNextProposalPage/);
  assert.match(proposalsScreen, /reloadProposalList/);
  assert.doesNotMatch(proposalsScreen, /while\s*\(\s*data\._hasMore\s*\)/);
  assert.doesNotMatch(proposalsScreen, /appendRemainingProposalPages\s*\(\s*\)\s*;/);
  assert.match(apiSource, /applyProposalsAgreementsListFilters/);
  assert.match(apiSource, /applyProposalsAgreementsListSort/);
  assert.match(apiSource, /\.range\(pageOffset, pageOffset \+ pageSize - 1\)/);
});

test('hover and focus preload cannot load proposal data, editor dependencies, or PDF features', () => {
  const warmupCase = featureLoaders.match(/case 'proposals-agreements':[\s\S]*?case 'operations-management':/)?.[0] || '';
  assert.match(warmupCase, /import\('\.\/screens\/proposals-agreements\.js'\)/);
  assert.doesNotMatch(warmupCase, /ensureFeature\('proposals'\)|screen\.load|proposalsAgreementsEditorDeps|proposal-pdf/);
  assert.doesNotMatch(routeLoader.match(/pointerover[\s\S]*?focusin/)?.[0] || '', /ensureFeaturesForRoute|screen\.load/);
  assert.doesNotMatch(mainEntry, /proposal-pdf-|proposal-editor-/);
});

test('ProposalEditorController remains the sole totals and live-preview scheduler', () => {
  assert.match(proposalsScreen, /new ProposalEditorController/);
  assert.match(editorController, /schedule\(\)/);
  assert.match(editorController, /this\.calculate\?\./);
  assert.doesNotMatch(workflowRuntime, /new\s+MutationObserver|querySelector(?:All)?\([^)]*data-pa-live-preview/);
});

test('local proposal instrumentation covers entry, query, render, bind, deferred, and prewarm phases', () => {
  for (const timing of ['proposals:navigation-to-module-ready', 'proposals:navigation-to-initial-content', 'proposals:render', 'proposals:bind']) {
    assert.match(mainSource, new RegExp(timing));
  }
  for (const timing of ['proposals:screen-load-to-list-complete', 'proposals:list-to-gefen-eligibility-complete', 'proposals:linked-documents-query', 'proposals:client-normalization']) {
    assert.match(apiSource, new RegExp(timing));
  }
  assert.match(routeLoader, /proposals:deferred-features/);
  assert.match(workflowRuntime, /proposals:editor-deps-prewarm/);
  assert.match(baselineMonitor, /performance\?\.mark/);
  assert.match(baselineMonitor, /performance\?\.measure/);
});
