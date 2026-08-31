const STYLE_ID = 'av2-new-report-three-column-style';
const FORM_SELECTOR = '.av2-report__form';
const MOBILE_QUERY = '(max-width: 767px)';
let expensesBodySeq = 0;

function isMobileLayout() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .av2-form-section--expenses .av2-report__expenses {
      padding-top: 0 !important;
      border-top: 0 !important;
    }

    .av2-form-section--expenses .av2-report__expenses > .av2-form-section__subtitle {
      display: none !important;
    }

    .av2-expenses-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: inherit;
      text-align: start;
    }

    .av2-expenses-toggle__chevron {
      display: none;
      width: 9px;
      height: 9px;
      flex: 0 0 9px;
      border-inline-end: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: rotate(45deg);
      transition: transform 0.16s ease;
    }

    @media (min-width: 768px) {
      .av2-report__form-area {
        align-items: center !important;
      }

      .av2-report__form {
        display: grid !important;
        width: min(100%, 795px) !important;
        grid-template-columns: repeat(3, minmax(0, 245px)) !important;
        gap: 14px 30px !important;
        justify-content: center !important;
        align-items: start !important;
      }

      .av2-report__form > .av2-form-section {
        width: 245px !important;
        max-width: 245px !important;
        min-width: 0 !important;
      }

      .av2-form-section--expenses .av2-form-section__body {
        padding: 12px 16px 16px !important;
        gap: 9px !important;
      }

      .av2-form-section--expenses .av2-report__expenses {
        display: flex !important;
        flex-direction: column !important;
        gap: 9px !important;
      }

      .av2-form-section--expenses .av2-report__expense-fields {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        gap: 9px !important;
      }

      .av2-form-section--expenses .av2-field,
      .av2-form-section--expenses .av2-attach-section {
        width: 100% !important;
        max-width: 213px !important;
        min-width: 0 !important;
      }

      .av2-form-section--expenses .av2-attach-upload-btn {
        align-self: center !important;
        width: auto !important;
        max-width: 150px !important;
        min-height: 32px !important;
      }

      .av2-report__actions,
      .av2-report__error {
        grid-column: 1 / -1 !important;
      }

      .av2-report__actions {
        justify-content: center !important;
        width: 100% !important;
      }

      .av2-expenses-toggle {
        pointer-events: none;
      }
    }

    @media (max-width: 767px) {
      /* Keep the entire New Report experience in one mobile column, including
         the 640–767px range that was previously picking up the two-column rules. */
      .av2-report__form-area {
        align-items: stretch !important;
      }

      .av2-report__form {
        display: flex !important;
        flex-direction: column !important;
        width: 100% !important;
        max-width: 100% !important;
        gap: 12px !important;
      }

      .av2-report__form > .av2-form-section {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }

      .av2-form-section__body--activity,
      .av2-form-section__body--times,
      .av2-form-section__body--bottom,
      .av2-form-section--expenses .av2-form-section__body {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .av2-form-section--expenses {
        overflow: hidden !important;
      }

      .av2-form-section--expenses .av2-form-section__title {
        padding: 0 !important;
      }

      .av2-expenses-toggle {
        min-height: 44px;
        padding: 9px 14px;
        cursor: pointer;
        touch-action: manipulation;
      }

      .av2-expenses-toggle__chevron {
        display: block;
      }

      .av2-form-section--expenses:not(.is-mobile-collapsed) .av2-expenses-toggle__chevron {
        transform: rotate(225deg);
      }

      .av2-form-section--expenses.is-mobile-collapsed .av2-form-section__body--expenses {
        display: none !important;
      }

      .av2-form-section--expenses .av2-form-section__body {
        padding: 10px 14px 14px !important;
      }

      .av2-form-section--expenses .av2-report__expenses {
        gap: 10px !important;
      }

      .av2-form-section--expenses .av2-field,
      .av2-form-section--expenses .av2-attach-section,
      .av2-form-section--expenses .av2-field__input,
      .av2-form-section--expenses .av2-field__select,
      .av2-form-section--expenses .av2-attach-upload-btn {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }
    }
  `;
  document.head.append(style);
}

function setMobileExpanded(section, expanded) {
  section.dataset.av2MobileExpensesExpanded = expanded ? 'yes' : 'no';
  section.classList.toggle('is-mobile-collapsed', !expanded);
  const toggle = section.querySelector('.av2-expenses-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function syncExpensesMode(section) {
  if (!(section instanceof HTMLElement)) return;
  const toggle = section.querySelector('.av2-expenses-toggle');
  if (!(toggle instanceof HTMLButtonElement)) return;

  if (isMobileLayout()) {
    if (!section.dataset.av2MobileExpensesExpanded) {
      setMobileExpanded(section, false);
    } else {
      setMobileExpanded(section, section.dataset.av2MobileExpensesExpanded === 'yes');
    }
    toggle.tabIndex = 0;
  } else {
    section.classList.remove('is-mobile-collapsed');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.tabIndex = -1;
  }
}

function createExpensesSection(expensesInner) {
  const section = document.createElement('section');
  section.className = 'av2-form-section av2-form-section--expenses';
  section.dataset.av2ExpensesSection = 'yes';

  const bodyId = `av2-expenses-body-${++expensesBodySeq}`;

  const heading = document.createElement('h2');
  heading.className = 'av2-form-section__title';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'av2-expenses-toggle';
  toggle.setAttribute('aria-controls', bodyId);
  toggle.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.textContent = 'הוצאות';

  const chevron = document.createElement('span');
  chevron.className = 'av2-expenses-toggle__chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.append(label, chevron);
  heading.append(toggle);

  const body = document.createElement('div');
  body.id = bodyId;
  body.className = 'av2-form-section__body av2-form-section__body--expenses';
  body.append(expensesInner);

  toggle.addEventListener('click', () => {
    if (!isMobileLayout()) return;
    const expanded = section.dataset.av2MobileExpensesExpanded === 'yes';
    setMobileExpanded(section, !expanded);
  });

  const validationObserver = new MutationObserver(() => {
    if (!isMobileLayout()) return;
    const hasInvalid = Boolean(section.querySelector('.av2-field--invalid, [aria-invalid="true"]'));
    if (hasInvalid) setMobileExpanded(section, true);
  });
  validationObserver.observe(body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-invalid'],
  });

  section.append(heading, body);
  syncExpensesMode(section);
  return section;
}

function enhanceForm(form) {
  if (!(form instanceof HTMLElement)) return;
  if (form.dataset.av2ThreeColumnLayout === 'yes') return;

  const timesSection = Array.from(form.children)
    .find((node) => node instanceof HTMLElement && node.classList.contains('av2-form-section--times'));
  if (!timesSection) return;

  const expensesInner = timesSection.querySelector('.av2-report__expenses');
  if (!expensesInner) return;

  const oldSubtitle = expensesInner.querySelector(':scope > .av2-form-section__subtitle');
  if (oldSubtitle) oldSubtitle.setAttribute('aria-hidden', 'true');

  const expensesSection = createExpensesSection(expensesInner);
  timesSection.insertAdjacentElement('afterend', expensesSection);
  form.dataset.av2ThreeColumnLayout = 'yes';
}

function enhance() {
  injectStyle();
  document.querySelectorAll(FORM_SELECTOR).forEach(enhanceForm);
}

function installResponsiveSync() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const media = window.matchMedia(MOBILE_QUERY);
  const syncAll = () => {
    document.querySelectorAll('.av2-form-section--expenses')
      .forEach((section) => syncExpensesMode(section));
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', syncAll);
  } else if (typeof media.addListener === 'function') {
    media.addListener(syncAll);
  }
}

if (typeof document !== 'undefined') {
  enhance();
  installResponsiveSync();
  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
