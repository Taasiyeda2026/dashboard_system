import { escapeHtml } from './html.js';

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const idOf = (row = {}) => text(row.row_id || row.RowID || row.id);

function manualCandidateWarnings(candidate = {}) {
  return [...new Set([
    ...(candidate.failures || []),
    ...(candidate.missingProfileData || [])
  ].map(text).filter(Boolean))];
}

function manualCandidateBlocked(candidate = {}) {
  return manualCandidateWarnings(candidate).some((reason) => /חפיפה/.test(reason));
}

export function manualCandidatePickerAccessHtml(result, state = {}) {
  const candidates = (result?.manualCandidates || result?.checked || []).filter((candidate) => emp(candidate));
  if (!candidates.length) return '';

  const open = state.courseSchedulingManualPickerOpen === true;
  const query = text(state.courseSchedulingManualSearch).toLocaleLowerCase('he-IL');
  const visible = candidates.filter((candidate) => {
    const haystack = `${candidate.instructor?.full_name || ''} ${emp(candidate)}`.toLocaleLowerCase('he-IL');
    return !query || haystack.includes(query);
  });

  return `<section class="course-scheduling-manual-picker" data-manual-picker>
    <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-toggle-manual-picker>${open ? 'סגור בחירה ידנית' : 'בחירת מדריך פעיל אחר'}</button>
    ${open ? `<div class="course-scheduling-manual-picker__panel">
      <input class="ds-input" type="search" value="${escapeHtml(state.courseSchedulingManualSearch || '')}" placeholder="חיפוש מדריך לפי שם" data-manual-candidate-search>
      <div class="course-scheduling-manual-picker__list">
        ${visible.length ? visible.map((candidate) => {
          const warnings = manualCandidateWarnings(candidate);
          const blocked = manualCandidateBlocked(candidate);
          return `<button type="button" class="course-scheduling-manual-candidate${blocked ? ' is-blocked' : ''}" data-manual-candidate="${escapeHtml(emp(candidate))}" data-manual-candidate-search-text="${escapeHtml(`${candidate.instructor?.full_name || ''} ${emp(candidate)}`.toLocaleLowerCase('he-IL'))}" ${blocked ? 'disabled' : ''}>
            <strong>${escapeHtml(candidate.instructor?.full_name || emp(candidate))}</strong>
            <span>${escapeHtml(warnings[0] || 'ניתן לבחור ידנית')}</span>
          </button>`;
        }).join('') : '<p class="ds-muted">לא נמצאו מדריכים בחיפוש.</p>'}
      </div>
    </div>` : ''}
  </section>`;
}

/**
 * Restores access to the existing manual-candidate flow on recommendation and
 * recruitment result screens. This helper only injects the existing picker
 * markup. course-scheduling.js remains the owner of all click handlers, RPCs,
 * blocking rules and draft-save behavior.
 */
export function ensureCourseSchedulingManualPickerAccess(root, { state } = {}) {
  if (!root?.querySelector || root.querySelector('[data-manual-picker]')) return;

  const detailRoot = root.querySelector('[data-course-detail]');
  const selectedCourseId = text(state?.courseSchedulingSelectedId);
  if (!detailRoot || !selectedCourseId) return;

  const result = (state?.courseSchedulingResults || []).find((item) => idOf(item?.course) === selectedCourseId);
  if (!result) return;

  const hasCandidateResults = !!(result.recommended || result.bestAvailable);
  const noEligibleCandidate = !result.recommended && result.status === 'נדרש גיוס';
  if (!hasCandidateResults && !noEligibleCandidate) return;

  const html = manualCandidatePickerAccessHtml(result, state);
  if (!html) return;

  const host = detailRoot.querySelector('[data-course-options]')
    || detailRoot.querySelector('.course-scheduling-result-block--negative')
    || detailRoot.querySelector('.course-scheduling-result-block');
  host?.insertAdjacentHTML?.('beforeend', html);
}
