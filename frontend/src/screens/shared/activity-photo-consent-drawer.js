import { uploadPhotoConsentFiles, photoConsentActivityHasFiles } from './photo-consent-client.js';
import { openActivityPhotoConsentViewer } from './activity-photo-consent-viewer.js';

function paintCamera(root, activityId, hasFile) {
  const button = root.querySelector('button[data-activity-photo-upload]');
  if (!button || String(button.dataset.activityPhotoUpload) !== String(activityId)) return;
  button.classList.toggle('is-photo-consent-saved', hasFile);
  button.dataset.photoConsentState = hasFile ? 'saved' : 'missing';
  const label = hasFile ? 'צפייה באישורי צילום' : 'העלאת אישור צילום';
  button.setAttribute('aria-label', label);
  button.title = label;
}

async function refreshCamera(root, activityId, { instructorMode = false } = {}) {
  if (instructorMode ? !String(activityId || '').trim() :
      (!Number.isSafeInteger(activityId) || activityId <= 0)) return;
  const sequence = Number(root.dataset.photoConsentCheckVersion || 0) + 1;
  root.dataset.photoConsentCheckVersion = String(sequence);
  try {
    const hasFile = await photoConsentActivityHasFiles(activityId, { instructorMode });
    // A slow request must not change the camera of a different drawer row
    // or override an upload that has already started.
    const button = root.querySelector('button[data-activity-photo-upload]');
    if (button && !button.hasAttribute('aria-busy') &&
        Number(root.dataset.photoConsentCheckVersion) === sequence) {
      paintCamera(root, activityId, hasFile);
    }
  } catch (error) {
    console.warn('[photo-consent-camera-status]', error?.message || error);
    // Unknown status is not represented as a confirmed saved file.
  }
}

export function bindActivityPhotoConsentUpload(root, notify = () => {}, { instructorMode = false } = {}) {
  if (!root) return;
  const camera = root.querySelector('button[data-activity-photo-upload]');
  const activityId = instructorMode ? String(camera?.dataset.activityPhotoUpload || '').trim() :
    Number(camera?.dataset.activityPhotoUpload);
  if (camera && (instructorMode ? !!activityId : (Number.isSafeInteger(activityId) && activityId > 0))) {
    void refreshCamera(root, activityId, { instructorMode });
  }
  // Re-rendering the drawer re-queries persisted status, but does not bind a
  // duplicate delegated click handler to the same drawer container.
  if (root.dataset.photoConsentDrawerBound === '1') return;
  root.dataset.photoConsentDrawerBound = '1';
  // Event delegation survives full drawer content replacement after detail/save.
  function openPicker(button, activityId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
    input.multiple = true;
    input.hidden = true;
    root.appendChild(input);
    const cleanup = () => { input.remove(); };
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) { cleanup(); return; }
      button.disabled = true;
      // An in-flight check from opening the drawer must not overwrite success.
      root.dataset.photoConsentCheckVersion = String(Number(root.dataset.photoConsentCheckVersion || 0) + 1);
      button.setAttribute('aria-busy', 'true');
      try {
        const saved = await uploadPhotoConsentFiles(activityId, files, ({ index, total }) => {
          notify('שומר אישור צילום ' + index + ' מתוך ' + total + '…', 'info');
        }, { instructorMode });
        if (saved.length) {
          paintCamera(root, activityId, true);
          notify(saved.length + ' קבצי אישור צילום נשמרו בהצלחה ב־SharePoint.', 'success');
        }
      } catch (error) {
        notify((error?.message || 'העלאת אישור הצילום נכשלה.') +
          ' אם נבחרו כמה קבצים, אפשר לפתוח את המצלמה שוב כדי לבדוק מה נשמר.', 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        cleanup();
        // Also covers a partly successful multi-file upload.
        void refreshCamera(root, activityId, { instructorMode });
      }
    }, { once: true });
    input.click();
  }
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-activity-photo-upload]');
    if (!button || !root.contains(button) || button.disabled) return;
    const activityId = instructorMode ? String(button.dataset.activityPhotoUpload || '').trim() :
      Number(button.dataset.activityPhotoUpload);
    if (instructorMode ? !activityId : (!Number.isSafeInteger(activityId) || activityId <= 0)) return;
    if (button.dataset.photoConsentState === 'saved') {
      button.disabled = true;
      try {
        const opened = await openActivityPhotoConsentViewer(activityId, {
          onAdd: () => openPicker(button, activityId),
          instructorMode
        });
        if (!opened) {
          // File might have been deleted in management since opening this drawer.
          paintCamera(root, activityId, false);
          openPicker(button, activityId);
        }
      } catch (error) {
        notify(error?.message || 'לא ניתן לטעון את אישורי הצילום.', 'error');
        void refreshCamera(root, activityId, { instructorMode });
      } finally {
        button.disabled = false;
      }
      return;
    }
    openPicker(button, activityId);
  });
}
