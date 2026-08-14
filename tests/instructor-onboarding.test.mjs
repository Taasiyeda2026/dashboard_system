import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { buildOnboardingMail, onboardingManagers, onboardingModalHtml, bindOnboardingModal } from '../frontend/src/screens/instructor-onboarding.js';
import { directFileItems, onboardingFolder } from '../supabase/functions/instructor-onboarding-files/logic.js';

const settings = {
  dropdown_options: { activities_manager_users: [{ name: 'גיל נאמן', is_active: true }, { name: 'הילה רוזן', is_active: true }, { name: 'לא פעיל', is_active: false }] },
  activity_manager_contacts: [
    { name: 'גיל נאמן', phone: '052-4506699', email: 'GilNeeman@think.org.il' },
    { name: 'הילה רוזן', phone: '052-3222951', email: 'HilaR@think.org.il' }
  ]
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountedModal(options = {}) {
  const dom = new JSDOM(`<div class="ds-modal"><div class="ds-modal__content">${onboardingModalHtml(onboardingManagers(settings))}</div><div class="ds-modal__footer"><button data-onboarding-folder></button><button data-onboarding-prepare></button></div></div>`, { url: 'https://example.test' });
  dom.window.open = () => null;
  globalThis.window = dom.window;
  const modal = dom.window.document.querySelector('.ds-modal');
  bindOnboardingModal(modal, { managers: onboardingManagers(settings), ...options });
  return { dom, modal };
}

function fill(modal, { manager = 'גיל נאמן', email = 'new@example.org' } = {}) {
  const values = [['name', 'אייל ישראלי'], ['phone', '050-123 4567'], ['email', email]];
  for (const [key, value] of values) {
    const input = modal.querySelector(`[data-onboarding-${key}]`); input.value = value; input.dispatchEvent(new window.Event('input'));
  }
  const employment = modal.querySelector('[data-onboarding-employment]'); employment.value = 'taasiyeda'; employment.dispatchEvent(new window.Event('change'));
  const managerSelect = modal.querySelector('[data-onboarding-manager]'); managerSelect.value = manager; managerSelect.dispatchEvent(new window.Event('change'));
}

test('five required onboarding fields gate the compact RTL primary action', () => {
  const { modal } = mountedModal();
  const root = modal.querySelector('.instructor-onboarding');
  assert.equal(root.getAttribute('dir'), 'rtl');
  assert.equal(root.querySelectorAll('input').length, 3);
  assert.equal(root.querySelectorAll('select').length, 2);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  assert.equal(modal.querySelector('[data-onboarding-folder]').disabled, false);
  fill(modal);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, false);
  assert.equal(modal.querySelector('[data-onboarding-folder]').style.width, modal.querySelector('[data-onboarding-prepare]').style.width);
});

test('real instructor and approved manager details appear in mail', () => {
  for (const manager of onboardingManagers(settings)) {
    const mail = buildOnboardingMail('taasiyeda', manager, 'אייל ישראלי');
    assert.match(mail.body, /שלום אייל ישראלי,/);
    assert.match(mail.body, new RegExp(`${manager.name} \\| ${manager.phone}`));
    assert.doesNotMatch(mail.body, /\[שם המדריך\/ה\]/);
  }
  assert.equal(onboardingManagers(settings)[0].email, 'GilNeeman@think.org.il');
  assert.equal(onboardingManagers(settings)[1].email, 'HilaR@think.org.il');
});

test('retry after Outlook failure uses the original instructor snapshot without another insert', async () => {
  const calls = [];
  let attempts = 0;
  const { modal } = mountedModal({
    createInstructor: async (row) => { calls.push(['create', row]); return { emp_id: 42, full_name: row.fullName }; },
    createDraft: async (mail) => { calls.push(['draft', mail]); attempts += 1; if (attempts === 1) throw new Error('outlook'); return { webLink: 'https://outlook.office.com/mail/drafts' }; }
  });
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /המדריך נוצר בהצלחה, אך הכנת המייל נכשלה/);
  const changedEmail = modal.querySelector('[data-onboarding-email]');
  changedEmail.value = 'changed@example.org'; changedEmail.dispatchEvent(new window.Event('input'));
  const changedManager = modal.querySelector('[data-onboarding-manager]');
  changedManager.value = 'הילה רוזן'; changedManager.dispatchEvent(new window.Event('change'));
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'draft').length, 2);
  assert.deepEqual(calls[0][1], { fullName: 'אייל ישראלי', phone: '050-123 4567', email: 'new@example.org', employmentType: 'תעשיידע', managerName: 'גיל נאמן' });
  assert.equal(calls[1][1].instructorEmail, 'new@example.org');
  assert.equal(calls[1][1].manager.email, 'GilNeeman@think.org.il');
  assert.equal(calls[2][1].instructorEmail, 'new@example.org');
  assert.equal(calls[2][1].manager.name, 'גיל נאמן');
  assert.equal(calls[2][1].manager.email, 'GilNeeman@think.org.il');
});

test('invalid email blocks creation', async () => {
  let creates = 0;
  const { modal } = mountedModal({ createInstructor: async () => { creates += 1; } });
  fill(modal, { email: 'not-an-email' });
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(creates, 0);
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /כתובת מייל תקינה/);
});

test('implementation creates delegated drafts with TO and CC and has no send capability', async () => {
  const [client, edge, migration] = await Promise.all([
    readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260814150000_instructor_onboarding_atomic_create.sql', import.meta.url), 'utf8')
  ]);
  assert.match(client, /'\/me\/messages'/);
  assert.match(client, /toRecipients: \[\{ emailAddress: \{ address: instructorEmail \} \}\]/);
  assert.match(client, /ccRecipients: \[\{ emailAddress: \{ address: manager\.email \} \}\]/);
  assert.doesNotMatch(client, /mailto:|sendMail|Mail\.Send/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /app_has_permission\('view_employee_files'\)/);
  assert.match(migration, /revoke execute[^;]+from anon/i);
  assert.match(migration, /max\(ci\.emp_id::bigint\).*\+ 1/s);
  assert.match(migration, /lower\(trim\(coalesce\(ci\.email/);
  assert.match(migration, /regexp_replace\(coalesce\(ci\.mobile/);
  assert.match(migration, /'yes'/);
  assert.match(edge, /BASE_FOLDER = "תיקים אישיים\/קליטת מדריך"/);
  assert.doesNotMatch(edge, /sendMail/i);
});

test('SharePoint mapping keeps every direct file and excludes subfolders', () => {
  assert.equal(onboardingFolder('taasiyeda'), 'תעשיידע');
  assert.equal(onboardingFolder('staffing'), 'כוח אדם');
  const files = directFileItems([
    { id: '1', name: 'מסמך חדש.docx', file: { mimeType: 'application/docx' } },
    { id: '2', name: 'שם שהשתנה.anything', file: { mimeType: 'application/octet-stream' } },
    { id: '3', name: 'תיקיית משנה', folder: { childCount: 1 } }
  ]);
  assert.deepEqual(files.map((item) => item.id), ['1', '2']);
});
