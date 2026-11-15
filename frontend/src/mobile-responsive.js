const MOBILE_QUERY = '(max-width: 820px)';
const ownedAttributes = new WeakMap();
const filterHandlers = new WeakMap();
const COMPACT_NAV = '.shell-header-nav, .instructors-workspace-tabs, .ds-ops-mgmt-tabs, .ifb-tabs, [data-manager-workspace-tabs]';
let expandedActivityCards = false;
let selectedWeekDate = '';
let fullWeek = false;

function rememberAttributes(element, names) {
  if (!ownedAttributes.has(element)) {
    ownedAttributes.set(element, new Map(names.map((name) => [name, element.hasAttribute(name) ? element.getAttribute(name) : null])));
  }
}

function restoreAttributes(element) {
  const originals = ownedAttributes.get(element);
  if (!originals) return;
  originals.forEach((value, name) => {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  });
  ownedAttributes.delete(element);
}

function setIfChanged(element, name, value) {
  if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
}

function directCells(row) {
  return Array.from(row?.children || []).filter((cell) => cell.matches?.('td, th'));
}

export function activeFilterCount(toolbar) {
  if (!toolbar) return 0;
  return Array.from(toolbar.querySelectorAll('select, input:not([type="search"]):not([type="button"]):not([type="submit"])'))
    .filter((control) => {
      if (control.disabled) return false;
      if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
      const value = String(control.value || '').trim();
      return value !== '' && value !== 'all';
    }).length;
}

function updateFilterButton(toolbar) {
  const button = toolbar.querySelector(':scope > [data-mobile-filter-toggle]');
  if (!button) return;
  const panel = toolbar.closest('.ds-activities-screen')?.querySelector('[data-activities-advanced-panel]');
  const count = activeFilterCount(toolbar) + activeFilterCount(panel);
  const label = count ? `סינון (${count})` : 'סינון';
  if (button.textContent !== label) button.textContent = label;
  setIfChanged(button, 'aria-expanded', toolbar.classList.contains('is-mobile-expanded'));
}

export function syncFilterToolbar(toolbar) {
  if (!toolbar) return;
  // Activities already owns an advanced disclosure. Reuse that exact control
  // for all mobile filters; do not create a second competing button.
  const originalToggle = toolbar.matches('.ds-activities-main-toolbar')
    ? toolbar.querySelector('[data-activities-advanced-toggle]') : null;
  if (originalToggle) {
    toolbar.querySelector(':scope > [data-mobile-filter-toggle]')?.remove();
    toolbar.dataset.mobileFiltersReady = '1';
    const open = originalToggle.getAttribute('aria-expanded') === 'true';
    if (toolbar.classList.contains('is-mobile-expanded') !== open) toolbar.classList.toggle('is-mobile-expanded', open);
    Array.from(toolbar.children).forEach((child) => {
      if (child !== originalToggle && !child.matches('input[type="search"], .ds-pa-search, .ds-filter-field--search')) child.classList.add('mobile-filter-detail');
    });
    return;
  }
  let button = toolbar.querySelector(':scope > [data-mobile-filter-toggle]');
  if (!button) {
    button = toolbar.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'ds-btn ds-btn--sm ds-btn--ghost mobile-filter-toggle';
    button.dataset.mobileFilterToggle = '1';
    toolbar.insertBefore(button, Array.from(toolbar.children).find((child) => !child.matches?.('input[type="search"], .ds-pa-search, .ds-filter-field--search')) || null);
  }
  toolbar.dataset.mobileFiltersReady = '1';
  Array.from(toolbar.children).forEach((child) => {
    // Keep the icon-only advanced filters control accessible on mobile, even
    // while the standard toolbar filters are collapsed behind their toggle.
    const alwaysVisible = child.matches?.('input[type="search"], .ds-pa-search, .ds-filter-field--search, [data-activities-advanced-toggle]');
    if (child !== button && !alwaysVisible) child.classList.add('mobile-filter-detail');
    if (alwaysVisible) child.classList.remove('mobile-filter-detail');
  });
  if (!filterHandlers.has(toolbar)) {
    const handler = () => updateFilterButton(toolbar);
    toolbar.addEventListener('change', handler);
    filterHandlers.set(toolbar, handler);
  }
  updateFilterButton(toolbar);
}

export const enhanceFilterToolbar = syncFilterToolbar;

export function syncCompactNavigation(nav) {
  if (!nav) return;
  let toggle = nav.previousElementSibling?.matches?.('[data-mobile-section-nav-toggle]') ? nav.previousElementSibling : null;
  if (!toggle) {
    toggle = nav.ownerDocument.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-section-nav-toggle';
    toggle.dataset.mobileSectionNavToggle = '1';
    const id = nav.id || `mobile-section-nav-${Math.random().toString(36).slice(2, 9)}`;
    if (!nav.id) {
      rememberAttributes(nav, ['id']);
      nav.id = id;
    }
    toggle.setAttribute('aria-controls', id);
    toggle.setAttribute('aria-expanded', 'false');
    nav.parentNode?.insertBefore(toggle, nav);
  }
  nav.dataset.mobileNavReady = '1';
  const active = nav.querySelector('.is-active, [aria-selected="true"], [aria-pressed="true"]');
  const label = nav.matches('.shell-header-nav') ? 'ניווט מהיר ▾' : `${active?.textContent?.trim() || nav.getAttribute('aria-label') || 'בחירת אזור'} ▾`;
  if (toggle.textContent !== label) toggle.textContent = label;
  if (nav.matches('.shell-header-nav')) {
    // The permitted original route button remains the only navigation source.
    // A mobile shortcut forwards to that button, including its existing handlers.
    const original = nav.querySelector('[data-route="activities"]');
    let shortcut = toggle.previousElementSibling?.matches('[data-mobile-primary-activities]') ? toggle.previousElementSibling : null;
    if (original) {
      if (!shortcut) {
        shortcut = nav.ownerDocument.createElement('button');
        shortcut.type = 'button';
        shortcut.className = 'mobile-primary-activities';
        shortcut.dataset.mobilePrimaryActivities = '1';
        shortcut.textContent = 'פעילויות';
        shortcut.addEventListener('click', () => nav.querySelector('[data-route="activities"]')?.click());
        toggle.before(shortcut);
      }
      const active = original.classList.contains('is-active');
      if (shortcut.classList.contains('is-active') !== active) shortcut.classList.toggle('is-active', active);
      if (active) setIfChanged(shortcut, 'aria-current', 'page');
      else if (shortcut.hasAttribute('aria-current')) shortcut.removeAttribute('aria-current');
      if (shortcut.disabled !== original.disabled) shortcut.disabled = original.disabled;
    } else shortcut?.remove();
  }
}

export const enhanceCompactNavigation = syncCompactNavigation;

function mobileFieldKind(kind, label, index) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (kind === 'activities') {
    if (/תוכנית|סוג|רשות|בית ספר|מדריך|מנהל|סטטוס|כיתה|המפגש הבא|תאריך סיום/.test(text)) return 'primary';
    if (/תאריך פעילות|תאריך התחלה/.test(text)) return 'primary';
    return 'detail';
  }
  if (kind === 'proposals') {
    if (/תחום|מס|רשות|בית הספר|סוג הצעה|תאריך|סטטוס|סה״כ|פעולות/.test(text)) return 'primary';
    return 'detail';
  }
  return index === 0 ? 'primary' : 'detail';
}

export function enhanceExpandableTable(table, kind = 'generic') {
  if (!table) return;
  table.dataset.mobileTableReady = '1';
  table.dataset.mobileTableKind = kind;
  const labels = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim());
  Array.from(table.querySelectorAll('tbody > tr')).forEach((row) => {
    if (row.dataset.mobileExpandableRow !== '1') {
      rememberAttributes(row, ['aria-expanded']);
      row.dataset.mobileExpandableRow = '1';
      setIfChanged(row, 'aria-expanded', 'false');
    }
    directCells(row).forEach((cell, index) => {
      if (labels[index]) cell.dataset.mobileLabel = labels[index];
      cell.dataset.mobileField = mobileFieldKind(kind, labels[index], index);
      if (kind === 'activities' && !cell.matches('.ds-activities-col--program')) {
        const value = cell.textContent.replace(/\s+/g, ' ').trim();
        const empty = /^(?:איש קשר\s*)?(?:[-—–]|לא משויך)?$/.test(value) && !cell.querySelector('button, a, input, select, textarea');
        setIfChanged(cell, 'data-mobile-empty', empty);
      }
    });
    const firstCell = directCells(row)[0];
    // The 2027 compact card has a direct details action; no duplicate disclosure.
    if (kind === 'activities' && firstCell?.querySelector('[data-mobile-2027-card]')) {
      firstCell.querySelector('[data-mobile-row-toggle]')?.remove();
      return;
    }
    const disclosureHost = firstCell?.querySelector('.activity-mobile-summary__actions') || firstCell;
    if (!disclosureHost || disclosureHost.querySelector(':scope > [data-mobile-row-toggle]')) return;
    const toggle = table.ownerDocument.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-row-toggle';
    toggle.dataset.mobileRowToggle = '1';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'הצגת פרטים נוספים');
    toggle.textContent = kind === 'activities' ? 'עוד מידע ▾' : 'פרטים ▾';
    disclosureHost.append(toggle);
  });
}

export function enhanceClientQueues(root) {
  root.querySelectorAll('.ds-client-queue').forEach((queue) => {
    const header = queue.querySelector(':scope > header');
    if (!header) return;
    if (queue.dataset.mobileQueueReady !== '1') {
      rememberAttributes(header, ['tabindex', 'role', 'aria-expanded']);
      queue.dataset.mobileQueueReady = '1';
      header.tabIndex = 0;
      header.setAttribute('role', 'button');
      header.dataset.mobileQueueToggle = '1';
    }
    const count = Number(header.querySelector('b')?.textContent || 0);
    queue.classList.toggle('is-mobile-empty', count === 0);
    if (count === 0) queue.classList.remove('is-mobile-expanded');
    setIfChanged(header, 'aria-expanded', count > 0 && queue.classList.contains('is-mobile-expanded'));
  });
}

export function enhanceDrawerSections(root) {
  const selectors = '.activity-drawer__section:not(.activity-drawer__section--actions), .ds-pa-drawer .ds-pa-info-card';
  root.querySelectorAll(selectors).forEach((section, index) => {
    const title = section.querySelector(':scope > .activity-drawer__section-title, :scope > .activity-drawer__section-head .activity-drawer__section-title, :scope > .ds-pa-card-title');
    if (!title || section.dataset.mobileSectionReady === '1') return;
    rememberAttributes(title, ['tabindex', 'role', 'aria-expanded']);
    section.dataset.mobileSectionReady = '1';
    title.dataset.mobileDrawerSectionToggle = '1';
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    const keepOpen = index === 0 || section.matches('[data-central-info-section], [data-pa-proposal-info-card], [data-dates-section], [data-management-panel]');
    section.classList.toggle('is-mobile-collapsed', !keepOpen);
    setIfChanged(title, 'aria-expanded', keepOpen);
  });
}

const MATRIX_SELECTOR = [
  '[data-ops-controller-tab="summer_training_matrix"] .ops2027-table',
  '[data-ops-controller-tab="course_training_matrix"] .ops2027-table'
].join(', ');

export function syncActivityViewMode(table) {
  let button = table.previousElementSibling;
  if (table.matches('.ds-table--activities-2027-all, .ds-table--activities-2027-active')) {
    if (button?.matches('[data-mobile-activity-view]')) button.remove();
    if (table.classList.contains('is-mobile-all-expanded')) table.classList.remove('is-mobile-all-expanded');
    return;
  }
  if (!button?.matches('[data-mobile-activity-view]')) {
    button = table.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mobile-activity-view ds-btn ds-btn--sm';
    button.dataset.mobileActivityView = '1';
    table.before(button);
  }
  const label = expandedActivityCards ? 'תצוגה קומפקטית' : 'תצוגה מורחבת';
  if (button.textContent !== label) button.textContent = label;
  setIfChanged(button, 'aria-pressed', expandedActivityCards);
  table.classList.toggle('is-mobile-all-expanded', expandedActivityCards);
}

export function syncWeekDays(board) {
  const columns = [...board.querySelectorAll(':scope > .ds-week-col')];
  if (!columns.length) return;
  if (!columns.some((col) => col.getAttribute('aria-label') === selectedWeekDate)) {
    selectedWeekDate = (columns.find((col) => col.classList.contains('is-today')) || columns[0]).getAttribute('aria-label');
  }
  let controls = board.previousElementSibling;
  if (!controls?.matches('[data-mobile-week-controls]')) {
    controls = board.ownerDocument.createElement('nav');
    controls.dataset.mobileWeekControls = '1';
    controls.className = 'mobile-week-days';
    controls.setAttribute('aria-label', 'בחירת יום או שבוע מלא');
    board.before(controls);
  }
  const options = columns.map((col) => ({ key: col.getAttribute('aria-label'), label: `${col.querySelector('.ds-week-col__dow')?.textContent || ''} · ${col.querySelector('.ds-week-col__count')?.textContent || '0'}` }));
  options.push({ key: 'all', label: 'שבוע מלא' });
  if (controls.childElementCount !== options.length) {
    controls.replaceChildren(...options.map(() => {
      const button = board.ownerDocument.createElement('button');
      button.type = 'button';
      return button;
    }));
  }
  options.forEach((option, index) => {
    const button = controls.children[index];
    setIfChanged(button, 'data-mobile-week-day', option.key);
    if (button.textContent !== option.label) button.textContent = option.label;
    setIfChanged(button, 'aria-pressed', option.key === (fullWeek ? 'all' : selectedWeekDate));
  });
  columns.forEach((col) => setIfChanged(col, 'data-mobile-week-hidden', !fullWeek && col.getAttribute('aria-label') !== selectedWeekDate));
}

export function enhanceFeedbackTables(root) {
  root.querySelectorAll('.ifb-groups-table, .ifb-staff-table, .ifb-courses-table, .ifb-instructor-table').forEach((table) => {
    // Complex comparison matrices retain their own component scroll.
    if (table.querySelector('tbody [rowspan], thead [colspan]')) return;
    table.dataset.mobileTableReady = '1';
    table.dataset.mobileTableKind = 'feedback';
    const labels = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody > tr').forEach((row) => directCells(row).forEach((cell, index) => {
      if (!cell.hasAttribute('colspan')) setIfChanged(cell, 'data-mobile-label', labels[index] || '');
    }));
  });
}

export function enhanceFeedbackSlots(root) {
  root.querySelectorAll('.ifb-group-detail .ifb-slot').forEach((slot) => {
    const head = slot.querySelector(':scope > .ifb-slot__head');
    if (!head || head.querySelector('[data-mobile-feedback-slot-toggle]')) return;
    const button = slot.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mobile-feedback-slot-toggle';
    button.dataset.mobileFeedbackSlotToggle = '1';
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'פרטים ▾';
    slot.dataset.mobileFeedbackSlotReady = '1';
    head.append(button);
  });
}

export function enhanceRecordTables(root) {
  root.querySelectorAll('.ds-end-table, .ds-end-dates-screen .ds-table').forEach((table) => {
    table.dataset.mobileTableReady = '1';
    table.dataset.mobileTableKind = 'record';
    const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody > tr').forEach((row) => directCells(row).forEach((cell, index) => {
      if (!cell.hasAttribute('colspan')) setIfChanged(cell, 'data-mobile-label', labels[index] || '');
    }));
  });
}

export function enhanceMobileRoot(root = document) {
  root.querySelectorAll(COMPACT_NAV).forEach(syncCompactNavigation);
  root.querySelectorAll('.ds-week-board').forEach(syncWeekDays);
  root.querySelectorAll('.ds-table--activities-list').forEach(syncActivityViewMode);
  root.querySelectorAll('.ds-activities-main-toolbar, .ds-pa-toolbar, .route-week .ds-toolbar--filters-inline, .route-month .ds-toolbar--filters-inline').forEach(syncFilterToolbar);
  root.querySelectorAll('.ds-table--activities-list').forEach((table) => enhanceExpandableTable(table, 'activities'));
  root.querySelectorAll('.ds-pa-table').forEach((table) => enhanceExpandableTable(table, 'proposals'));
  root.querySelectorAll(MATRIX_SELECTOR).forEach((table) => enhanceExpandableTable(table, 'matrix'));
  enhanceFeedbackTables(root);
  enhanceFeedbackSlots(root);
  enhanceRecordTables(root);
  enhanceClientQueues(root);
  enhanceDrawerSections(root);
}

export function cleanupMobileRoot(root = document) {
  root.querySelectorAll('[data-mobile-week-controls], [data-mobile-activity-view], [data-mobile-feedback-slot-toggle]').forEach((node) => node.remove());
  root.querySelectorAll('[data-mobile-feedback-slot-ready]').forEach((slot) => { slot.removeAttribute('data-mobile-feedback-slot-ready'); slot.classList.remove('is-mobile-expanded'); });
  root.querySelectorAll('[data-mobile-week-hidden]').forEach((col) => col.removeAttribute('data-mobile-week-hidden'));
  root.querySelectorAll('.ds-table--activities-list').forEach((table) => table.classList.remove('is-mobile-all-expanded'));
  root.querySelectorAll('[data-mobile-filter-toggle], [data-mobile-section-nav-toggle], [data-mobile-primary-activities], [data-mobile-row-toggle]').forEach((element) => element.remove());
  root.querySelectorAll('[data-mobile-filters-ready]').forEach((toolbar) => {
    const handler = filterHandlers.get(toolbar);
    if (handler) toolbar.removeEventListener('change', handler);
    filterHandlers.delete(toolbar);
    toolbar.removeAttribute('data-mobile-filters-ready');
    toolbar.classList.remove('is-mobile-expanded');
    toolbar.querySelectorAll('.mobile-filter-detail').forEach((child) => child.classList.remove('mobile-filter-detail'));
  });
  root.querySelectorAll('[data-mobile-nav-ready]').forEach((nav) => {
    nav.removeAttribute('data-mobile-nav-ready');
    nav.classList.remove('is-mobile-expanded');
    restoreAttributes(nav);
  });
  root.querySelectorAll('[data-mobile-table-ready]').forEach((table) => {
    table.removeAttribute('data-mobile-table-ready');
    table.removeAttribute('data-mobile-table-kind');
  });
  root.querySelectorAll('[data-mobile-expandable-row]').forEach((row) => {
    row.removeAttribute('data-mobile-expandable-row');
    row.classList.remove('is-mobile-expanded');
    restoreAttributes(row);
  });
  root.querySelectorAll('[data-mobile-label], [data-mobile-field], [data-mobile-empty]').forEach((cell) => {
    cell.removeAttribute('data-mobile-label');
    cell.removeAttribute('data-mobile-field');
    cell.removeAttribute('data-mobile-empty');
  });
  root.querySelectorAll('[data-mobile-queue-ready]').forEach((queue) => {
    const header = queue.querySelector(':scope > header');
    queue.removeAttribute('data-mobile-queue-ready');
    queue.classList.remove('is-mobile-empty', 'is-mobile-expanded');
    if (header) {
      header.removeAttribute('data-mobile-queue-toggle');
      restoreAttributes(header);
    }
  });
  root.querySelectorAll('[data-mobile-section-ready]').forEach((section) => {
    const title = section.querySelector('[data-mobile-drawer-section-toggle]');
    section.removeAttribute('data-mobile-section-ready');
    section.classList.remove('is-mobile-collapsed');
    if (title) {
      title.removeAttribute('data-mobile-drawer-section-toggle');
      restoreAttributes(title);
    }
  });
}

export function bindMobileResponsive(doc = document, win = window) {
  if (doc.documentElement.dataset.responsiveRuntimeBound === '1') return;
  doc.documentElement.dataset.responsiveRuntimeBound = '1';
  const media = win.matchMedia(MOBILE_QUERY);
  const apply = () => media.matches ? enhanceMobileRoot(doc) : cleanupMobileRoot(doc);
  doc.addEventListener('click', (event) => {
    const viewToggle = event.target.closest?.('[data-mobile-activity-view]');
    if (viewToggle) {
      expandedActivityCards = !expandedActivityCards;
      apply();
      return;
    }
    const dayToggle = event.target.closest?.('[data-mobile-week-day]');
    if (dayToggle) {
      fullWeek = dayToggle.dataset.mobileWeekDay === 'all';
      if (!fullWeek) selectedWeekDate = dayToggle.dataset.mobileWeekDay;
      apply();
      return;
    }
    const activeNav = event.target.closest?.(COMPACT_NAV);
    if (activeNav && event.target.closest('button, a')) {
      activeNav.classList.remove('is-mobile-expanded');
      const navButton = activeNav.previousElementSibling;
      if (navButton?.matches('[data-mobile-section-nav-toggle]')) setIfChanged(navButton, 'aria-expanded', false);
    }
    const filterToggle = event.target.closest?.('[data-mobile-filter-toggle]');
    if (filterToggle) {
      const toolbar = filterToggle.parentElement;
      toolbar.classList.toggle('is-mobile-expanded');
      updateFilterButton(toolbar);
      return;
    }
    const navToggle = event.target.closest?.('[data-mobile-section-nav-toggle]');
    if (navToggle) {
      const nav = doc.getElementById(navToggle.getAttribute('aria-controls'));
      const open = nav?.classList.toggle('is-mobile-expanded') || false;
      setIfChanged(navToggle, 'aria-expanded', open);
      return;
    }
    const feedbackSlotToggle = event.target.closest?.('[data-mobile-feedback-slot-toggle]');
    if (feedbackSlotToggle) {
      const slot = feedbackSlotToggle.closest('[data-mobile-feedback-slot-ready]');
      const open = slot?.classList.toggle('is-mobile-expanded') || false;
      setIfChanged(feedbackSlotToggle, 'aria-expanded', open);
      feedbackSlotToggle.textContent = open ? 'סגירה ▴' : 'פרטים ▾';
      return;
    }
    const queueHeader = event.target.closest?.('[data-mobile-queue-toggle]');
    if (queueHeader) {
      const queue = queueHeader.closest('.ds-client-queue');
      if (queue?.classList.contains('is-mobile-empty')) return;
      const open = queue.classList.toggle('is-mobile-expanded');
      setIfChanged(queueHeader, 'aria-expanded', open);
      return;
    }
    const toggle = event.target.closest?.('[data-mobile-row-toggle]');
    if (toggle) {
      const row = toggle.closest('[data-mobile-expandable-row]');
      const open = row?.classList.toggle('is-mobile-expanded') || false;
      if (row) setIfChanged(row, 'aria-expanded', open);
      setIfChanged(toggle, 'aria-expanded', open);
      toggle.textContent = open ? 'סגירה ▴' : (row?.closest('[data-mobile-table-kind="activities"]') ? 'עוד מידע ▾' : 'פרטים ▾');
      toggle.setAttribute('aria-label', open ? 'הסתרת פרטים נוספים' : 'הצגת פרטים נוספים');
      event.stopPropagation();
      return;
    }
    const sectionTitle = event.target.closest?.('[data-mobile-drawer-section-toggle]');
    if (sectionTitle && !event.target.closest('button, a, input, select, textarea')) {
      const section = sectionTitle.closest('[data-mobile-section-ready]');
      const collapsed = section?.classList.toggle('is-mobile-collapsed') || false;
      setIfChanged(sectionTitle, 'aria-expanded', !collapsed);
    }
  });
  doc.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const control = event.target.closest?.('[data-mobile-queue-toggle], [data-mobile-drawer-section-toggle]');
    if (!control || event.target !== control) return;
    event.preventDefault();
    control.click();
  });
  const observer = new win.MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => mutation.type === 'childList'
      || mutation.target.matches?.(`${COMPACT_NAV}, .shell-header-nav [data-route], .instructors-workspace-tab, .ds-ops-mgmt-tab, .ifb-tab, [data-manager-workspace-tab], [data-activities-advanced-toggle]`));
    if (relevant) apply();
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-selected', 'aria-pressed', 'aria-expanded']
  });
  media.addEventListener?.('change', apply);
  apply();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') bindMobileResponsive();
