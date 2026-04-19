import { escapeHtml } from './html.js';

const UI_LAYER_ID = 'ds-shared-ui-layer';

/** Escape: לכל היותר listener אחד לכל טעינת מודול (האפליקציה משתמשת במופע יחיד של השכבה) */
let moduleEscapeInstalled = false;

const HOST_MARKUP = `
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

  function onGlobalEscape(event) {
    if (event.key !== 'Escape') return;
    if (modalOpen) {
      closeModal();
      return;
    }
    if (drawerOpen) closeDrawer();
  }

  function installEscapeHookOnce() {
    if (moduleEscapeInstalled) return;
    moduleEscapeInstalled = true;
    window.addEventListener('keydown', onGlobalEscape);
  }

  function onHostClick(event) {
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
  }

  function bindHostClickOnce(hostEl) {
    if (!hostEl || hostEl.dataset.dsUiHostClick === '1') return;
    hostEl.dataset.dsUiHostClick = '1';
    hostEl.addEventListener('click', onHostClick);
  }

  function pruneExtraUiLayers(keep) {
    document.querySelectorAll('.ds-ui-layer').forEach((el) => {
      if (el !== keep) el.remove();
    });
  }

  function fillHostShell(hostEl) {
    if (!hostEl.querySelector('.ds-drawer') || !hostEl.querySelector('.ds-modal')) {
      hostEl.innerHTML = HOST_MARKUP;
    }
  }

  function ensureHost() {
    if (host && document.body.contains(host)) {
      installEscapeHookOnce();
      bindHostClickOnce(host);
      return host;
    }

    const byId = document.getElementById(UI_LAYER_ID);
    if (byId && document.body.contains(byId)) {
      host = byId;
      fillHostShell(host);
      pruneExtraUiLayers(host);
      installEscapeHookOnce();
      bindHostClickOnce(host);
      return host;
    }

    pruneExtraUiLayers(null);

    host = document.createElement('div');
    host.id = UI_LAYER_ID;
    host.className = 'ds-ui-layer';
    host.setAttribute('dir', 'rtl');
    host.innerHTML = HOST_MARKUP;

    document.body.appendChild(host);
    installEscapeHookOnce();
    bindHostClickOnce(host);
    return host;
  }

  function setBackdropVisible(visible) {
    if (!host || !document.body.contains(host)) return;
    const backdrop = host.querySelector('.ds-ui-backdrop');
    if (!backdrop) return;
    backdrop.hidden = !visible;
    host.classList.toggle('is-backdrop-visible', visible);
  }

  function syncLayerClasses() {
    if (!host || !document.body.contains(host)) return;
    host.classList.toggle('is-drawer-open', drawerOpen);
    host.classList.toggle('is-modal-open', modalOpen);
    setBackdropVisible(drawerOpen || modalOpen);
  }

  function openDrawer({ title = 'פרטים', content = '', onClose, onOpen } = {}) {
    const root = ensureHost();
    const drawer = root.querySelector('.ds-drawer');
    const titleNode = root.querySelector('.ds-drawer__title');
    const contentNode = root.querySelector('.ds-drawer__content');
    if (!drawer || !titleNode || !contentNode) return;

    if (modalOpen) closeModal();

    if (drawerOpen && typeof onDrawerClose === 'function') {
      const prev = onDrawerClose;
      onDrawerClose = null;
      prev();
    }

    titleNode.innerHTML = defaultDrawerTitle(title);
    contentNode.innerHTML = asHtml(content);
    onDrawerClose = typeof onClose === 'function' ? onClose : null;

    drawerOpen = true;
    drawer.setAttribute('aria-hidden', 'false');
    syncLayerClasses();
    if (typeof onOpen === 'function') onOpen(contentNode);
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    if (!host || !document.body.contains(host)) {
      drawerOpen = false;
      onDrawerClose = null;
      return;
    }
    const drawer = host.querySelector('.ds-drawer');
    if (!drawer) return;

    drawerOpen = false;
    drawer.setAttribute('aria-hidden', 'true');

    if (onDrawerClose) onDrawerClose();
    onDrawerClose = null;

    syncLayerClasses();
  }

  function openModal({ title = 'פעולה', content = '', actions = '', onClose } = {}) {
    const root = ensureHost();
    const modal = root.querySelector('.ds-modal');
    const titleNode = root.querySelector('.ds-modal__title');
    const contentNode = root.querySelector('.ds-modal__content');
    const footerNode = root.querySelector('.ds-modal__footer');
    if (!modal || !titleNode || !contentNode || !footerNode) return;

    if (drawerOpen) closeDrawer();

    if (modalOpen && typeof onModalClose === 'function') {
      const prev = onModalClose;
      onModalClose = null;
      prev();
    }

    titleNode.innerHTML = defaultModalTitle(title);
    contentNode.innerHTML = asHtml(content);
    footerNode.innerHTML = asHtml(actions);
    footerNode.hidden = !actions;

    onModalClose = typeof onClose === 'function' ? onClose : null;

    modalOpen = true;
    modal.setAttribute('aria-hidden', 'false');
    syncLayerClasses();
  }

  function closeModal() {
    if (!modalOpen) return;
    if (!host || !document.body.contains(host)) {
      modalOpen = false;
      onModalClose = null;
      return;
    }
    const modal = host.querySelector('.ds-modal');
    if (!modal) return;

    modalOpen = false;
    modal.setAttribute('aria-hidden', 'true');

    if (onModalClose) onModalClose();
    onModalClose = null;

    syncLayerClasses();
  }

  function closeAll() {
    closeModal();
    closeDrawer();
    if (host && document.body.contains(host)) {
      host.classList.remove('is-drawer-open', 'is-modal-open', 'is-backdrop-visible');
      const backdrop = host.querySelector('.ds-ui-backdrop');
      if (backdrop) backdrop.hidden = true;
    }
  }

  function bindInteractiveCards(root, onAction) {
    if (!root) return;
    root.querySelectorAll('[data-card-action]').forEach((button) => {
      if (button.dataset.cardBound === 'yes') return;
      button.dataset.cardBound = 'yes';
      button.addEventListener('click', (event) => {
        event.preventDefault();
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
