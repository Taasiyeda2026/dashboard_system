import { escapeHtml } from './html.js';

function asHtml(content) {
  if (content == null) return '';
  return typeof content === 'string' ? content : String(content);
}

function defaultDrawerTitle(title) {
  return escapeHtml(title || 'פרטים');
}

function defaultModalTitle(title) {
  return escapeHtml(title || 'פעולה');
}

export function createSharedInteractionLayer() {
  let host = null;
  let drawerOpen = false;
  let modalOpen = false;
  let onDrawerClose = null;
  let onModalClose = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;

    host = document.createElement('div');
    host.className = 'ds-ui-layer';
    host.setAttribute('dir', 'rtl');
    host.innerHTML = `
      <div class="ds-ui-backdrop" data-ui-close-all hidden></div>

      <aside class="ds-drawer" aria-hidden="true" aria-label="חלונית צד">
        <header class="ds-drawer__header">
          <h2 class="ds-drawer__title"></h2>
          <button type="button" class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
        </header>
        <div class="ds-drawer__content"></div>
      </aside>

      <section class="ds-modal" aria-hidden="true" aria-label="חלון פעולה קצרה" role="dialog" aria-modal="true">
        <header class="ds-modal__header">
          <h2 class="ds-modal__title"></h2>
          <button type="button" class="ds-icon-btn" data-ui-close-modal aria-label="סגירה">✕</button>
        </header>
        <div class="ds-modal__content"></div>
        <footer class="ds-modal__footer" hidden></footer>
      </section>
    `;

    document.body.appendChild(host);

    host.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-ui-close-drawer]')) {
        closeDrawer();
        return;
      }
      if (target.closest('[data-ui-close-modal]')) {
        closeModal();
        return;
      }
      if (target.closest('[data-ui-close-all]')) {
        closeAll();
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (modalOpen) {
        closeModal();
        return;
      }
      if (drawerOpen) closeDrawer();
    });

    return host;
  }

  function setBackdropVisible(visible) {
    if (!host || !document.body.contains(host)) return;
    const backdrop = host.querySelector('.ds-ui-backdrop');
    if (!backdrop) return;
    backdrop.hidden = !visible;
    host.classList.toggle('is-backdrop-visible', visible);
  }

  function openDrawer({ title = 'פרטים', content = '', onClose } = {}) {
    const root = ensureHost();
    const drawer = root.querySelector('.ds-drawer');
    const titleNode = root.querySelector('.ds-drawer__title');
    const contentNode = root.querySelector('.ds-drawer__content');
    if (!drawer || !titleNode || !contentNode) return;

    titleNode.innerHTML = defaultDrawerTitle(title);
    contentNode.innerHTML = asHtml(content);
    onDrawerClose = typeof onClose === 'function' ? onClose : null;

    drawerOpen = true;
    drawer.setAttribute('aria-hidden', 'false');
    root.classList.add('is-drawer-open');
    setBackdropVisible(true);
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    if (!host || !document.body.contains(host)) {
      drawerOpen = false;
      return;
    }
    const drawer = host.querySelector('.ds-drawer');
    if (!drawer) return;

    drawerOpen = false;
    drawer.setAttribute('aria-hidden', 'true');
    host.classList.remove('is-drawer-open');
    setBackdropVisible(modalOpen);

    if (onDrawerClose) onDrawerClose();
    onDrawerClose = null;
  }

  function openModal({ title = 'פעולה', content = '', actions = '', onClose } = {}) {
    const root = ensureHost();
    const modal = root.querySelector('.ds-modal');
    const titleNode = root.querySelector('.ds-modal__title');
    const contentNode = root.querySelector('.ds-modal__content');
    const footerNode = root.querySelector('.ds-modal__footer');
    if (!modal || !titleNode || !contentNode || !footerNode) return;

    titleNode.innerHTML = defaultModalTitle(title);
    contentNode.innerHTML = asHtml(content);
    footerNode.innerHTML = asHtml(actions);
    footerNode.hidden = !actions;

    onModalClose = typeof onClose === 'function' ? onClose : null;

    modalOpen = true;
    modal.setAttribute('aria-hidden', 'false');
    root.classList.add('is-modal-open');
    setBackdropVisible(true);
  }

  function closeModal() {
    if (!modalOpen) return;
    if (!host || !document.body.contains(host)) {
      modalOpen = false;
      return;
    }
    const modal = host.querySelector('.ds-modal');
    if (!modal) return;

    modalOpen = false;
    modal.setAttribute('aria-hidden', 'true');
    host.classList.remove('is-modal-open');
    setBackdropVisible(drawerOpen);

    if (onModalClose) onModalClose();
    onModalClose = null;
  }

  function closeAll() {
    closeModal();
    closeDrawer();
  }

  function bindInteractiveCards(root, onAction) {
    if (!root) return;
    root.querySelectorAll('[data-card-action]').forEach((button) => {
      if (button.dataset.cardBound === 'yes') return;
      button.dataset.cardBound = 'yes';
      button.addEventListener('click', () => {
        const action = button.dataset.cardAction || '';
        if (!action || typeof onAction !== 'function') return;
        onAction(action, button);
      });
    });
  }

  return {
    openDrawer,
    closeDrawer,
    openModal,
    closeModal,
    closeAll,
    bindInteractiveCards,
    get isDrawerOpen() {
      return drawerOpen;
    },
    get isModalOpen() {
      return modalOpen;
    }
  };
}
