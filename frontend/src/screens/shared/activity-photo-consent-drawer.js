import { uploadPhotoConsentFiles } from './photo-consent-client.js';

export function bindActivityPhotoConsentUpload(root, notify = () => {}) {
  if (!root || root.dataset.photoConsentDrawerBound === '1') return;
  root.dataset.photoConsentDrawerBound = '1';
  // Event delegation survives full drawer content replacement after detail/save.
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-activity-photo-upload]');
    if (!button || !root.contains(button) || button.disabled) return;
    const activityId = Number(button.dataset.activityPhotoUpload);
    if (!Number.isSafeInteger(activityId) || activityId <= 0) return;
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
      button.setAttribute('aria-busy', 'true');
      try {
        const saved = await uploadPhotoConsentFiles(activityId, files, ({ index, total }) => {
          notify('שומר אישור צילום ' + index + ' מתוך ' + total + '…', 'info');
        });
        if (saved.length) notify(saved.length + ' קבצי אישור צילום נשמרו בהצלחה ב־SharePoint.', 'success');
      } catch (error) {
        notify((error?.message || 'העלאת אישור הצילום נכשלה.') +
          ' אם הועלו כמה קבצים, ניתן לבדוק את הקבצים שנשמרו במסך אישורי צילום.', 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        cleanup();
      }
    }, { once: true });
    input.click();
  });
}
