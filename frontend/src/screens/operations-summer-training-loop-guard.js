const OPS_TRAINING_KEY = 'opsSummerTrainingActive';
let guardQueued = false;

function guardSummerTrainingLoop() {
  const panel = document.querySelector('.ops-tr');
  if (!panel) return;
  const text = String(panel.textContent || '');
  if (text.includes('טוען')) return;
  sessionStorage.removeItem(OPS_TRAINING_KEY);
}

function scheduleGuard() {
  if (guardQueued) return;
  guardQueued = true;
  setTimeout(() => {
    guardQueued = false;
    guardSummerTrainingLoop();
  }, 350);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleGuard, { once: true });
  else scheduleGuard();
  new MutationObserver(scheduleGuard).observe(document.documentElement, { childList: true, subtree: true });
}
