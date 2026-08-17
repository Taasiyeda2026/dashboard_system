import { escapeHtml } from './shared/html.js';
import { supabase } from '../supabase-client.js';
import { delegatedMailToken, graphMailRequest } from '../microsoft/graph-mail.js';

export const ONBOARDING_DOCUMENTS = Object.freeze({
  taasiyeda: ['הסכם העסקה', 'טופס 101', 'נהלים למדריך', 'אישור משטרה'],
  staffing: ['נהלים למדריך', 'שמירה על סודיות', 'אישור משטרה'],
  independent: ['נהלים למדריך', 'שמירה על סודיות', 'אישור משטרה']
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
    <label><span>סוג העסקה</span><select class="ds-input" data-onboarding-employment><option value="">בחירה</option><option value="taasiyeda">תעשיידע</option><option value="staffing">כוח אדם</option><option value="independent">עצמאי</option></select></label>
    <label data-onboarding-agency-field hidden style="display:none"><span>חברת כוח אדם</span><select class="ds-input" data-onboarding-agency><option value="">בחירה</option><option value="מעוף">מעוף</option><option value="מנפאואר">מנפאואר</option></select></label>
    <label><span>מנהל/ת פעילות</span><select class="ds-input" data-onboarding-manager><option value="">בחירה</option>${managers.map((manager) => `<option value="${escapeHtml(manager.name)}">${escapeHtml(manager.name)}</option>`).join('')}</select></label>
    <section data-onboarding-documents hidden><strong>מסמכים שיצורפו למייל</strong><ul></ul></section>
    <p class="instructor-onboarding__status" data-onboarding-status role="status" aria-live="polite"></p>
  </div>`;
}

export function normalizeOnboardingPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? digits : '';
}

export async function createOnboardingInstructor(instructor) {
  const phone = normalizeOnboardingPhone(instructor?.phone);
  if (!phone) throw new Error('onboarding_required_fields_missing');
  const { data, error } = await supabase.rpc('create_instructor_onboarding', {
    p_full_name: instructor.fullName, p_mobile: phone, p_email: instructor.email,
    p_employment_type: instructor.employmentType, p_direct_manager: instructor.managerName
  });
  if (error) throw new Error(error.message || 'לא ניתן ליצור את המדריך.');
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.already_exists) {
    const duplicate = new Error(`המדריך כבר קיים במערכת.${result.full_name ? ` (${result.full_name})` : ''}`);
    duplicate.code = 'instructor_exists';
    duplicate.existingInstructor = result;
    throw duplicate;
  }
  return result;
}

export async function ensureOnboardingEmployeeFolder(instructor) {
  const empId = Number(instructor?.emp_id);
  const fullName = String(instructor?.full_name || instructor?.fullName || '').trim();
  if (!Number.isSafeInteger(empId) || empId <= 0 || !fullName) throw new Error('onboarding_employee_folder_fields_missing');
  const { data, error } = await supabase.functions.invoke('instructor-onboarding-folder', {
    body: { emp_id: empId, full_name: fullName, school_year: '2027' }
  });
  if (error || !data?.folder_web_url) throw new Error(data?.message || 'לא ניתן ליצור את התיק האישי ב-SharePoint.');
  return data;
}

export async function createOnboardingDraft({ employmentType, manager, instructorName, instructorEmail, loginHint = '' }) {
  const mail = buildOnboardingMail(employmentType, manager, instructorName);
  const { data, error } = await supabase.functions.invoke('instructor-onboarding-files', { body: { employment_type: employmentType } });
  if (error || !Array.isArray(data?.attachments) || !data.attachments.length) {
    throw new Error(data?.message || 'לא ניתן לטעון את מסמכי הקליטה מ-SharePoint.');
  }
  const token = await delegatedMailToken(loginHint);
  const draft = await graphMailRequest(token, '/me/messages', {
    method: 'POST', body: JSON.stringify({
      subject: mail.subject, body: { contentType: 'Text', content: mail.body },
      toRecipients: [{ emailAddress: { address: instructorEmail } }],
      ccRecipients: [{ emailAddress: { address: manager.email } }]
    })
  });
  try {
    for (const attachment of data.attachments) {
      await graphMailRequest(token, `/me/messages/${encodeURIComponent(draft.id)}/attachments`, {
        method: 'POST', body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: attachment.content_type || 'application/pdf', contentBytes: attachment.content_bytes })
      });
    }
  } catch (error) {
    await graphMailRequest(token, `/me/messages/${encodeURIComponent(draft.id)}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  return { draftId: draft.id, folderUrl: data.folder_url, attachmentCount: data.attachments.length };
}

export function openDesktopMailClient() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    window.location.href = 'mailto:';
    return true;
  } catch {
    return false;
  }
}

export function bindOnboardingModal(modal, {
  managers,
  loginHint,
  onSuccess,
  createInstructor = createOnboardingInstructor,
  ensureEmployeeFolder = ensureOnboardingEmployeeFolder,
  createDraft = createOnboardingDraft,
  openMailClient = openDesktopMailClient
} = {}) {
  const fullName = modal.querySelector('[data-onboarding-name]');
  const phone = modal.querySelector('[data-onboarding-phone]');
  const email = modal.querySelector('[data-onboarding-email]');
  const employment = modal.querySelector('[data-onboarding-employment]');
  const agencyField = modal.querySelector('[data-onboarding-agency-field]');
  const agency = modal.querySelector('[data-onboarding-agency]');
  const managerSelect = modal.querySelector('[data-onboarding-manager]');
  const documents = modal.querySelector('[data-onboarding-documents]');
  const prepare = modal.querySelector('[data-onboarding-prepare]');
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
  [prepare].forEach((button) => {
    if (!button) return;
    button.style.width = '112px';
    button.style.minWidth = '112px';
    button.style.height = '32px';
    button.style.minHeight = '32px';
    button.style.padding = '4px 10px';
    button.style.fontSize = '.8rem';
    button.style.justifyContent = 'center';
  });
  prepare.textContent = 'שליחת מייל';

  let draftCreated = false;
  const sync = () => {
    const list = ONBOARDING_DOCUMENTS[employment.value] || [];
    const staffing = employment.value === 'staffing';
    agencyField.hidden = !staffing;
    agencyField.style.display = staffing ? 'grid' : 'none';
    documents.hidden = !list.length;
    documents.querySelector('ul').innerHTML = list.map((name) => `<li>📄 ${escapeHtml(name)}</li>`).join('');
    prepare.disabled = draftCreated || !fullName.value.trim() || !normalizeOnboardingPhone(phone.value) || !email.value.trim()
      || !employment.value || (staffing && !agency.value) || !managerSelect.value;
  };
  [fullName, phone, email].forEach((input) => input.addEventListener('input', sync));
  employment.addEventListener('change', () => { if (employment.value !== 'staffing') agency.value = ''; sync(); });
  agency.addEventListener('change', sync);
  managerSelect.addEventListener('change', sync);
  sync();

  let createdInstructor = null;
  let employeeFolder = null;
  let onboardingSnapshot = null;
  prepare.addEventListener('click', async () => {
    if (draftCreated) return;
    let submission = onboardingSnapshot;
    if (!onboardingSnapshot) {
      const manager = managers.find((item) => item.name === managerSelect.value);
      const normalizedPhone = normalizeOnboardingPhone(phone.value);
      if (!fullName.value.trim() || !normalizedPhone || !email.value.trim() || !employment.value
        || (employment.value === 'staffing' && !agency.value) || !manager) return;
      if (!email.checkValidity()) { status.textContent = 'יש להזין כתובת מייל תקינה.'; return; }
      if (!manager?.phone || !manager?.email) { status.textContent = 'לא הוגדרו טלפון ומייל למנהל/ת הפעילות שנבחר/ה.'; return; }
      submission = Object.freeze({
        fullName: fullName.value.trim(), phone: normalizedPhone, email: email.value.trim(),
        employmentType: employment.value, staffingAgency: agency.value, manager: Object.freeze({ ...manager })
      });
    }

    prepare.disabled = true;
    prepare.textContent = 'מכין...';
    status.textContent = '';
    try {
      if (!createdInstructor) {
        const storedEmploymentType = submission.employmentType === 'taasiyeda'
          ? 'תעשיידע'
          : submission.employmentType === 'staffing'
            ? submission.staffingAgency
            : 'עצמאי';
        try {
          createdInstructor = await createInstructor({
            fullName: submission.fullName, phone: submission.phone, email: submission.email,
            employmentType: storedEmploymentType,
            managerName: submission.manager.name
          });
        } catch (error) {
          if (error?.code !== 'instructor_exists') throw error;
          createdInstructor = error.existingInstructor || { already_exists: true, full_name: submission.fullName };
        }
        onboardingSnapshot = submission;
        [fullName, phone, email, employment, agency, managerSelect].forEach((field) => { field.disabled = true; });
      }

      if (!employeeFolder) {
        employeeFolder = await ensureEmployeeFolder({
          emp_id: createdInstructor.emp_id,
          full_name: createdInstructor.full_name || onboardingSnapshot.fullName
        });
      }

      const result = await createDraft({
        employmentType: onboardingSnapshot.employmentType,
        manager: onboardingSnapshot.manager,
        instructorName: onboardingSnapshot.fullName,
        instructorEmail: onboardingSnapshot.email,
        loginHint
      });
      draftCreated = true;
      status.textContent = 'הטיוטה הוכנה ונשמרה ב-Outlook';
      openMailClient();
      try {
        await onSuccess?.(result, createdInstructor);
      } catch {
        status.textContent = 'הטיוטה הוכנה בהצלחה, אך רענון רשימת המדריכים נכשל.';
      }
    } catch (error) {
      status.textContent = createdInstructor && error?.code !== 'instructor_exists'
        ? 'המדריך נוצר בהצלחה, אך הכנת המייל נכשלה. ניתן לנסות שוב.'
        : String(error?.message || 'לא ניתן להכין את הטיוטה.');
    } finally {
      prepare.textContent = 'שליחת מייל';
      sync();
    }
  });
}
