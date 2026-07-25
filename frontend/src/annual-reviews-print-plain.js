const GENERATED_ATTR = 'data-ar2-print-plain-generated';
const SOURCE_CLASS = 'ar2-print-plain-source';
const STYLE_ID = 'annual-reviews-print-plain-styles';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ar2-print-plain-value { display: none; }

    @media print {
      body.ar2-printing #app .${SOURCE_CLASS} { display: none !important; }
      body.ar2-printing #app .ar2-print-plain-value {
        display: block !important;
        margin-top: 4px;
        color: #111827;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      body.ar2-printing #app .ar2-print-plain-rating { font-weight: 700; }
    }
  `;
  document.head.appendChild(style);
}

function cleanupPlainPrint() {
  document.querySelectorAll(`[${GENERATED_ATTR}]`).forEach((node) => node.remove());
  document.querySelectorAll(`.${SOURCE_CLASS}`).forEach((node) => node.classList.remove(SOURCE_CLASS));
}

function addPlainValue(source, text, extraClass = '') {
  if (!source || source.classList.contains(SOURCE_CLASS)) return;
  const value = document.createElement('div');
  value.className = `ar2-print-plain-value${extraClass ? ` ${extraClass}` : ''}`;
  value.setAttribute(GENERATED_ATTR, 'true');
  value.textContent = text;
  source.classList.add(SOURCE_CLASS);
  source.insertAdjacentElement('afterend', value);
}

function controlLabel(control) {
  if (control.matches('[data-ar2-metric-comment]')) return 'הערות';
  if (control.closest('.ar2-question')?.querySelector('.ar2-rating-wrap')) return 'הערות';
  const fieldLabel = control.closest('.ar2-field')?.querySelector(':scope > span')?.textContent?.trim();
  return fieldLabel || 'תשובה';
}

function preparePlainPrint() {
  cleanupPlainPrint();
  const root = document.querySelector('#app .ar2-screen');
  if (!root) return;

  root.querySelectorAll('.ar2-rating-wrap').forEach((wrap) => {
    const selected = wrap.querySelector('.ar2-rating.is-selected');
    addPlainValue(wrap, `דירוג: ${selected?.textContent?.trim() || 'לא צוין'}`, 'ar2-print-plain-rating');
  });

  root.querySelectorAll('textarea.ar2-textarea').forEach((textarea) => {
    const label = controlLabel(textarea);
    const value = textarea.value?.trim() || '—';
    addPlainValue(textarea, `${label}: ${value}`);
  });

  root.querySelectorAll('select.ar2-select').forEach((select) => {
    const label = controlLabel(select);
    const value = select.selectedOptions?.[0]?.textContent?.trim() || '—';
    addPlainValue(select, `${label}: ${value}`);
  });

  root.querySelectorAll('input.ar2-input').forEach((input) => {
    const label = controlLabel(input);
    addPlainValue(input, `${label}: ${input.value?.trim() || '—'}`);
  });
}

installStyles();
window.addEventListener('beforeprint', preparePlainPrint);
window.addEventListener('afterprint', cleanupPlainPrint);
