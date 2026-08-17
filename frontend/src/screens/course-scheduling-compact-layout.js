import './course-scheduling-compact-layout.css';
import './course-scheduling-density-polish.css';

let enhancementScheduled = false;
let pendingFindCourseId = '';

function statusText(card) {
  return String(card.querySelector('.course-scheduling-status-chip')?.textContent || '').trim();
}

function isNativeCompactRow(card) {
  return card.classList.contains('course-scheduling-compact-row');
}

function instructorLabelFor(status) {
  if (status === 'שובץ') return 'שובץ';
  if (status === 'שמור כטיוטה') return 'טיוטת מדריך';
  return 'טרם שובץ';
}

function actionLabelFor(status) {
  if (status === 'שובץ') return 'החלף מדריך';
  if (status === 'שמור כטיוטה') return 'פתח טיוטה';
  if (status === 'נמצאה המלצה') return 'בדוק מדריכים';
  return 'מצא מדריך';
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function triggerFindAction(screen, courseId) {
  if (!courseId) return false;
  const selected = screen.querySelector(`[data-course-card="${cssEscape(courseId)}"].is-selected`);
  const findButton = screen.querySelector('[data-course-detail] [data-find-instructors]');
  if (!selected || !findButton || findButton.disabled) return false;
  pendingFindCourseId = '';
  findButton.click();
  return true;
}

function createTableHeader(coursesRoot) {
  if (coursesRoot.querySelector(':scope > .course-scheduling-compact-table-head')) return;
  const header = document.createElement('div');
  header.className = 'course-scheduling-compact-table-head';
  header.setAttribute('aria-hidden', 'true');
  header.innerHTML = '<span>בית ספר</span><span>רשות</span><span>קורס</span><span>סטטוס</span>';
  coursesRoot.prepend(header);
}

function enhanceCourseCard(screen, card) {
  const courseId = String(card.dataset.courseCard || '').trim();
  if (isNativeCompactRow(card)) {
    card.classList.toggle('is-selected', card.classList.contains('is-selected'));
    card.querySelector('[data-course-row-action]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      pendingFindCourseId = courseId;
      if (card.classList.contains('is-selected')) {
        triggerFindAction(screen, courseId);
        return;
      }
      card.click();
    }, { once: true });
    return;
  }
  if (card.closest('.course-scheduling-compact-row')) return;

  const status = statusText(card);
  const metas = card.querySelectorAll('.course-scheduling-course-card-meta');
  const schoolMeta = metas[0];
  const dateMeta = metas[1];

  if (schoolMeta) {
    const original = String(schoolMeta.textContent || '').trim();
    schoolMeta.title = original;
    schoolMeta.textContent = original.split(' · ')[0] || original;
    schoolMeta.classList.add('course-scheduling-compact-school');
  }
  if (dateMeta) dateMeta.classList.add('course-scheduling-compact-secondary');

  const instructor = document.createElement('span');
  instructor.className = 'course-scheduling-compact-instructor';
  instructor.textContent = instructorLabelFor(status);
  card.append(instructor);

  const row = document.createElement('div');
  row.className = `course-scheduling-compact-row${card.classList.contains('is-selected') ? ' is-selected' : ''}`;
  card.parentNode.insertBefore(row, card);
  row.append(card);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'course-scheduling-compact-action';
  action.textContent = actionLabelFor(status);
  action.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (status === 'שובץ' || status === 'שמור כטיוטה') {
      card.click();
      return;
    }

    pendingFindCourseId = courseId;
    if (card.classList.contains('is-selected')) {
      triggerFindAction(screen, courseId);
      return;
    }
    card.click();
  });
  row.append(action);
}

function detailHasOperationalContent(detail) {
  if (!detail) return false;
  return Boolean(detail.querySelector(
    '.course-scheduling-instructor-card, .course-scheduling-loading, .course-scheduling-result-block, '
    + '.course-scheduling-alternatives, .course-scheduling-details, [data-assign-course], '
    + '[data-save-draft], [data-confirm-draft], [data-cancel-draft]'
  ));
}

function enhanceScreen(screen) {
  if (screen.dataset.csTab !== 'courses') {
    screen.classList.remove('is-compact-symmetric-layout');
    return;
  }

  screen.classList.add('is-compact-symmetric-layout');
  const coursesRoot = screen.querySelector('.course-scheduling-courses');
  if (!coursesRoot) return;

  createTableHeader(coursesRoot);
  coursesRoot.querySelectorAll('[data-course-card]').forEach((card) => enhanceCourseCard(screen, card));

  const rows = coursesRoot.querySelectorAll('.course-scheduling-compact-row');
  rows.forEach((row) => {
    if (row.matches('[data-course-card]')) return;
    row.classList.toggle('is-selected', Boolean(row.querySelector('[data-course-card].is-selected')));
  });

  const groups = coursesRoot.querySelectorAll('.course-scheduling-course-group');
  coursesRoot.classList.toggle('has-single-group', groups.length === 1);

  const detail = screen.querySelector('[data-course-detail]');
  if (detail) detail.classList.toggle('has-compact-results', detailHasOperationalContent(detail));

  if (pendingFindCourseId) triggerFindAction(screen, pendingFindCourseId);
}

function runEnhancement() {
  enhancementScheduled = false;
  document.querySelectorAll('.course-scheduling-screen').forEach(enhanceScreen);
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(runEnhancement);
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
} else {
  scheduleEnhancement();
}
