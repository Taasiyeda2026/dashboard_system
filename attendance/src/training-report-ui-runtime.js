const TRAINING_REPORT_TYPE = 'הכשרה';
const ZOOM_LABEL = 'זום';
const LEGACY_ONLINE_LABEL = 'מקוון';

function patchTrainingModeSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  const online = [...select.options].find((option) => option.value === 'online');
  if (online && online.textContent !== ZOOM_LABEL) online.textContent = ZOOM_LABEL;
}

function removeZoomAsActivityType(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  for (const option of [...select.options]) {
    const label = String(option.value || option.textContent || '').trim();
    if (label !== ZOOM_LABEL && label !== LEGACY_ONLINE_LABEL) continue;
    // Preserve a historical Zoom record while it is being edited, but never offer
    // Zoom as a selectable activity type for a new/current report.
    if (select.value === option.value) continue;
    option.remove();
  }
}

function syncNewReportTrainingLayout() {
  const typeSelect = document.getElementById('av2-activity-type');
  if (!(typeSelect instanceof HTMLSelectElement)) return;
  const isTraining = typeSelect.value === TRAINING_REPORT_TYPE;

  const authorityWrap = document.getElementById('av2-authority-trigger')?.closest('.av2-field');
  const schoolMount = document.querySelector('.av2-report__school-mount');

  // A training report chooses training content by name only. It must never inherit
  // the school/authority of an activity instance used to build the catalog.
  if (isTraining) {
    if (authorityWrap) authorityWrap.hidden = true;
    if (schoolMount) schoolMount.hidden = true;
  }
}

function patchAttendanceTrainingUi() {
  patchTrainingModeSelect(document.getElementById('av2-training-mode'));
  patchTrainingModeSelect(document.getElementById('edit-training-mode'));
  removeZoomAsActivityType(document.getElementById('av2-activity-type'));
  removeZoomAsActivityType(document.getElementById('edit-type'));
  syncNewReportTrainingLayout();
}

function queuePatch() {
  queueMicrotask(patchAttendanceTrainingUi);
  window.setTimeout(patchAttendanceTrainingUi, 0);
}

document.addEventListener('change', (event) => {
  const id = event.target?.id;
  if (id === 'av2-activity-type' || id === 'av2-training-mode' || id === 'edit-type' || id === 'edit-training-mode') {
    queuePatch();
  }
}, true);

const observer = new MutationObserver(() => queuePatch());
observer.observe(document.documentElement, { childList: true, subtree: true });

patchAttendanceTrainingUi();
