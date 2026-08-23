import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { buildOnboardingMail, onboardingManagers, onboardingModalHtml, bindOnboardingModal, createOnboardingInstructor } from '../frontend/src/screens/instructor-onboarding.js';
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
  bindOnboardingModal(modal, { managers: onboardingManagers(settings), openMailClient: () => true, ensureEmployeeFolder: async () => ({ folder_web_url: 'https://think365orgil.sharepoint.com/folder' }), ...options });
  return { dom, modal };
}

function fill(modal, { manager = 'גיל נאמן', email = 'new@example.org', employmentType = 'taasiyeda', agency = '', hourlyRate = '70' } = {}) {
  const values = [['name', 'אייל ישראלי'], ['phone', '050-123 4567'], ['email', email]];
  for (const [key, value] of values) {
    const input = modal.querySelector(`[data-onboarding-${key}]`); input.value = value; input.dispatchEvent(new window.Event('input'));
  }
  const employment = modal.querySelector('[data-onboarding-employment]'); employment.value = employmentType; employment.dispatchEvent(new window.Event('change'));
  const rateSelect = modal.querySelector('[data-onboarding-rate]'); rateSelect.value = employmentType === 'taasiyeda' ? hourlyRate : ''; rateSelect.dispatchEvent(new window.Event('change'));
  const agencySelect = modal.querySelector('[data-onboarding-agency]'); agencySelect.value = agency; agencySelect.dispatchEvent(new window.Event('change'));
  const managerSelect = modal.querySelector('[data-onboarding-manager]'); managerSelect.value = manager; managerSelect.dispatchEvent(new window.Event('change'));
}

test('required onboarding fields gate the compact RTL primary action and Taasiyeda exposes hourly rate', () => {
  const { modal } = mountedModal();
  const root = modal.querySelector('.instructor-onboarding');
  assert.equal(root.getAttribute('dir'), 'rtl');
  assert.equal(root.querySelectorAll('input').length, 3);
  assert.equal(root.querySelectorAll('select').length, 4);
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  fill(modal);
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').hidden, false);
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').style.display, 'grid');
  assert.equal(modal.querySelector('[data-onboarding-rate]').value, '70');
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, false);
});

test('Taasiyeda requires an explicit 70/75/80/85 hourly rate and passes it to draft creation', async () => {
  const calls = [];
  const { modal } = mountedModal({
    createInstructor: async () => ({ emp_id: 44, full_name: 'אייל ישראלי' }),
    createDraft: async (mail) => { calls.push(mail); return { draftId: 'draft-1', attachmentCount: 4 }; }
  });
  fill(modal, { hourlyRate: '' });
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  const rate = modal.querySelector('[data-onboarding-rate]');
  rate.value = '85'; rate.dispatchEvent(new window.Event('change'));
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, false);
  assert.match(modal.querySelector('[data-onboarding-documents]').textContent, /הסכם העסקה – 85 ₪ לשעה/);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(calls[0].employmentType, 'taasiyeda');
  assert.equal(calls[0].hourlyRate, '85');
});

test('invalid normalized phone is disabled and never reaches instructor creation', async () => {
  let creates = 0;
  const { modal } = mountedModal({ createInstructor: async () => { creates += 1; } });
  fill(modal);
  const phone = modal.querySelector('[data-onboarding-phone]');
  phone.value = 'בדיקה';
  phone.dispatchEvent(new window.Event('input'));
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  modal.querySelector('[data-onboarding-prepare]').click();
  await tick();
  assert.equal(creates, 0);
});

test('createOnboardingInstructor guards an empty normalized phone before RPC', async () => {
  await assert.rejects(
    createOnboardingInstructor({ fullName: 'אייל', phone: 'בדיקה', email: 'a@example.org', employmentType: 'עצמאי', managerName: 'גיל' }),
    /onboarding_required_fields_missing/
  );
});

test('staffing requires a visible agency selection and clears it when switching to Taasiyeda', () => {
  const { modal } = mountedModal();
  fill(modal, { employmentType: 'staffing' });
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').hidden, false);
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').style.display, 'grid');
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  const agency = modal.querySelector('[data-onboarding-agency]');
  agency.value = 'מעוף'; agency.dispatchEvent(new window.Event('change'));
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, false);
  const employment = modal.querySelector('[data-onboarding-employment]');
  employment.value = 'taasiyeda'; employment.dispatchEvent(new window.Event('change'));
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').hidden, false);
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').style.display, 'none');
  assert.equal(agency.value, '');
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
});

for (const staffingAgency of ['מעוף', 'מנפאואר']) {
  test(`${staffingAgency} is saved as the actual employment type while SharePoint remains staffing`, async () => {
    const calls = [];
    const { modal } = mountedModal({
      createInstructor: async (row) => { calls.push(['create', row]); return { emp_id: 42 }; },
      createDraft: async (mail) => { calls.push(['draft', mail]); return { draftId: 'draft-1', attachmentCount: 4 }; }
    });
    fill(modal, { employmentType: 'staffing', agency: staffingAgency });
    modal.querySelector('[data-onboarding-prepare]').click(); await tick();
    assert.equal(calls[0][1].employmentType, staffingAgency);
    assert.equal(calls[1][1].employmentType, 'staffing');
    assert.equal(calls[1][1].hourlyRate, '');
    assert.equal(onboardingFolder(calls[1][1].employmentType), 'כוח אדם');
  });
}

test('independent onboarding stores עצמאי and uses the עצמאי SharePoint folder without agency selection', async () => {
  const calls = [];
  const { modal } = mountedModal({
    createInstructor: async (row) => { calls.push(['create', row]); return { emp_id: 43 }; },
    createDraft: async (mail) => { calls.push(['draft', mail]); return { draftId: 'draft-1', attachmentCount: 4 }; }
  });
  fill(modal, { employmentType: 'independent' });
  assert.equal(modal.querySelector('[data-onboarding-agency-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-rate-field]').hidden, true);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, false);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(calls[0][1].employmentType, 'עצמאי');
  assert.equal(calls[1][1].employmentType, 'independent');
  assert.equal(calls[1][1].hourlyRate, '');
  assert.equal(onboardingFolder(calls[1][1].employmentType), 'עצמאי');
});

test('real instructor and approved manager details appear in mail', () => {
  for (const manager of onboardingManagers(settings)) {
    const mail = buildOnboardingMail('taasiyeda', manager, 'אייל ישראלי');
    assert.match(mail.body, /שלום אייל ישראלי,/);
    assert.match(mail.body, new RegExp(`${manager.name} \\| ${manager.phone}`));
    assert.match(mail.body, /נוהל 009 - מניעת הטרדה מינית/);
    assert.doesNotMatch(mail.body, /שמירה על סודיות|כללים ונהלים - מדריכים 2027/);
    assert.doesNotMatch(mail.body, /\[שם המדריך\/ה\]/);
  }
  assert.equal(onboardingManagers(settings)[0].email, 'GilNeeman@think.org.il');
  assert.equal(onboardingManagers(settings)[1].email, 'HilaR@think.org.il');
});

test('retry after Outlook failure uses the original staffing agency snapshot without another insert', async () => {
  const calls = [];
  let attempts = 0;
  const { modal } = mountedModal({
    createInstructor: async (row) => { calls.push(['create', row]); return { emp_id: 42, full_name: row.fullName }; },
    createDraft: async (mail) => { calls.push(['draft', mail]); attempts += 1; if (attempts === 1) throw new Error('outlook'); return { draftId: 'draft-1', attachmentCount: 4 }; }
  });
  fill(modal, { employmentType: 'staffing', agency: 'מעוף' });
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /המדריך נוצר בהצלחה, אך הכנת המייל נכשלה/);
  assert.equal(modal.querySelector('[data-onboarding-email]').disabled, true);
  assert.equal(modal.querySelector('[data-onboarding-manager]').disabled, true);
  assert.equal(modal.querySelector('[data-onboarding-agency]').disabled, true);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'draft').length, 2);
  assert.deepEqual(calls[0][1], { fullName: 'אייל ישראלי', phone: '0501234567', email: 'new@example.org', employmentType: 'מעוף', managerName: 'גיל נאמן' });
  assert.equal(calls[1][1].instructorEmail, 'new@example.org');
  assert.equal(calls[1][1].manager.email, 'GilNeeman@think.org.il');
  assert.equal(calls[2][1].instructorEmail, 'new@example.org');
  assert.equal(calls[2][1].manager.name, 'גיל נאמן');
  assert.equal(calls[2][1].manager.email, 'GilNeeman@think.org.il');
  assert.equal(calls[2][1].employmentType, 'staffing');
});

test('desktop mail client opens only after the draft is created successfully', async () => {
  const calls = [];
  const { modal } = mountedModal({
    createInstructor: async () => { calls.push('create'); return { emp_id: 42 }; },
    createDraft: async () => { calls.push('draft'); return { draftId: 'draft-1', attachmentCount: 4 }; },
    openMailClient: () => { calls.push('desktop'); return true; }
  });
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.deepEqual(calls, ['create', 'draft', 'desktop']);
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /הטיוטה הוכנה ונשמרה ב-Outlook/);
});

test('employee folder is ensured silently between instructor creation and the unchanged Outlook draft flow', async () => {
  const calls = [];
  let opened = 0;
  const { modal, dom } = mountedModal({
    createInstructor: async () => { calls.push('create'); return { emp_id: 42, full_name: 'אייל ישראלי' }; },
    ensureEmployeeFolder: async () => { calls.push('folder'); return { folder_web_url: 'https://think365orgil.sharepoint.com/folder' }; },
    createDraft: async () => { calls.push('draft'); return { draftId: 'draft-1' }; },
    openMailClient: () => { calls.push('desktop'); return true; }
  });
  dom.window.open = () => { opened += 1; };
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.deepEqual(calls, ['create', 'folder', 'draft', 'desktop']);
  assert.equal(opened, 0);
});

test('mail retry reuses the already ensured employee folder', async () => {
  let folders = 0;
  let drafts = 0;
  const { modal } = mountedModal({
    createInstructor: async () => ({ emp_id: 42, full_name: 'אייל ישראלי' }),
    ensureEmployeeFolder: async () => { folders += 1; return { folder_web_url: 'https://think365orgil.sharepoint.com/folder' }; },
    createDraft: async () => { drafts += 1; if (drafts === 1) throw new Error('outlook'); return { draftId: 'draft-1' }; }
  });
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(folders, 1);
  assert.equal(drafts, 2);
});

test('SharePoint failure stops draft and Outlook creation', async () => {
  const calls = [];
  const { modal } = mountedModal({
    createInstructor: async () => ({ emp_id: 42, full_name: 'אייל ישראלי' }),
    ensureEmployeeFolder: async () => { throw new Error('sharepoint'); },
    createDraft: async () => { calls.push('draft'); },
    openMailClient: () => { calls.push('desktop'); }
  });
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.deepEqual(calls, []);
});

test('refresh failure remains a successful draft and cannot create another draft', async () => {
  let drafts = 0;
  const { modal } = mountedModal({
    createInstructor: async () => ({ emp_id: 42 }),
    createDraft: async () => { drafts += 1; return { draftId: 'draft-1', attachmentCount: 4 }; },
    onSuccess: async () => { throw new Error('refresh failed'); }
  });
  fill(modal);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /הטיוטה הוכנה בהצלחה.*רענון.*נכשל/);
  assert.equal(modal.querySelector('[data-onboarding-prepare]').disabled, true);
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(drafts, 1);
});

test('invalid email blocks creation', async () => {
  let creates = 0;
  const { modal } = mountedModal({ createInstructor: async () => { creates += 1; } });
  fill(modal, { email: 'not-an-email' });
  modal.querySelector('[data-onboarding-prepare]').click(); await tick();
  assert.equal(creates, 0);
  assert.match(modal.querySelector('[data-onboarding-status]').textContent, /כתובת מייל תקינה/);
});

test('implementation creates delegated drafts with TO and CC, then launches desktop mail without web draft navigation or send capability', async () => {
  const [client, edge, migration] = await Promise.all([
    readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260814150000_instructor_onboarding_atomic_create.sql', import.meta.url), 'utf8')
  ]);
  assert.match(client, /'\/me\/messages'/);
  assert.match(client, /toRecipients: \[\{ emailAddress: \{ address: instructorEmail \} \}\]/);
  assert.match(client, /ccRecipients: \[\{ emailAddress: \{ address: manager\.email \} \}\]/);
  assert.match(client, /window\.location\.href = 'mailto:'/);
  assert.match(client, /TAASIYEDA_HOURLY_RATES = Object\.freeze\(\['70', '75', '80', '85'\]\)/);
  assert.match(client, /hourly_rate: rate/);
  assert.doesNotMatch(client, /outlook\.office\.com\/mail\/drafts|reserveOnboardingMailWindow|openPreparedDraft/);
  assert.doesNotMatch(client, /sendMail|Mail\.Send/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /app_has_permission\('view_employee_files'\)/);
  assert.match(migration, /revoke execute[^;]+from anon/i);
  assert.match(migration, /max\(ci\.emp_id::bigint\).*\+ 1/s);
  assert.match(migration, /lower\(trim\(coalesce\(ci\.email/);
  assert.match(migration, /regexp_replace\(coalesce\(ci\.mobile/);
  assert.match(migration, /'yes'/);
  assert.match(edge, /BASE_FOLDER = "תיקים אישיים\/קליטת מדריך"/);
  assert.match(edge, /TAASIYEDA_HOURLY_RATES = new Set\(\["70", "75", "80", "85"\]\)/);
  assert.match(edge, /body\.hourly_rate/);
  assert.match(edge, /selectedAgreements\.length !== 1/);
  assert.doesNotMatch(edge, /sendMail/i);
});

test('SharePoint mapping keeps every direct file and excludes subfolders', () => {
  assert.equal(onboardingFolder('taasiyeda'), 'תעשיידע');
  assert.equal(onboardingFolder('staffing'), 'כוח אדם');
  assert.equal(onboardingFolder('independent'), 'עצמאי');
  const files = directFileItems([
    { id: '1', name: 'מסמך חדש.docx', file: { mimeType: 'application/docx' } },
    { id: '2', name: 'שם שהשתנה.anything', file: { mimeType: 'application/octet-stream' } },
    { id: '3', name: 'תיקיית משנה', folder: { childCount: 1 } }
  ]);
  assert.deepEqual(files.map((item) => item.id), ['1', '2']);
});

test('employee-folder Edge Function uses the existing mapping and creates the exact hierarchy before saving its URL', async () => {
  const edge = await readFile(new URL('../supabase/functions/instructor-onboarding-folder/index.ts', import.meta.url), 'utf8');
  for (const path of [
    '01 הסכם ומסמכים', '01 הסכם ומסמכים/הסכם חתום', '01 הסכם ומסמכים/מסמכים נלווים',
    '02 משובים', '02 משובים/משוב היכרות', '02 משובים/משוב אמצע שנה', '02 משובים/משוב סוף שנה',
    '03 תצפיות', '03 תצפיות/תצפית 1', '03 תצפיות/תצפית 2', '04 דוחות שכר'
  ]) assert.match(edge, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(edge, /EMPLOYEE_FILES_ROOT = "תיקים אישיים"/);
  assert.match(edge, /snapshot\?\.mapped && clean\(snapshot\?\.folder_web_url\)/);
  assert.match(edge, /"@microsoft\.graph\.conflictBehavior": "fail"/);
  assert.match(edge, /for \(const relativePath of FOLDER_PATHS\)[\s\S]+update_instructor_employee_folder_url/);
  assert.doesNotMatch(edge, /window\.open|location\.href/);
});
