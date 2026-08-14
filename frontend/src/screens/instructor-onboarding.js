import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { escapeHtml } from './shared/html.js';
import { supabase } from '../supabase-client.js';

export const ONBOARDING_DOCUMENTS = Object.freeze({
  taasiyeda: ['הסכם העסקה', 'טופס 101', 'נהלים למדריך', 'אישור משטרה'],
  staffing: ['נהלים למדריך', 'שמירה על סודיות', 'אישור משטרה']
});

const SUBJECT = 'הצטרפות לצוות המדריכים של תעשיידע – השלמת תהליך הקליטה';
const ONBOARDING_ROOT_FOLDER_URL = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/Forms/view.aspx?id=%2Fsites%2Ftaasiyeda2027%2FShared%20Documents%2F%D7%AA%D7%99%D7%A7%D7%99%D7%9D%20%D7%90%D7%99%D7%A9%D7%99%D7%99%D7%9D%2F%D7%A7%D7%9C%D7%99%D7%98%D7%AA%20%D7%9E%D7%93%D7%A8%D7%99%D7%9A&viewid=20f573d0%2D1255%2D4a8a%2Dbbf6%2Dc9c914f04e1b&FolderCTID=0x012000A5A5234B5799C3499038E27027EDF12F';
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

export function buildOnboardingMail(employmentType, manager, instructorName = '') {
  const taasiyeda = employmentType === 'taasiyeda';
  const documentLines = taasiyeda
    ? '- הסכם העסקה\n- טופס 101\n- נהלים למדריך\n- אישור משטרה (למדריכים גברים בלבד)'
    : '- נהלים למדריך\n- טופס שמירה על סודיות\n- אישור משטרה (למדריכים גברים בלבד)';
  const instruction = taasiyeda
    ? 'נבקש לעבור על הסכם ההעסקה, לחתום עליו ולהחזיר אלינו עותק חתום במייל חוזר.'
    : 'נבקש לעבור על המסמכים המצורפים, למלא ולחתום ככל שנדרש ולהחזיר אלינו את המסמכים הרלוונטיים במייל חוזר.';
  const body = `שלום ${String(instructorName || '').trim()},

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
    return Object.entries(value).map(([name, contact]) => typeof contact === 'object'
      ? ({ name, phone: String(contact?.phone || '').trim(), email: String(contact?.email || '').trim() })
      : ({ name, phone: String(contact || '').trim(), email: '' }));
  }
  return [];
}

export function onboardingManagers(settings = {}) {
  const active = Array.isArray(settings?.dropdown_options?.activities_manager_users)
    ? settings.dropdown_options.activities_manager_users.filter((item) => item?.is_active !== false)
    : [];
  const contacts = managerContactsFromSettings(settings);
  const contactByName = new Map(contacts.map((item) => [String(item?.name || '').trim(), item]));
  return active.map((item) => {
    const name = String(item?.name || '').trim();
    const contact = contactByName.get(name) || {};
    return { name, phone: String(contact.phone || '').trim(), email: String(contact.email || '').trim() };
  }).filter((item) => item.name);
}

export function onboardingModalHtml(managers = []) {
  return `<div class="instructor-onboarding" dir="rtl">
    <label><span>שם מלא</span><input class="ds-input" data-onboarding-name autocomplete="name" required></label>
    <label><span>טלפון</span><input class="ds-input" data-onboarding-phone inputmode="tel" autocomplete="tel" required></label>
    <label><span>מייל</span><input class="ds-input" data-onboarding-email type="email" autocomplete="email" required></label>
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

export async function createOnboardingInstructor(instructor) {
  const { data, error } = await supabase.rpc('create_instructor_onboarding', {
    p_full_name: instructor.fullName, p_mobile: instructor.phone, p_email: instructor.email,
    p_employment_type: instructor.employmentType, p_direct_manager: instructor.managerName
  });
  if (error) throw new Error(error.message || 'לא ניתן ליצור את המדריך.');
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.already_exists) {
    const duplicate = new Error(`המדריך כבר קיים במערכת.${result.full_name ? ` (${result.full_name})` : ''}`);
    duplicate.code = 'instructor_exists'; throw duplicate;
  }
  return result;
}

export async function createOnboardingDraft({ employmentType, manager, instructorName, instructorEmail, loginHint = '' }) {
  const mail = buildOnboardingMail(employmentType, manager, instructorName);
  const { data, error } = await supabase.functions.invoke('instructor-onboarding-files', { body: { employment_type: employmentType } });
  if (error || !data?.attachments) throw new Error(data?.message || 'לא ניתן לטעון את מסמכי הקליטה מ-SharePoint.');
  const token = await delegatedToken(loginHint);
  const draft = await graph(token, '/me/messages', {
    method: 'POST', body: JSON.stringify({
      subject: mail.subject, body: { contentType: 'Text', content: mail.body },
      toRecipients: [{ emailAddress: { address: instructorEmail } }],
      ccRecipients: [{ emailAddress: { address: manager.email } }]
    })
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

export function bindOnboardingModal(modal, { managers, loginHint, onSuccess, createInstructor = createOnboardingInstructor, createDraft = createOnboardingDraft } = {}) {
  const fullName = modal.querySelector('[data-onboarding-name]');
  const phone = modal.querySelector('[data-onboarding-phone]');
  const email = modal.querySelector('[data-onboarding-email]');
  const employment = modal.querySelector('[data-onboarding-employment]');
  const managerSelect = modal.querySelector('[data-onboarding-manager]');
  const documents = modal.querySelector('[data-onboarding-documents]');
  const prepare = modal.querySelector('[data-onboarding-prepare]');
  const folder = modal.querySelector('[data-onboarding-folder]');
  const status = modal.querySelector('[data-onboarding-status]');
  const content = modal.querySelector('.ds-modal__content');
  const footer = modal.querySelector('.ds-modal__footer');

  modal.style.width = 'min(430px, calc(100vw - 24px))';
  modal.style.maxWidth = '430px';
  modal.style.minHeight = '0';
  modal.style.height = 'auto';
  if (content) {
    content.style.minHeight = '0';
    content.style.height = 'auto';
    content.style.padding = '14px 16px 10px';
  }
  if (footer) {
    footer.style.justifyContent = 'center';
    footer.style.gap = '8px';
    footer.style.padding = '10px 14px 12px';
  }
  [folder, prepare].forEach((button) => {
    if (!button) return;
    button.style.width = '112px';
    button.style.minWidth = '112px';
    button.style.height = '32px';
    button.style.minHeight = '32px';
    button.style.padding = '4px 10px';
    button.style.fontSize = '.8rem';
    button.style.justifyContent = 'center';
  });
  folder.textContent = 'פתח תיקייה';
  prepare.textContent = 'שליחת מייל';

  const sync = () => {
    const list = ONBOARDING_DOCUMENTS[employment.value] || [];
    documents.hidden = !list.length;
    documents.querySelector('ul').innerHTML = list.map((name) => `<li>📄 ${escapeHtml(name)}</li>`).join('');
    prepare.disabled = !fullName.value.trim() || !phone.value.trim() || !email.value.trim() || !employment.value || !managerSelect.value;
    folder.disabled = false;
  };
  [fullName, phone, email].forEach((input) => input.addEventListener('input', sync));
  employment.addEventListener('change', sync); managerSelect.addEventListener('change', sync); sync();
  folder.addEventListener('click', () => {
    window.open(ONBOARDING_ROOT_FOLDER_URL, '_blank', 'noopener,noreferrer');
  });
  let createdInstructor = null;
  let onboardingSnapshot = null;
  prepare.addEventListener('click', async () => {
    let submission = onboardingSnapshot;
    if (!onboardingSnapshot) {
      const manager = managers.find((item) => item.name === managerSelect.value);
      if (!fullName.value.trim() || !phone.value.trim() || !email.value.trim() || !employment.value || !manager) return;
      if (!email.checkValidity()) { status.textContent = 'יש להזין כתובת מייל תקינה.'; return; }
      if (!manager?.phone || !manager?.email) { status.textContent = 'לא הוגדרו טלפון ומייל למנהל/ת הפעילות שנבחר/ה.'; return; }
      submission = Object.freeze({
        fullName: fullName.value.trim(), phone: phone.value.trim(), email: email.value.trim(),
        employmentType: employment.value, manager: Object.freeze({ ...manager })
      });
    }
    prepare.disabled = true; prepare.textContent = 'מכין...'; status.textContent = '';
    try {
      if (!createdInstructor) {
        createdInstructor = await createInstructor({
          fullName: submission.fullName, phone: submission.phone, email: submission.email,
          employmentType: submission.employmentType === 'taasiyeda' ? 'תעשיידע' : 'כוח אדם', managerName: submission.manager.name
        });
        onboardingSnapshot = submission;
      }
      const result = await createDraft({
        employmentType: onboardingSnapshot.employmentType, manager: onboardingSnapshot.manager,
        instructorName: onboardingSnapshot.fullName, instructorEmail: onboardingSnapshot.email, loginHint
      });
      status.textContent = 'הטיוטה הוכנה בהצלחה';
      await onSuccess?.(result, createdInstructor);
      window.open(result.webLink, '_blank', 'noopener,noreferrer');
    } catch (error) {
      status.textContent = createdInstructor && error?.code !== 'instructor_exists'
        ? 'המדריך נוצר בהצלחה, אך הכנת המייל נכשלה. ניתן לנסות שוב.'
        : String(error?.message || 'לא ניתן להכין את הטיוטה.');
    }
    finally { prepare.textContent = 'שליחת מייל'; sync(); }
  });
}
