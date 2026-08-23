import { activitiesScreen } from './screens/activities.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
import { showToast } from './screens/shared/toast.js';

const ISRAA_PANEL_SELECTOR = '.israa-mgmt .israa-activities-panel';
const sharedUi = createSharedInteractionLayer();

if (!activitiesScreen.__israaDrawerUiPatched) {
  const originalBind = activitiesScreen.bind;
  activitiesScreen.bind = function patchedIsraaActivitiesBind(args = {}) {
    const root = args?.root;
    const isIsraaPanel = root?.matches?.(ISRAA_PANEL_SELECTOR);
    if (isIsraaPanel) {
      return originalBind.call(this, { ...args, ui: sharedUi });
    }
    return originalBind.call(this, args);
  };
  Object.defineProperty(activitiesScreen, '__israaDrawerUiPatched', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

function isIsraaSelectionButton(button) {
  return Boolean(button && (button.closest('.israa-mgmt') || button.closest('.ds-drawer--israa-exact')));
}

function watchTransferResult(button) {
  if (!button || button.dataset.israaTransferFeedback === '1') return;
  button.dataset.israaTransferFeedback = '1';
  showToast('מעביר את הפעילות...', 'info', 1600);

  let finished = false;
  const finish = (success) => {
    if (finished) return;
    finished = true;
    observer.disconnect();
    delete button.dataset.israaTransferFeedback;
    if (success) showToast('הפעילות הועברה בהצלחה לפעילויות של איסראא', 'success', 3200);
  };

  const observer = new MutationObserver(() => {
    const text = String(button.textContent || '').trim();
    if (text === 'כבר בפעילויות' && button.disabled) finish(true);
  });
  observer.observe(button, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  setTimeout(() => {
    const text = String(button.textContent || '').trim();
    finish(text === 'כבר בפעילויות' && button.disabled);
  }, 8000);
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-israa-select-activity]');
  if (!isIsraaSelectionButton(button) || button.disabled) return;
  watchTransferResult(button);
}, true);
