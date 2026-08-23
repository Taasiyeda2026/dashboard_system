import { state } from './state.js';

const CARD_ATTRIBUTE = 'data-admin-staff-messages-card';

function normalize(value) {
  return String(value ?? '').trim();
}

function isAdmin() {
  return normalize(state?.user?.role || state?.user?.display_role).toLowerCase() === 'admin';
}

function messagesIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 5h16v12H8l-4 3z"/>
      <path d="M8 9h8M8 13h6"/>
    </svg>
  `;
}

function createCard() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-management-tile';
  button.setAttribute(CARD_ATTRIBUTE, 'true');
  button.innerHTML = `
    <span class="admin-management-tile__icon">${messagesIcon()}</span>
    <span class="admin-management-tile__content">
      <strong>הודעות</strong>
      <small>יצירה ותזמון הודעות לעובדים</small>
    </span>
    <span class="admin-management-tile__arrow" aria-hidden="true">‹</span>
  `;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const module = await import('./admin-messages-runtime.js?v=20260823-v1');
      await module.openAdminMessagesManager();
    } catch (error) {
      console.warn('[admin-staff-messages] manager load failed', error);
      window.alert('לא ניתן היה לפתוח את ניהול ההודעות.');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function syncMessagesCard() {
  if (!isAdmin()) {
    document.querySelectorAll(`[${CARD_ATTRIBUTE}]`).forEach((element) => element.remove());
    return;
  }
  const grid = document.querySelector('.admin-management-grid');
  if (!grid || grid.querySelector(`[${CARD_ATTRIBUTE}]`)) return;
  grid.appendChild(createCard());
}

function start() {
  syncMessagesCard();
  document.addEventListener('app:navigate', () => window.setTimeout(syncMessagesCard, 0));
  const observer = new MutationObserver(() => syncMessagesCard());
  observer.observe(document.getElementById('app') || document.documentElement, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
