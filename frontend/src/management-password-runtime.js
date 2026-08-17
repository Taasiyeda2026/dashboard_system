import { supabase } from './supabase-client.js';
import { state } from './state.js';

const MANAGEMENT_ROLES = new Set([
  'admin',
  'operation_manager',
  'finance',
  'activities_manager',
  'domain_manager',
  'business_development_manager',
  'instructor_manager'
]);
const MIN_PASSWORD_LENGTH = 8;

let observerTimer = null;
let recoveryPromptOpened = false;

function currentRole() {
  return String(state?.user?.role || state?.user?.display_role || '').trim();
}

function isManagementUser() {
  return MANAGEMENT_ROLES.has(currentRole());
}

function ensureStyles() {
  if (document.querySelector('[data-management-password-styles]')) return;
  const style = document.createElement('style');
  style.dataset.managementPasswordStyles = '';
  style.textContent = `
    .management-password-link{display:block;margin:10px auto 0;border:0;background:transparent;color:#475569;font:inherit;font-size:.84rem;text-decoration:underline;cursor:pointer}
    .management-password-link:hover{color:#0f172a}
    .management-password-trigger{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:inherit;cursor:pointer;font-size:16px}
    .management-password-trigger:hover{background:rgba(148,163,184,.16)}
    .management-password-modal{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.42);backdrop-filter:blur(2px)}
    .management-password-card{direction:rtl;width:min(420px,calc(100vw - 28px));display:grid;gap:12px;padding:20px;border-radius:14px;background:#fff;box-shadow:0 22px 60px rgba(15,23,42,.24)}
    .management-password-card h2{margin:0;font-size:1.1rem;color:#172033}.management-password-card p{margin:0;color:#64748b;font-size:.86rem;line-height:1.5}
    .management-password-card label{display:grid;gap:5px;font-size:.82rem;font-weight:700;color:#334155}.management-password-card input{box-sizing:border-box;width:100%;height:40px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;direction:ltr;text-align:left}
    .management-password-actions{display:flex;gap:8px;justify-content:flex-start;margin-top:2px}.management-password-actions button{min-height:36px;padding:7px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;font:inherit}.management-password-actions .is-primary{border-color:#1d4ed8;background:#1d4ed8;color:#fff}
    .management-password-status{min-height:20px;color:#475569;font-size:.82rem}.management-password-status.is-error{color:#b91c1c}.management-password-status.is-success{color:#047857}
  `;
  document.head.appendChild(style);
}

function closeModal(modal) {
  modal?.remove();
}

function modalShell(title, note = '') {
  const modal = document.createElement('div');
  modal.className = 'management-password-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const card = document.createElement('section');
  card.className = 'management-password-card';
  const heading = document.createElement('h2');
  heading.textContent = title;
  card.appendChild(heading);
  if (note) {
    const paragraph = document.createElement('p');
    paragraph.textContent = note;
    card.appendChild(paragraph);
  }
  modal.appendChild(card);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
  document.body.appendChild(modal);
  return { modal, card };
}

function statusNode() {
  const node = document.createElement('div');
  node.className = 'management-password-status';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  return node;
}

function actionsRow(primaryLabel, onPrimary, onCancel) {
  const actions = document.createElement('div');
  actions.className = 'management-password-actions';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'is-primary';
  primary.textContent = primaryLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'ביטול';
  primary.addEventListener('click', onPrimary);
  cancel.addEventListener('click', onCancel);
  actions.append(primary, cancel);
  return { actions, primary, cancel };
}

function labeledInput(labelText, { type = 'text', autocomplete = '', placeholder = '' } = {}) {
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.autocomplete = autocomplete;
  input.placeholder = placeholder;
  label.append(span, input);
  return { label, input };
}

function openForgotPasswordModal() {
  if (document.querySelector('.management-password-modal')) return;
  const { modal, card } = modalShell(
    'שכחתי קוד כניסה',
    'הזינו את המייל הארגוני שלכם. אם החשבון מורשה, יישלח אליו קישור מאובטח להגדרת קוד חדש.'
  );
  const { label, input } = labeledInput('מייל ארגוני', {
    type: 'email',
    autocomplete: 'email',
    placeholder: 'name@think.org.il'
  });
  const status = statusNode();
  const { actions, primary } = actionsRow('שליחת קישור', async () => {
    const email = String(input.value || '').trim().toLowerCase();
    status.className = 'management-password-status';
    status.textContent = '';
    if (!email || !email.endsWith('@think.org.il')) {
      status.classList.add('is-error');
      status.textContent = 'יש להזין מייל ארגוני תקין.';
      return;
    }
    primary.disabled = true;
    primary.textContent = 'שולח...';
    try {
      await supabase?.functions?.invoke('management-password-reset', { body: { email } });
      status.classList.add('is-success');
      status.textContent = 'אם החשבון נמצא ומורשה, קישור לאיפוס הסיסמה נשלח למייל הארגוני.';
    } catch {
      // Keep the response generic so the screen does not disclose account existence.
      status.classList.add('is-success');
      status.textContent = 'אם החשבון נמצא ומורשה, קישור לאיפוס הסיסמה נשלח למייל הארגוני.';
    } finally {
      primary.disabled = false;
      primary.textContent = 'שליחת קישור';
    }
  }, () => closeModal(modal));
  card.append(label, status, actions);
  requestAnimationFrame(() => input.focus());
}

async function saveNewPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

function openPasswordChangeModal({ recovery = false } = {}) {
  if (document.querySelector('.management-password-modal')) return;
  const { modal, card } = modalShell(
    recovery ? 'הגדרת קוד כניסה חדש' : 'החלפת קוד כניסה',
    `הקוד החדש חייב להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`
  );
  const first = labeledInput('קוד חדש', { type: 'password', autocomplete: 'new-password' });
  const second = labeledInput('אימות קוד חדש', { type: 'password', autocomplete: 'new-password' });
  const status = statusNode();
  const { actions, primary } = actionsRow(recovery ? 'שמירה והתחברות מחדש' : 'שמירה', async () => {
    const password = String(first.input.value || '');
    const confirmation = String(second.input.value || '');
    status.className = 'management-password-status';
    status.textContent = '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      status.classList.add('is-error');
      status.textContent = `הקוד חייב להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
      return;
    }
    if (password !== confirmation) {
      status.classList.add('is-error');
      status.textContent = 'הקודים אינם זהים.';
      return;
    }
    primary.disabled = true;
    primary.textContent = 'שומר...';
    try {
      await saveNewPassword(password);
      status.classList.add('is-success');
      status.textContent = 'קוד הכניסה עודכן בהצלחה.';
      if (recovery) {
        setTimeout(async () => {
          await supabase.auth.signOut().catch(() => {});
          window.location.replace(`${window.location.origin}${window.location.pathname}`);
        }, 800);
      } else {
        setTimeout(() => closeModal(modal), 700);
      }
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = error?.message || 'עדכון קוד הכניסה נכשל.';
      primary.disabled = false;
      primary.textContent = recovery ? 'שמירה והתחברות מחדש' : 'שמירה';
    }
  }, () => closeModal(modal));
  card.append(first.label, second.label, status, actions);
  requestAnimationFrame(() => first.input.focus());
}

function injectForgotPasswordLink() {
  const form = document.querySelector('#loginForm');
  if (!form || form.querySelector('[data-management-forgot-password]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'management-password-link';
  button.dataset.managementForgotPassword = '';
  button.textContent = 'שכחתי קוד כניסה';
  button.addEventListener('click', openForgotPasswordModal);
  form.appendChild(button);
}

function injectPasswordChangeButton() {
  document.querySelectorAll('[data-management-change-password]').forEach((node) => {
    if (!isManagementUser()) node.remove();
  });
  if (!isManagementUser()) return;
  const logout = document.querySelector('#logoutBtn');
  if (!logout || document.querySelector('[data-management-change-password]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'management-password-trigger';
  button.dataset.managementChangePassword = '';
  button.title = 'החלפת קוד כניסה';
  button.setAttribute('aria-label', 'החלפת קוד כניסה');
  button.textContent = '🔑';
  button.addEventListener('click', () => openPasswordChangeModal({ recovery: false }));
  logout.parentElement?.insertBefore(button, logout);
}

function syncUi() {
  ensureStyles();
  injectForgotPasswordLink();
  injectPasswordChangeButton();
}

function scheduleSync() {
  if (observerTimer) return;
  observerTimer = setTimeout(() => {
    observerTimer = null;
    syncUi();
  }, 60);
}

function recoveryHintInUrl() {
  const hash = String(window.location.hash || '').toLowerCase();
  const search = String(window.location.search || '').toLowerCase();
  return hash.includes('type=recovery') || search.includes('type=recovery');
}

function openRecoveryPrompt() {
  if (recoveryPromptOpened) return;
  recoveryPromptOpened = true;
  setTimeout(() => openPasswordChangeModal({ recovery: true }), 0);
}

if (typeof document !== 'undefined') {
  ensureStyles();
  syncUi();
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (supabase?.auth) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') openRecoveryPrompt();
    scheduleSync();
  });
  if (typeof window !== 'undefined' && recoveryHintInUrl()) {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) openRecoveryPrompt();
    }).catch(() => {});
  }
}
