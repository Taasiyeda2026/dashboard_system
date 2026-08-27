import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  catalogActivityChangesFromSelection,
  selectedActivityCatalogIdentity,
  syncActivityCatalogIdentityFromName
} from '../frontend/src/activity-catalog-identity.js';

function meetingCards(count) {
  return Array.from({ length: count }, (_, index) => `
    <div class="activity-drawer__date-card" data-meeting-index="${index}">
      <input data-meeting-idx="${index}" name="meeting_date_${index}">
    </div>
  `).join('');
}

function buildForm({ currentActivityNo = '6089', currentGefenNumber = '6089', selectedActivityNo = '6089', selectedGefenNumber = '6089', catalogMeetings = 11, cards = 8 } = {}) {
  const dom = new JSDOM(`
    <form data-is-once="no">
      <input type="hidden" name="activity_no" data-activity-no value="${currentActivityNo}">
      <input type="hidden" name="gefen_number" data-gefen-number value="${currentGefenNumber}">
      <select data-role="activity-name-select">
        <option
          value="פעילות נבחרת"
          data-activity-no="${selectedActivityNo}"
          data-gefen-number="${selectedGefenNumber}"
          data-meetings-count="${catalogMeetings}"
          data-activity-type="course"
          selected>פעילות נבחרת</option>
      </select>
      <div data-meeting-dates-edit>${meetingCards(cards)}</div>
    </form>
  `);
  return dom.window.document.querySelector('form');
}

async function flushMutations() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('existing activity keeps its local 8-session count instead of the 11-session catalog default', () => {
  const form = buildForm({ catalogMeetings: 11, cards: 8 });

  const identity = selectedActivityCatalogIdentity(form);

  assert.equal(identity.meetings_count, 8);
  assert.equal(form.querySelector('[name="sessions"]').value, '8');
});

test('removing meetings updates the persisted sessions form value from 10 to 8', async () => {
  const form = buildForm({ catalogMeetings: 10, cards: 10 });
  selectedActivityCatalogIdentity(form);

  const grid = form.querySelector('[data-meeting-dates-edit]');
  grid.lastElementChild.remove();
  grid.lastElementChild.remove();
  await flushMutations();

  assert.equal(form.querySelector('[name="sessions"]').value, '8');
  assert.equal(selectedActivityCatalogIdentity(form).meetings_count, 8);
});

test('switching programs uses the new catalog count as a default but a later manual reduction remains authoritative', async () => {
  const form = buildForm({
    currentActivityNo: '6089',
    currentGefenNumber: '6089',
    selectedActivityNo: '53819',
    selectedGefenNumber: '53819',
    catalogMeetings: 10,
    cards: 8
  });

  const firstSelection = selectedActivityCatalogIdentity(form);
  assert.equal(firstSelection.meetings_count, 10, 'a real program switch should start from the new catalog default');

  const syncedSelection = syncActivityCatalogIdentityFromName(form);
  assert.equal(syncedSelection.meetings_count, 10);
  assert.equal(form.querySelector('[data-activity-no]').value, '53819');

  const grid = form.querySelector('[data-meeting-dates-edit]');
  grid.innerHTML = meetingCards(10);
  await flushMutations();
  assert.equal(form.querySelector('[name="sessions"]').value, '10');

  grid.lastElementChild.remove();
  grid.lastElementChild.remove();
  await flushMutations();

  const finalSelection = selectedActivityCatalogIdentity(form);
  const changes = catalogActivityChangesFromSelection(finalSelection);
  assert.equal(finalSelection.meetings_count, 8);
  assert.equal(changes.sessions, 8, 'save-time catalog normalization must not restore the catalog default');
});