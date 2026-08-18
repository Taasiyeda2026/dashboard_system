/**
 * Regression: year-selector panel-close behaviour.
 *
 * When the user switches the global year (2026 ↔ 2027) the manager summary
 * panel ("לוח מנהל פעילות") must close immediately.  This test exercises the
 * same DOM-closing logic that activity-period-selector-access-hotfix.js runs
 * inside its click handler, without importing the full module graph.
 *
 * Run:  node --test tests/year-selector-panel-close.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ── Same logic as in activity-period-selector-access-hotfix.js ──────────────
function closeSummaryPanels(document) {
  document.querySelectorAll('[data-summary-panel]').forEach((panel) => {
    if (panel.hidden) return;
    panel.hidden = true;
    const target = panel.dataset.summaryPanel;
    if (!target) return;
    // CSS.escape not needed in tests — targets are always safe identifiers.
    const btn = document.querySelector(`[data-summary-target="${target}"]`);
    if (!btn) return;
    btn.textContent = 'סיכום';
    btn.classList.remove('is-active');
    btn.setAttribute('aria-expanded', 'false');
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('year-selector: open summary panel closes on year switch', () => {
  const { document } = new JSDOM(`
    <div>
      <button
        data-summary-target="national"
        class="ds-summary-btn is-active"
        aria-expanded="true">סגור ✕</button>
      <div data-summary-panel="national">Panel content</div>
    </div>
  `).window;

  const panel = document.querySelector('[data-summary-panel="national"]');
  const btn   = document.querySelector('[data-summary-target="national"]');

  // Pre-condition: panel is open
  assert.equal(panel.hidden, false,   'panel should start open');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok(btn.classList.contains('is-active'), 'is-active must be set');

  closeSummaryPanels(document);

  // Post-condition: panel is closed
  assert.equal(panel.hidden, true,    'panel must be hidden after year switch');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'aria-expanded must be false');
  assert.equal(btn.textContent, 'סיכום', 'button text must reset to סיכום');
  assert.ok(!btn.classList.contains('is-active'), 'is-active class must be removed');
});

test('year-selector: already-closed panel stays closed', () => {
  const { document } = new JSDOM(`
    <div>
      <button data-summary-target="national" class="ds-summary-btn" aria-expanded="false">סיכום</button>
      <div data-summary-panel="national" hidden>Panel content</div>
    </div>
  `).window;

  const panel = document.querySelector('[data-summary-panel="national"]');

  closeSummaryPanels(document);

  assert.equal(panel.hidden, true, 'already-closed panel must stay closed');
});

test('year-selector: no panel in DOM is a safe no-op', () => {
  const { document } = new JSDOM('<div></div>').window;
  assert.doesNotThrow(() => closeSummaryPanels(document), 'must not throw when no panel exists');
});

test('year-selector: multiple panels all close on year switch', () => {
  const { document } = new JSDOM(`
    <div>
      <button data-summary-target="a" class="is-active" aria-expanded="true">סגור ✕</button>
      <div data-summary-panel="a">A</div>
      <button data-summary-target="b" class="is-active" aria-expanded="true">סגור ✕</button>
      <div data-summary-panel="b">B</div>
    </div>
  `).window;

  closeSummaryPanels(document);

  ['a', 'b'].forEach((id) => {
    assert.equal(document.querySelector(`[data-summary-panel="${id}"]`).hidden, true,
      `panel "${id}" must be hidden`);
    assert.equal(
      document.querySelector(`[data-summary-target="${id}"]`).getAttribute('aria-expanded'),
      'false', `button "${id}" aria-expanded must be false`
    );
  });
});
