/**
 * Lightweight toast notification — auto-dismisses after `duration` ms.
 * @param {string} message
 * @param {'success'|'error'|'info'} [kind='success']
 * @param {number} [duration=3000]
 */
export function showToast(message, kind = 'success', duration = 3000) {
  const el = document.createElement('div');
  el.className = `ds-toast ds-toast--${kind}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message;

  document.body.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => { el.classList.add('ds-toast--visible'); });
  });

  setTimeout(() => {
    el.classList.remove('ds-toast--visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }, duration);
}
