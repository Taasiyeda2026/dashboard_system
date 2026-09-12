const STYLE_ID = 'proposal-client-back-button-layout-v1';
const SCREEN_SELECTOR = '.ds-pa-screen[data-pa-screen]';
const BACK_BUTTON_SELECTOR = '[data-pa-back-to-client-home]';

function ensureProposalBackButtonStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ds-page-header.ds-pa-page-header--with-back {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    #app .ds-page-header .ds-pa-header-back {
      margin-inline-start: auto;
      flex: 0 0 auto;
      min-height: 34px;
      padding-inline: 12px;
      white-space: nowrap;
    }

    @media (max-width: 680px) {
      #app .ds-page-header.ds-pa-page-header--with-back {
        gap: 8px;
      }

      #app .ds-page-header .ds-pa-header-back {
        min-height: 32px;
        padding-inline: 9px;
        font-size: 0.78rem;
      }
    }
  `;
  document.head.appendChild(style);
}

export function syncProposalBackButtonLayout(root = document) {
  if (typeof document === 'undefined') return false;
  ensureProposalBackButtonStyle();

  const screen = root.querySelector?.(SCREEN_SELECTOR) || document.querySelector(SCREEN_SELECTOR);
  if (!screen) return false;

  const stack = screen.closest?.('.ds-screen-stack');
  const header = stack?.querySelector?.(':scope > .ds-page-header') || document.querySelector('.ds-page-header');
  const button = (stack || screen).querySelector?.(BACK_BUTTON_SELECTOR) || document.querySelector(BACK_BUTTON_SELECTOR);
  if (!header || !button) return false;

  if (button.parentElement !== header) header.appendChild(button);
  button.classList.add('ds-pa-header-back');
  if (button.textContent !== '← לתיקי לקוחות') button.textContent = '← לתיקי לקוחות';

  const show = String(screen.dataset?.paViewMode || '') === 'all-proposals';
  button.hidden = !show;
  header.classList.toggle('ds-pa-page-header--with-back', show);

  const oldHost = screen.querySelector?.('.ds-pa-all-back');
  if (oldHost && !oldHost.children.length) oldHost.hidden = true;
  return true;
}

function bindProposalBackButtonLayout() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (globalThis.__proposalBackButtonLayoutBound) return;
  globalThis.__proposalBackButtonLayoutBound = true;

  let queued = false;
  const queueSync = () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      syncProposalBackButtonLayout();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  };

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      if (mutation.type === 'attributes') {
        return mutation.target?.matches?.(SCREEN_SELECTOR);
      }
      return Array.from(mutation.addedNodes || []).some((node) => node instanceof Element && (
        node.matches?.(SCREEN_SELECTOR)
        || node.querySelector?.(SCREEN_SELECTOR)
        || node.matches?.(BACK_BUTTON_SELECTOR)
        || node.querySelector?.(BACK_BUTTON_SELECTOR)
      ));
    });
    if (relevant) queueSync();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-pa-view-mode']
  });

  queueSync();
}

bindProposalBackButtonLayout();
