import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { ONBOARDING_DOCUMENTS, buildOnboardingMail, onboardingManagers, onboardingModalHtml, bindOnboardingModal } from '../frontend/src/screens/instructor-onboarding.js';

const settings = {
  dropdown_options: { activities_manager_users: [{ name: 'מנהלת א', is_active: true }, { name: 'מנהלת ב', is_active: true }, { name: 'לא פעיל', is_active: false }] },
  activity_manager_contacts: [{ name: 'מנהלת א', phone: '050-0000001' }, { name: 'מנהלת ב', phone: '050-0000002' }]
};

test('onboarding modal has exactly two unselected choices and compact RTL markup', () => {
  const dom = new JSDOM(onboardingModalHtml(onboardingManagers(settings)));
  const root = dom.window.document.querySelector('.instructor-onboarding');
  assert.equal(root.getAttribute('dir'), 'rtl');
  assert.equal(root.querySelectorAll('select').length, 2);
  assert.equal(root.querySelector('[data-onboarding-employment]').value, '');
  assert.equal(root.querySelector('[data-onboarding-manager]').value, '');
  const footer = dom.window.document.createElement('div');
  footer.innerHTML = '<button data-onboarding-folder disabled></button><button data-onboarding-prepare disabled></button>';
  root.append(...footer.children);
  bindOnboardingModal(root, { managers: onboardingManagers(settings) });
  const employment = root.querySelector('[data-onboarding-employment]');
  employment.value = 'taasiyeda'; employment.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('[data-onboarding-documents] li').length, 4);
  employment.value = 'staffing'; employment.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('[data-onboarding-documents] li').length, 3);
  assert.equal(root.querySelector('[data-onboarding-prepare]').disabled, true);
});

test('employment kits and manager interpolation are exact', () => {
  assert.deepEqual(ONBOARDING_DOCUMENTS.taasiyeda, ['הסכם העסקה', 'טופס 101', 'נהלים למדריך', 'אישור משטרה']);
  assert.deepEqual(ONBOARDING_DOCUMENTS.staffing, ['נהלים למדריך', 'שמירה על סודיות', 'אישור משטרה']);
  const manager = onboardingManagers(settings)[0];
  const mail = buildOnboardingMail('taasiyeda', manager);
  assert.match(mail.body, /מנהלת א \| 050-0000001/);
  assert.match(mail.body, /\[שם המדריך\/ה\]/);
});

test('implementation uses delegated current-user drafts and never sends mail', async () => {
  const [client, edge, screen] = await Promise.all([
    readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8')
  ]);
  assert.match(screen, /data-open-instructor-onboarding/);
  assert.match(client, /'\/me\/messages'/);
  assert.match(client, /toRecipients: \[\]/);
  assert.doesNotMatch(client, /mailto:/i);
  assert.doesNotMatch(client, /sendMail/i);
  assert.match(edge, /BASE_FOLDER = "תיקים אישיים\/קליטת מדריך"/);
  assert.match(edge, /if \(!item\) return json/);
  assert.doesNotMatch(edge, /sendMail/i);
});
