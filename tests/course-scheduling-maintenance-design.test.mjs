import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (file) => readFile(new URL(file, import.meta.url), 'utf8');

test('maintenance uses full-width stacked cards instead of a cramped two-column layout', async () => {
  const css = await source('../frontend/src/screens/course-scheduling.css');
  const maintenance = css.split('/* Route maintenance: full-width')[1].split('/* ——— Balanced scope bar')[0];
  assert.match(maintenance, /course-scheduling-maintenance-tab\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(maintenance, /course-scheduling-maintenance-card--base/);
  assert.match(maintenance, /course-scheduling-maintenance-card--queue/);
  assert.match(maintenance, /course-scheduling-maintenance-route-button\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(maintenance, /course-scheduling-maintenance-routes table\s*\{[\s\S]*width:\s*100%/);
  assert.match(maintenance, /@media \(max-width:\s*760px\)/);
  assert.match(maintenance, /content:\s*attr\(data-label\)/);
});

test('route maintenance labels and user-initiated calculation handlers remain connected', async () => {
  const js = await source('../frontend/src/screens/course-scheduling.js');
  const card = js.split('function maintenanceTabHtml')[1].split('function calendarTabHtml')[0];
  assert.match(card, /course-scheduling-maintenance-card--queue/);
  assert.match(card, /course-scheduling-maintenance-card--base/);
  assert.match(card, /data-label="מוצא"/);
  assert.match(card, /data-label="יעד"/);
  assert.match(card, /data-label="מצב"/);
  assert.match(card, /data-calculate-missing-route/);
  assert.match(card, /data-update-distances/);
  assert.match(card, /data-refresh-distance-coverage/);
  assert.match(js, /querySelectorAll\('\[data-calculate-missing-route\]'\)/);
  const loading=js.split('const reloadManualRouteQueue')[1].split('const reloadDistanceCoverage')[0];
  assert.doesNotMatch(loading, /invokeDistanceRoute|runDistanceBuildLoop/);
});

test('list resolves catalog school identity without guessing when several schools share an address', async () => {
 const js = await source('../frontend/src/screens/course-scheduling.js');
 const view = js.split('function maintenanceTabHtml')[1].split('function calendarTabHtml')[0];
 assert.match(view, /origin_catalog_matches/);
 assert.match(view, /destination_catalog_matches/);
 assert.match(view, /matches.length === 1/);
 assert.match(view, /matches.length > 1/);
 assert.match(view, /נדרש זיהוי בית ספר/);
 assert.match(view, /בית הספר טרם זוהה/);
 const loader = js.split('const reloadManualRouteQueue')[1].split('const reloadDistanceCoverage')[0];
 assert.match(loader, /from\('schools'\)/);
 assert.match(loader, /\.in\('institution_address', catalogAddresses\)/);
 assert.match(loader, /city.length > 1/);
 assert.doesNotMatch(loader, /invokeDistanceRoute|runDistanceBuildLoop/);
});
