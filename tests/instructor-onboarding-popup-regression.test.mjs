import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { onboardingManagers, onboardingModalHtml, bindOnboardingModal } from '../frontend/src/screens/instructor-onboarding.js';

const settings = {
  dropdown_options: { activities_manager_users: [{ name: 'גיל נאמן', is_active: true }] },
  activity_manager_contacts: [{ name: 'גיל נאמן', phone: '052-4506699', email: 'GilNeeman@think.org.il' }]
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount({ openWindow, ...bindOptions } = {}) {
  const managers = onboardingManagers(settings);
  const dom = new JSDOM(`<!doctype html><body><div class="ds-modal"><div class="ds-modal__content">${onboardingModalHtml(managers)}</div><div class="ds-modal__footer"><button data-onboarding-folder></button><button data-onboarding-prepare></button></div></div></body>`, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  dom.window.open = openWindow || (() => null);
  const modal = dom.window.document.querySelector('.ds-modal');
  bindOnboardingModal(modal, { managers, ensureEmployeeFolder: async () => ({ folder_web_url: 'https://think365orgil.sharepoint.com/folder' }), ...bindOptions });
  return { dom, modal };
}

function fill(modal) {
  for (const [name, value] of [['name', 'אייל ישראלי'], ['phone', '050-1234567'], ['email', 'new@example.org']]) {
    const input = modal.querySelector(`[data-onboarding-${name}]`);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const employment = modal.querySelector('[data-onboarding-employment]');
  employment.value = 'taasiyeda';
  employment.dispatchEvent(new window.Event('change', { bubbles: true }));
  const manager = modal.querySelector('[data-onboarding-manager]');
  manager.value = 'גיל נאמן';
  manager.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function fakePopup() {
  return {
    closed: false,
    opener: {},
    document: { title: '', body: { innerHTML: '' } },
    location: {
      href: 'about:blank',
      replace(url) { this.href = String(url); }
    },
    close() { this.closed = true; }
  };
}

test('Outlook tab is reserved synchronously before any onboarding await and later navigated to the draft', async () => {
  const popup = fakePopup();
  let openCount = 0;
  let releaseCreate;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const { modal } = mount({
    openWindow: () => { openCount += 1; return popup; },
    createInstructor: async () => { await createGate; return { emp_id: 42 }; },
    createDraft: async () => ({ webLink: 'https://outlook.office.com/mail/deeplink/compose/test' })
  });
  fill(modal);

  modal.querySelector('[data-onboarding-prepare]').click();
  assert.equal(openCount, 1, 'the popup must be opened in the original click gesture');
  assert.equal(popup.location.href, 'about:blank');

  releaseCreate();
  await tick();
  await tick();
  assert.equal(popup.location.href, 'https://outlook.office.com/mail/deeplink/compose/test');
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /הטיוטה הוכנה בהצלחה/);
});

test('retry can prepare Outlook mail when the instructor was already created by an earlier partial attempt', async () => {
  const popup = fakePopup();
  let draftCalls = 0;
  const duplicate = new Error('המדריך כבר קיים במערכת.');
  duplicate.code = 'instructor_exists';
  duplicate.existingInstructor = { emp_id: 42, already_exists: true, full_name: 'אייל ישראלי' };
  const { modal } = mount({
    openWindow: () => popup,
    createInstructor: async () => { throw duplicate; },
    createDraft: async () => { draftCalls += 1; return { webLink: 'https://outlook.office.com/mail/drafts' }; }
  });
  fill(modal);

  modal.querySelector('[data-onboarding-prepare]').click();
  await tick();
  await tick();

  assert.equal(draftCalls, 1);
  assert.equal(popup.location.href, 'https://outlook.office.com/mail/drafts');
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /הטיוטה הוכנה בהצלחה/);
});

test('blocked popup leaves a user-clickable Outlook draft link instead of creating a second draft', async () => {
  let draftCalls = 0;
  const { modal } = mount({
    openWindow: () => null,
    createInstructor: async () => ({ emp_id: 42 }),
    createDraft: async () => { draftCalls += 1; return { webLink: 'https://outlook.office.com/mail/drafts' }; }
  });
  fill(modal);

  modal.querySelector('[data-onboarding-prepare]').click();
  await tick();
  await tick();

  const link = modal.querySelector('[data-onboarding-status] a');
  assert.equal(draftCalls, 1);
  assert.ok(link);
  assert.equal(link.href, 'https://outlook.office.com/mail/drafts');
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
});
