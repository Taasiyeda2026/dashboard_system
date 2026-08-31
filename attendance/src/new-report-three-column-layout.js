const STYLE_ID = 'av2-new-report-three-column-style';
const FORM_SELECTOR = '.av2-report__form';

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
    }

    @media (max-width: 767px) {
      .av2-form-section--expenses .av2-form-section__body {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .av2-form-section--expenses .av2-report__expenses {
        gap: 10px !important;
      }
    }
  `;
  document.head.append(style);
}

function createExpensesSection(expensesInner) {
  const section = document.createElement('section');
  section.className = 'av2-form-section av2-form-section--expenses';
  section.dataset.av2ExpensesSection = 'yes';

  const heading = document.createElement('h2');
  heading.className = 'av2-form-section__title';
  heading.textContent = 'הוצאות';

  const body = document.createElement('div');
  body.className = 'av2-form-section__body av2-form-section__body--expenses';
  body.append(expensesInner);

  section.append(heading, body);
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

if (typeof document !== 'undefined') {
  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
