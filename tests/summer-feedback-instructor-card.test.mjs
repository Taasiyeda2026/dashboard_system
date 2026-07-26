import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const integrationSource = readFileSync(
  new URL('../frontend/src/summer-feedback-instructor-card.js', import.meta.url),
  'utf8'
);
const dashboardEnhancer = readFileSync(
  new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url),
  'utf8'
);

globalThis.__SUMMER_FEEDBACK_INSTRUCTOR_CARD_TEST__ = true;
const cardModule = await import(
  `${new URL('../frontend/src/summer-feedback-instructor-card.js', import.meta.url).href}?test=${Date.now()}`
);

test('summer feedback eligibility is based on the authenticated instructor assignment and not dashboard role', () => {
  assert.ok(dashboardEnhancer.includes("import './summer-feedback-instructor-card.js';"));
  assert.ok(integrationSource.includes(".from('summer_feedback_assignments')"));
  assert.ok(integrationSource.includes(".eq('instructor_auth_user_id', userId)"));
  assert.ok(integrationSource.includes(".eq('cycle_key', CYCLE_KEY)"));
  assert.equal(integrationSource.includes(".from('users')"), false);
  assert.equal(integrationSource.includes("role === 'instructor'"), false);
  assert.equal(integrationSource.includes("role === 'manager'"), false);
});

test('card is exposed only while the summer feedback cycle is open', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');
  assert.equal(cardModule.cycleIsOpen({ status: 'draft' }, now), false);
  assert.equal(cardModule.cycleIsOpen({ status: 'open' }, now), true);
  assert.equal(cardModule.cycleIsOpen({
    status: 'open',
    opens_at: '2026-07-27T00:00:00Z'
  }, now), false);
  assert.equal(cardModule.cycleIsOpen({
    status: 'open',
    closes_at: '2026-07-25T00:00:00Z'
  }, now), false);
});

test('card state distinguishes not started, in progress and submitted feedback', () => {
  const assignments = [{ id: 'a1' }];

  const fresh = cardModule.buildSummerFeedbackCardState({ assignments });
  assert.equal(fresh.status, 'טרם התחיל');
  assert.equal(fresh.action, 'התחלת המשוב');
  assert.equal(fresh.progress, 0);

  const progress = cardModule.buildSummerFeedbackCardState({
    assignments,
    response: {
      status: 'draft',
      general_answers: { preparation_info: 5 },
      summary_answers: {}
    },
    ratings: [{ assignment_id: 'a1', age_fit: 5 }]
  });
  assert.match(progress.status, /^בתהליך · \d+%$/);
  assert.equal(progress.action, 'המשך מילוי');
  assert.ok(progress.progress > 0 && progress.progress < 100);

  const submitted = cardModule.buildSummerFeedbackCardState({
    assignments,
    response: { status: 'submitted' }
  });
  assert.equal(submitted.status, 'הושלם');
  assert.equal(submitted.action, 'צפייה במשוב');
  assert.equal(submitted.progress, 100);
  assert.equal(submitted.complete, true);
});

test('assigned instructor card is inserted prominently below the dashboard header', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="ds-dashboard-wrap">
      <header class="ds-dash-header"><h1>לוח בקרה</h1></header>
      <div data-dash-data-area></div>
    </div>
  </body></html>`);

  const host = dom.window.document.querySelector('.ds-dashboard-wrap');
  const state = cardModule.buildSummerFeedbackCardState({ assignments: [{ id: 'a1' }] });
  const inserted = cardModule.injectSummerFeedbackCard(host, state);
  const card = host.querySelector('[data-summer-feedback-instructor-card]');

  assert.equal(inserted, true);
  assert.ok(card);
  assert.equal(host.children[1], card);
  assert.equal(card.querySelector('.ds-summer-feedback-card__action')?.getAttribute('href'), './summer-feedback/');
  assert.equal(card.querySelector('.ds-summer-feedback-card__action')?.textContent, 'התחלת המשוב');
  assert.equal(card.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '0');

  assert.equal(cardModule.injectSummerFeedbackCard(host, state), false);
  assert.equal(host.querySelectorAll('[data-summer-feedback-instructor-card]').length, 1);
  dom.window.close();
});

test('assigned instructor card is also inserted on the instructor calendar home page', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <main id="screenRoot">
      <section class="instructor-area">
        <header class="ds-page-header"><h1>לוח השנה שלי</h1></header>
        <div class="instructor-calendar-inner"></div>
      </section>
    </main>
  </body></html>`);

  const host = cardModule.findSummerFeedbackCardHost(dom.window.document);
  const state = cardModule.buildSummerFeedbackCardState({ assignments: [{ id: 'a1' }] });
  const inserted = cardModule.injectSummerFeedbackCard(host, state);
  const card = host.querySelector('[data-summer-feedback-instructor-card]');

  assert.equal(host?.classList.contains('instructor-area'), true);
  assert.equal(inserted, true);
  assert.ok(card);
  assert.equal(host.children[1], card);
  assert.equal(card.querySelector('.ds-summer-feedback-card__action')?.getAttribute('href'), './summer-feedback/');
  dom.window.close();
});

test('the card refreshes automatically after the scheduled opening time', () => {
  assert.match(integrationSource, /REFRESH_INTERVAL_MS = 30_000/);
  assert.match(integrationSource, /setInterval\(refreshFromServer, REFRESH_INTERVAL_MS\)/);
  assert.match(integrationSource, /visibilitychange/);
});
