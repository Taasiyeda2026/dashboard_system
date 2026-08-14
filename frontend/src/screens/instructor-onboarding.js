import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { escapeHtml } from './shared/html.js';
import { supabase } from '../supabase-client.js';

export const ONBOARDING_DOCUMENTS = Object.freeze({
  taasiyeda: ['הסכם העסקה', 'טופס 101', 'נהלים למדריך', 'אישור משטרה'],
  staffing: ['נהלים למדריך', 'שמירה על סודיות', 'אישור משטרה']
});

const SUBJECT = 'הצטרפות לצוות המדריכים של תעשיידע – השלמת תהליך הקליטה';
const AVAILABILITY = `לצורך תכנון השיבוצים והפעילויות, נבקש להשיב למייל זה ולמלא את פרטי הזמינות שלך בצורה מלאה ככל האפשר:

מועד שממנו ניתן להתחיל להדריך:
תאריך: _______________

זמינות קבועה במהלך השבוע:

יום א׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______
יום ב׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______
יום ג׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______
יום ד׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______
יום ה׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______
יום ו׳ – פנוי/ה: כן / לא | משעה: _______ | עד שעה: _______

אילוצים קבועים שחשוב שנכיר:

---

תאריכים קרובים שבהם ידוע מראש שלא תהיה זמינות:

---`;

export function buildOnboardingMail(employmentType, manager) {
  const taasiyeda = employmentType === 'taasiyeda';
  const documentLines = taasiyeda
    ? '- הסכם העסקה\n- טופס 101\n- נהלים למדריך\n- אישור משטרה (למדריכים גברים בלבד)'
    : '- נהלים למדריך\n- טופס שמירה על סודיות\n- אישור משטרה (למדריכים גברים בלבד)';
  const instruction = taasiyeda
    ? 'נבקש לעבור על הסכם ההעסקה, לחתום עליו ולהחזיר אלינו עותק חתום במייל חוזר.'
    : 'נבקש לעבור על המסמכים המצורפים, למלא ולחתום ככל שנדרש ולהחזיר אלינו את המסמכים הרלוונטיים במייל חוזר.';
  const body = `שלום [שם המדריך/ה],

שמחים על הצטרפותך לצוות המדריכים של תעשיידע.

מצורפים למייל המסמכים הנדרשים לצורך השלמת תהליך הקליטה:

${documentLines}

${instruction}

את כלל המסמכים הנדרשים לתהליך הקליטה, כשהם מלאים וחתומים ככל שנדרש, יש להשלים ולהחזיר אלינו לא יאוחר מיום לפני תחילת העבודה.

${AVAILABILITY}

מנהל/ת הפעילות שלך:
${manager.name} | ${manager.phone}

מנהל/ת הפעילות הוא/היא המנהל/ת הישיר/ה שלך והכתובת המרכזית לכל שאלה או עניין שוטף בעבודה.

בימים הקרובים ייצרו איתך קשר לתיאום מועד ההכשרה לקראת תחילת ההדרכות.

נשמח ללוות אותך בתחילת הדרך בתעשיידע. לכל שאלה או צורך ניתן לפנות אלינו.

בהצלחה וברוכים הבאים לצוות תעשיידע!`;
  return { subject: SUBJECT, body };
}

export function managerContactsFromSettings(settings = {}) {
  const value = settings.activity_manager_contacts;
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([name, phone]) => ({ name, phone: String(phone || '').trim() }));
  }
  return [];
}

export function onboardingManagers(settings = {}) {
  const active = Array.isArray(settings?.dropdown_options?.activities_manager_users)
    ? settings.dropdown_options.activities_manager_users.filter((item) => item?.is_active !== false)
    : [];
  const contacts = managerContactsFromSettings(settings);
  const phones = new Map(contacts.map((item) => [String(item?.name || '').trim(), String(item?.phone || '').trim()]));
  return active.map((item) => ({ name: String(item?.name || '').trim(), phone: phones.get(String(item?.name || '').trim()) || '' })).filter((item) => item.name);
}

export function onboardingModalHtml(managers = []) {
  return `<div class="instructor-onboarding" dir="rtl">
    <label><span>סוג העסקה</span><select class="ds-input" data-onboarding-employment><option value="">בחירה</option><option value="taasiyeda">תעשיידע</option><option value="staffing">כוח אדם</option></select></label>
    <label><span>מנהל/ת פעילות</span><select class="ds-input" data-onboarding-manager><option value="">בחירה</option>${managers.map((manager) => `<option value="${escapeHtml(manager.name)}">${escapeHtml(manager.name)}</option>`).join('')}</select></label>
    <section data-onboarding-documents hidden><strong>מסמכים שיצורפו למייל</strong><ul></ul></section>
    <p class="instructor-onboarding__status" data-onboarding-status role="status" aria-live="polite"></p>
  </div>`;
}

let msalClient;
function microsoftConfig() {
  const runtime = globalThis.__DASHBOARD_CONFIG__ || {};
  return {
    clientId: String(import.meta.env?.VITE_MICROSOFT_CLIENT_ID || runtime.microsoftClientId || '').trim(),
    tenantId: String(import.meta.env?.VITE_MICROSOFT_TENANT_ID || runtime.microsoftTenantId || '').trim(),
    redirectUri: String(import.meta.env?.VITE_MICROSOFT_REDIRECT_URI || runtime.microsoftRedirectUri || globalThis.location?.origin || '').trim()
  };
}

async function delegatedToken(loginHint = '') {
  const config = microsoftConfig();
  if (!config.clientId || !config.tenantId) throw new Error('חיבור Microsoft 365 טרם הוגדר במערכת.');
  if (!msalClient) {
    msalClient = new PublicClientApplication({
      auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`, redirectUri: config.redirectUri },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
    });
    await msalClient.initialize();
    await msalClient.handleRedirectPromise();
  }
  const request = { scopes: ['Mail.ReadWrite'], loginHint: loginHint || undefined };
  const account = msalClient.getAllAccounts()[0];
  if (account) {
    try { return (await msalClient.acquireTokenSilent({ ...request, account })).accessToken; }
    catch (error) { if (!(error instanceof InteractionRequiredAuthError)) throw error; }
  }
  return (await msalClient.acquireTokenPopup(request)).accessToken;
}

async function graph(token, path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error('Microsoft Outlook לא הצליח להכין את הטיוטה. יש לנסות שוב.');
  return response.status === 204 ? null : response.json();
}

export async function createOnboardingDraft({ employmentType, manager, loginHint = '' }) {
  const mail = buildOnboardingMail(employmentType, manager);
  const { data, error } = await supabase.functions.invoke('instructor-onboarding-files', { body: { employment_type: employmentType } });
  if (error || !data?.attachments) throw new Error(data?.message || 'לא ניתן לטעון את מסמכי הקליטה מ-SharePoint.');
  const token = await delegatedToken(loginHint);
  const draft = await graph(token, '/me/messages', {
    method: 'POST', body: JSON.stringify({ subject: mail.subject, body: { contentType: 'Text', content: mail.body }, toRecipients: [] })
  });
  try {
    for (const attachment of data.attachments) {
      await graph(token, `/me/messages/${encodeURIComponent(draft.id)}/attachments`, {
        method: 'POST', body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: attachment.content_type || 'application/pdf', contentBytes: attachment.content_bytes })
      });
    }
  } catch (error) {
    await graph(token, `/me/messages/${encodeURIComponent(draft.id)}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  return { webLink: draft.webLink || 'https://outlook.office.com/mail/drafts', folderUrl: data.folder_url };
}

export function bindOnboardingModal(modal, { managers, loginHint, onSuccess } = {}) {
  const employment = modal.querySelector('[data-onboarding-employment]');
  const managerSelect = modal.querySelector('[data-onboarding-manager]');
  const documents = modal.querySelector('[data-onboarding-documents]');
  const prepare = modal.querySelector('[data-onboarding-prepare]');
  const folder = modal.querySelector('[data-onboarding-folder]');
  const status = modal.querySelector('[data-onboarding-status]');
  const sync = () => {
    const list = ONBOARDING_DOCUMENTS[employment.value] || [];
    documents.hidden = !list.length;
    documents.querySelector('ul').innerHTML = list.map((name) => `<li>📄 ${escapeHtml(name)}</li>`).join('');
    prepare.disabled = !employment.value || !managerSelect.value;
    folder.disabled = !employment.value;
  };
  employment.addEventListener('change', sync); managerSelect.addEventListener('change', sync); sync();
  folder.addEventListener('click', async () => {
    const { data, error } = await supabase.functions.invoke('instructor-onboarding-files', { body: { employment_type: employment.value, folder_only: true } });
    if (error || !data?.folder_url) { status.textContent = 'לא ניתן לפתוח את תיקיית הקליטה.'; return; }
    window.open(data.folder_url, '_blank', 'noopener,noreferrer');
  });
  prepare.addEventListener('click', async () => {
    const manager = managers.find((item) => item.name === managerSelect.value);
    if (!manager?.phone) { status.textContent = 'לא הוגדר מספר טלפון למנהל/ת הפעילות שנבחר/ה.'; return; }
    prepare.disabled = true; prepare.textContent = 'מכין טיוטה...'; status.textContent = '';
    try {
      const result = await createOnboardingDraft({ employmentType: employment.value, manager, loginHint });
      status.textContent = 'הטיוטה הוכנה בהצלחה';
      onSuccess?.(result);
      window.open(result.webLink, '_blank', 'noopener,noreferrer');
    } catch (error) { status.textContent = String(error?.message || 'לא ניתן להכין את הטיוטה.'); }
    finally { prepare.textContent = 'הכן מייל ב-Outlook'; sync(); }
  });
}
