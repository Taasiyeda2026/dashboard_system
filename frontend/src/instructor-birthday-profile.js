import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const birthDates = new Map();
let loadPromise = null;
let currentInstructorId = '';
let decorateTimer = null;

function normalizeEmpId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : '';
}

function formatBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

async function loadBirthDates({ force = false } = {}) {
  if (!supabase) return birthDates;
  if (!force && birthDates.size) return birthDates;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    await waitForSupabaseAuthSession({ timeoutMs: 6000 });
    const { data, error } = await supabase
      .from('contacts_instructors')
      .select('emp_id,birth_date')
      .order('emp_id');
    if (error) throw error;

    birthDates.clear();
    (Array.isArray(data) ? data : []).forEach((row) => {
      const empId = normalizeEmpId(row?.emp_id);
      if (empId) birthDates.set(empId, String(row?.birth_date || '').trim());
    });
    return birthDates;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

async function saveBirthDate(empId, value) {
  if (!supabase) throw new Error('שירות הנתונים אינו זמין כרגע.');
  const normalizedEmpId = normalizeEmpId(empId);
  if (!normalizedEmpId) throw new Error('מזהה המדריך אינו תקין.');
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });

  const birthDate = String(value || '').trim() || null;
  const { data, error } = await supabase
    .from('contacts_instructors')
    .update({ birth_date: birthDate })
    .eq('emp_id', Number(normalizedEmpId))
    .select('emp_id,birth_date')
    .single();
  if (error) throw error;

  birthDates.set(normalizedEmpId, String(data?.birth_date || '').trim());
  return data;
}

function visibleProfileEmpId() {
  return normalizeEmpId(document.querySelector('.instructor-profile__id')?.textContent);
}

function decorateProfile() {
  const fields = document.querySelector('.instructor-profile__fields');
  if (!fields || fields.querySelector('[data-instructor-birth-date-field]')) return;

  const empId = visibleProfileEmpId() || currentInstructorId;
  if (!empId) return;
  currentInstructorId = empId;

  const field = document.createElement('div');
  field.className = 'instructor-profile__field';
  field.dataset.instructorBirthDateField = 'true';

  const label = document.createElement('span');
  label.className = 'instructor-profile__field-label';
  label.textContent = 'תאריך לידה';

  const value = document.createElement('span');
  value.className = 'instructor-profile__field-value';
  const display = formatBirthDate(birthDates.get(empId));
  value.textContent = display;
  if (display === '—') value.classList.add('instructor-profile__field-value--muted');

  field.append(label, value);
  fields.appendChild(field);
}

function decorateContactModal() {
  const saveButton = document.querySelector('[data-save-instructor-contact]');
  const modal = saveButton?.closest('.ds-modal') || document.querySelector('.ds-modal');
  const status = modal?.querySelector('[data-instructor-form-status]');
  const grid = status?.parentElement;
  if (!saveButton || !grid || grid.querySelector('[data-instructor-birth-date-input]')) return;

  const empId = currentInstructorId || visibleProfileEmpId();
  if (!empId) return;
  currentInstructorId = empId;

  const label = document.createElement('label');
  label.style.display = 'grid';
  label.style.gap = '5px';
  label.dataset.instructorBirthDateInput = 'true';

  const caption = document.createElement('span');
  caption.className = 'ds-muted';
  caption.textContent = 'תאריך לידה';

  const input = document.createElement('input');
  input.className = 'ds-input';
  input.type = 'date';
  input.name = 'birth_date';
  input.value = birthDates.get(empId) || '';
  input.dir = 'ltr';

  label.append(caption, input);
  grid.insertBefore(label, status);
}

function decorate() {
  decorateProfile();
  decorateContactModal();
}

function scheduleDecorate() {
  clearTimeout(decorateTimer);
  decorateTimer = setTimeout(() => {
    decorateTimer = null;
    decorate();
  }, 30);
}

function setStatusError(modal, error) {
  const status = modal?.querySelector('[data-instructor-form-status]');
  if (status) status.textContent = `שגיאה: ${String(error?.message || 'שמירת תאריך הלידה נכשלה.')}`;
}

function bindGlobalEvents() {
  document.addEventListener('click', (event) => {
    const profileButton = event.target?.closest?.('[data-instructor-profile]');
    if (profileButton) {
      currentInstructorId = normalizeEmpId(profileButton.dataset.instructorProfile);
      scheduleDecorate();
      return;
    }

    const editButton = event.target?.closest?.('[data-edit-instructor-contact]');
    if (editButton) {
      currentInstructorId = visibleProfileEmpId() || currentInstructorId;
      scheduleDecorate();
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-save-instructor-contact]');
    if (!button) return;

    if (button.dataset.instructorBirthDatePass === '1') {
      delete button.dataset.instructorBirthDatePass;
      return;
    }

    const modal = button.closest('.ds-modal') || document.querySelector('.ds-modal');
    const input = modal?.querySelector('[name="birth_date"]');
    const empId = currentInstructorId;
    if (!input || !empId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      button.disabled = true;
      await saveBirthDate(empId, input.value);
      button.disabled = false;
      button.dataset.instructorBirthDatePass = '1';
      button.click();
    } catch (error) {
      button.disabled = false;
      setStatusError(modal, error);
    }
  }, true);

  const root = document.getElementById('app') || document.body;
  new MutationObserver(() => scheduleDecorate()).observe(root, {
    childList: true,
    subtree: true
  });
}

async function startInstructorBirthdayProfile() {
  if (!supabase || globalThis.__INSTRUCTOR_BIRTHDAY_PROFILE_STARTED__) return;
  globalThis.__INSTRUCTOR_BIRTHDAY_PROFILE_STARTED__ = true;
  bindGlobalEvents();

  try {
    await loadBirthDates();
    decorate();
  } catch (error) {
    console.warn('[instructor-birthday-profile] load failed', {
      code: error?.code || '',
      message: error?.message || ''
    });
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) {
      birthDates.clear();
      currentInstructorId = '';
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      loadBirthDates({ force: true }).then(() => decorate()).catch(() => {});
    }
  });
}

startInstructorBirthdayProfile();
