const MOBILE_QUERY = '(max-width: 820px)';

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
  const count = activeFilterCount(toolbar);
  button.textContent = count ? `סינון (${count})` : 'סינון';
  button.setAttribute('aria-expanded', toolbar.classList.contains('is-mobile-expanded') ? 'true' : 'false');
}

export function enhanceFilterToolbar(toolbar) {
  if (!toolbar || toolbar.dataset.mobileFiltersReady === '1') return;
  toolbar.dataset.mobileFiltersReady = '1';
  const doc = toolbar.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'ds-btn ds-btn--sm ds-btn--ghost mobile-filter-toggle';
  button.dataset.mobileFilterToggle = '1';
  toolbar.insertBefore(button, Array.from(toolbar.children).find((child) => !child.matches?.('input[type="search"], .ds-pa-search, .ds-filter-field--search')) || null);
  Array.from(toolbar.children).forEach((child) => {
    if (child !== button && !child.matches?.('input[type="search"], .ds-pa-search, .ds-filter-field--search')) {
      child.classList.add('mobile-filter-detail');
    }
  });
  updateFilterButton(toolbar);
  toolbar.addEventListener('change', () => updateFilterButton(toolbar));
}

export function enhanceCompactNavigation(nav) {
  if (!nav || nav.dataset.mobileNavReady === '1') return;
  nav.dataset.mobileNavReady = '1';
  const doc = nav.ownerDocument;
  const active = nav.querySelector('.is-active, [aria-selected="true"], [aria-pressed="true"]');
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-section-nav-toggle';
  toggle.dataset.mobileSectionNavToggle = '1';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = `${active?.textContent?.trim() || nav.getAttribute('aria-label') || 'בחירת אזור'} ▾`;
  nav.parentNode?.insertBefore(toggle, nav);
}

export function enhanceExpandableTable(table, kind = 'generic') {
  if (!table || table.dataset.mobileTableReady === '1') return;
  table.dataset.mobileTableReady = '1';
  table.dataset.mobileTableKind = kind;
  const labels = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim());
  Array.from(table.querySelectorAll('tbody > tr')).forEach((row) => {
    row.dataset.mobileExpandableRow = '1';
    row.setAttribute('aria-expanded', 'false');
    directCells(row).forEach((cell, index) => {
      if (labels[index]) cell.dataset.mobileLabel = labels[index];
    });
    const firstCell = directCells(row)[0];
    if (!firstCell || firstCell.querySelector('[data-mobile-row-toggle]')) return;
    const toggle = table.ownerDocument.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-row-toggle';
    toggle.dataset.mobileRowToggle = '1';
    toggle.setAttribute('aria-label', 'הצגת פרטים נוספים');
    toggle.textContent = 'פרטים ▾';
    firstCell.append(toggle);
  });
}

export function enhanceClientQueues(root) {
  root.querySelectorAll('.ds-client-queue').forEach((queue) => {
    if (queue.dataset.mobileQueueReady === '1') return;
    queue.dataset.mobileQueueReady = '1';
    const count = Number(queue.querySelector('header b')?.textContent || 0);
    const header = queue.querySelector('header');
    if (!header) return;
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'false');
    header.dataset.mobileQueueToggle = '1';
    if (count === 0) queue.classList.add('is-mobile-empty');
  });
}

export function enhanceDrawerSections(root) {
  const selectors = '.activity-drawer__section:not(.activity-drawer__section--actions), .ds-pa-drawer .ds-pa-info-card';
  root.querySelectorAll(selectors).forEach((section, index) => {
    if (section.dataset.mobileSectionReady === '1') return;
    const title = section.querySelector(':scope > .activity-drawer__section-title, :scope > .activity-drawer__section-head .activity-drawer__section-title, :scope > .ds-pa-card-title');
    if (!title) return;
    section.dataset.mobileSectionReady = '1';
    title.dataset.mobileDrawerSectionToggle = '1';
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    const keepOpen = index === 0 || section.matches('[data-central-info-section], [data-pa-proposal-info-card]');
    section.classList.toggle('is-mobile-collapsed', !keepOpen);
    title.setAttribute('aria-expanded', String(keepOpen));
  });
}

export function enhanceMobileRoot(root = document) {
  root.querySelectorAll('.instructors-workspace-tabs, .ds-ops-mgmt-tabs').forEach(enhanceCompactNavigation);
  root.querySelectorAll('.ds-activities-main-toolbar, .ds-pa-toolbar').forEach(enhanceFilterToolbar);
  root.querySelectorAll('.ds-table--activities-list').forEach((table) => enhanceExpandableTable(table, 'activities'));
  root.querySelectorAll('.ds-pa-table').forEach((table) => enhanceExpandableTable(table, 'proposals'));
  root.querySelectorAll('.ops2027-table').forEach((table) => enhanceExpandableTable(table, 'matrix'));
  enhanceClientQueues(root);
  enhanceDrawerSections(root);
}

export function bindMobileResponsive(doc = document, win = window) {
  if (doc.documentElement.dataset.mobileResponsiveBound === '1') return;
  doc.documentElement.dataset.mobileResponsiveBound = '1';
  const apply = () => { if (win.matchMedia(MOBILE_QUERY).matches) enhanceMobileRoot(doc); };
  doc.addEventListener('click', (event) => {
    const filterToggle = event.target.closest?.('[data-mobile-filter-toggle]');
    if (filterToggle) {
      const toolbar = filterToggle.parentElement;
      toolbar.classList.toggle('is-mobile-expanded');
      updateFilterButton(toolbar);
      return;
    }
    const navToggle = event.target.closest?.('[data-mobile-section-nav-toggle]');
    if (navToggle) {
      const nav = navToggle.nextElementSibling;
      const open = nav?.classList.toggle('is-mobile-expanded') || false;
      navToggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const queueHeader = event.target.closest?.('[data-mobile-queue-toggle]');
    if (queueHeader) {
      const queue = queueHeader.closest('.ds-client-queue');
      if (queue?.classList.contains('is-mobile-empty')) return;
      const open = queue.classList.toggle('is-mobile-expanded');
      queueHeader.setAttribute('aria-expanded', String(open));
      return;
    }
    const toggle = event.target.closest?.('[data-mobile-row-toggle]');
    if (toggle) {
      const row = toggle.closest('[data-mobile-expandable-row]');
      const open = row?.classList.toggle('is-mobile-expanded') || false;
      row?.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'סגירה ▴' : 'פרטים ▾';
      toggle.setAttribute('aria-label', open ? 'הסתרת פרטים נוספים' : 'הצגת פרטים נוספים');
      event.stopPropagation();
      return;
    }
    const sectionTitle = event.target.closest?.('[data-mobile-drawer-section-toggle]');
    if (sectionTitle) {
      const section = sectionTitle.closest('[data-mobile-section-ready]');
      const collapsed = section?.classList.toggle('is-mobile-collapsed') || false;
      sectionTitle.setAttribute('aria-expanded', String(!collapsed));
    }
  });
  doc.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const control = event.target.closest?.('[data-mobile-queue-toggle], [data-mobile-drawer-section-toggle]');
    if (!control) return;
    event.preventDefault();
    control.click();
  });
  const observer = new win.MutationObserver(apply);
  observer.observe(doc.body, { childList: true, subtree: true });
  win.matchMedia(MOBILE_QUERY).addEventListener?.('change', apply);
  apply();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') bindMobileResponsive();
