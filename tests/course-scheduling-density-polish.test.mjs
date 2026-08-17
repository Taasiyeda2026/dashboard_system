import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../frontend/src/screens/course-scheduling-density-polish.css', import.meta.url), 'utf8');
const enhancer = readFileSync(new URL('../frontend/src/screens/course-scheduling-compact-layout.js', import.meta.url), 'utf8');

test('compact scheduling density polish loads after the existing compact layout', () => {
  assert.match(enhancer, /import '\.\/course-scheduling-compact-layout\.css';\s*import '\.\/course-scheduling-density-polish\.css';/);
});

test('course rows and summary counters are tightened without hiding content', () => {
  assert.match(css, /course-scheduling-summary-card[\s\S]*min-height:\s*36px/);
  assert.match(css, /course-scheduling-compact-row[\s\S]*min-height:\s*40px/);
  assert.doesNotMatch(css, /display:\s*none[^;]*;[\s\S]*course-scheduling-compact-row/);
});

test('row statuses render as small semantic badges', () => {
  assert.match(css, /course-scheduling-status-chip[\s\S]*display:\s*inline-flex/);
  assert.match(css, /course-scheduling-status-chip[\s\S]*border-radius:\s*999px/);
  assert.match(css, /course-scheduling-status-chip\.is-status-ready[\s\S]*background:\s*var\(--cs-ready-soft\)/);
  assert.match(css, /course-scheduling-status-chip\.is-status-danger[\s\S]*background:\s*var\(--cs-danger-soft\)/);
});

test('matching pane fits content and negative state uses a quiet red dot', () => {
  assert.match(css, /course-scheduling-detail:not\(\.has-compact-results\)[\s\S]*min-height:\s*138px/);
  assert.match(css, /course-scheduling-result-block--negative \.course-scheduling-result-message::before[\s\S]*width:\s*6px[\s\S]*border-radius:\s*50%/);
});

test('rejected candidate rows are compact but remain readable', () => {
  assert.match(css, /course-scheduling-rejected-row[\s\S]*padding:\s*5px 9px/);
  assert.match(css, /course-scheduling-rejected-row[\s\S]*line-height:\s*1\.3/);
});
