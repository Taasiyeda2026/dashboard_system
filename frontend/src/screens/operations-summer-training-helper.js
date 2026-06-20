const OPS_TRAINING_KEY = 'opsSummerTrainingActive';
let trainingHelperQueued = false;

function stopSummerTrainingRepeat() {
  const panel = document.querySelector('.ops-tr');
  if (!panel) return;
  const text = String(panel.textContent || '');
  if (text.includes('טוען')) return;
  sessionStorage.removeItem(OPS_TRAINING_KEY);
}

function scheduleTrainingHelper() {
  if (trainingHelperQueued) return;
  trainingHelperQueued = true;
  setTimeout(() => {
    trainingHelperQueued = false;
    stopSummerTrainingRepeat();
  }, 350);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleTrainingHelper, { once: true });
  else scheduleTrainingHelper();
  new MutationObserver(scheduleTrainingHelper).observe(document.documentElement, { childList: true, subtree: true });
}
