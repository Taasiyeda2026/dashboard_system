import { escapeHtml } from './html.js';
import { exportSingleActivityToExcel } from './excel-export.js';
import { applyActivityDrawerLayoutPipeline } from '../../activity-drawer-layout-pipeline.js';

const UI_LAYER_ID = 'ds-shared-ui-layer';

/** Escape: לכל היותר listener אחד לכל טעינת מודול (האפליקציה משתמשת במופע יחיד של השכבה) */
let moduleEscapeInstalled = false;
let sharedInteractionLayer = null;

const HOST_MARKUP = `
      <div class="ds-ui-backdrop" data-ui-close-all hidden></div>

      <aside class="ds-drawer" aria-hidden="true" aria-label="חלונית צד">
        <header class="ds-drawer__header">
          <h2 class="ds-drawer__title"></h2>
          <button type="button" class="ds-icon-btn" data-ui-close-drawer aria-label="סגירה">✕</button>
        </header>
        <div class="ds-drawer__content"></div>
      </aside>

      <aside class="ds-secondary-drawer" aria-hidden="true" aria-label="חלונית צד משנית">
        <header class="ds-drawer__header">
          <h2 class="ds-secondary-drawer__title"></h2>
          <button type="button" class="ds-icon-btn" data-ui-close-secondary-drawer aria-label="סגירת חלונית משנית">✕</button>
        </header>
        <div class="ds-secondary-drawer__content"></div>
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


function bindDrawerExport(contentNode) {
  if (!contentNode || contentNode.dataset.exportBound === '1') return;
  contentNode.dataset.exportBound = '1';
  contentNode.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action="export-activity-excel"]') : null;
    if (!target) return;
    event.preventDefault();
    const form = contentNode.querySelector('[data-drawer-form]');
    if (!form) return;
    let row = {};
    try { row = JSON.parse(form.dataset.exportRow || '{}'); } catch { row = {}; }
    exportSingleActivityToExcel(row);
  });
}

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
  if (sharedInteractionLayer) return sharedInteractionLayer;
  let host = null;
  let drawerOpen = false;
  let modalOpen = false;
  let secondaryDrawerOpen = false;
  let onDrawerClose = null;
  let onModalClose = null;
  // Track the element that had focus when the drawer/modal was opened,
  // so we can return focus to it on close (avoids "Blocked aria-hidden" warnings).
  let drawerOpener = null;
  let modalOpener = null;

  function onGlobalEscape(event) {
    if (event.key !== 'Escape') return;
    if (modalOpen) {
      closeModal();
      return;
    }
    if (secondaryDrawerOpen) {
      closeSecondaryDrawer();
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
    if (target.closest('[data-ui-close-secondary-drawer]')) {
      closeSecondaryDrawer();
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
    host.classList.toggle('is-secondary-drawer-open', secondaryDrawerOpen);
    setBackdropVisible(drawerOpen || modalOpen);
  }

  function openDrawer({ title = '', content = '', onClose, onOpen } = {}) {
    if (!String(content || '').trim() && !String(title || '').trim()) {
      if (typeof console !== 'undefined') {
        console.warn('[openDrawer] Blocked: called with no title and no content.', new Error().stack);
      }
      return;
    }
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

    // Drawer variants belong to the content being replaced. Activity content
    // may add this class again in the layout pipeline below.
    drawer.classList.remove('ds-drawer--activity-inline');
    titleNode.innerHTML = defaultDrawerTitle(title);
    contentNode.innerHTML = asHtml(content);
    applyActivityDrawerLayoutPipeline(contentNode);
    bindDrawerExport(contentNode);
    drawer.scrollTop = 0;
    contentNode.scrollTop = 0;
    onDrawerClose = typeof onClose === 'function' ? onClose : null;
    // Save the opener so focus can be returned when the drawer closes.
    drawerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    drawerOpen = true;
    drawer.setAttribute('aria-hidden', 'false');
    syncLayerClasses();
    requestAnimationFrame(() => {
      drawer.scrollTop = 0;
      contentNode.scrollTop = 0;
    });
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

    closeSecondaryDrawer();
    drawerOpen = false;
    // Return focus before aria-hiding to avoid "Blocked aria-hidden" browser warnings.
    if (drawer.contains(document.activeElement)) {
      if (drawerOpener && document.body.contains(drawerOpener)) {
        drawerOpener.focus({ preventScroll: true });
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    drawerOpener = null;
    drawer.setAttribute('aria-hidden', 'true');

    const cb = onDrawerClose;
    onDrawerClose = null;
    try {
      if (cb) cb();
    } catch (_err) {
      // Safety: never leave the drawer layer stuck open.
    } finally {
      syncLayerClasses();
    }
  }

  function openSecondaryDrawer({ title = '', content = '', onOpen } = {}) {
    if (!drawerOpen) return;
    const root = ensureHost();
    const drawer = root.querySelector('.ds-secondary-drawer');
    const titleNode = root.querySelector('.ds-secondary-drawer__title');
    const contentNode = root.querySelector('.ds-secondary-drawer__content');
    if (!drawer || !titleNode || !contentNode) return;
    titleNode.innerHTML = defaultDrawerTitle(title);
    contentNode.innerHTML = asHtml(content);
    secondaryDrawerOpen = true;
    drawer.setAttribute('aria-hidden', 'false');
    syncLayerClasses();
    if (typeof onOpen === 'function') onOpen(contentNode);
  }

  function closeSecondaryDrawer() {
    if (!secondaryDrawerOpen) return;
    secondaryDrawerOpen = false;
    const drawer = host?.querySelector('.ds-secondary-drawer');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
    syncLayerClasses();
  }

  function clearModalVariant(modal) {
    if (!modal) return;
    const variant = modal.dataset.modalVariant || '';
    if (variant) modal.classList.remove(variant);
    delete modal.dataset.modalVariant;
  }

  function openModal({ title = '', content = '', actions = '', onClose, modalClass = '', keepDrawerOpen = false } = {}) {
    if (!String(content || '').trim() && !String(actions || '').trim() && !title) {
      if (typeof console !== 'undefined') {
        console.warn('[openModal] Blocked: called with no content, no actions, and no title.', new Error().stack);
      }
      return;
    }
    const root = ensureHost();
    const modal = root.querySelector('.ds-modal');
    const titleNode = root.querySelector('.ds-modal__title');
    const contentNode = root.querySelector('.ds-modal__content');
    const footerNode = root.querySelector('.ds-modal__footer');
    if (!modal || !titleNode || !contentNode || !footerNode) return;

    clearModalVariant(modal);
    const variant = String(modalClass || '').trim();
    if (variant) {
      modal.classList.add(variant);
      modal.dataset.modalVariant = variant;
    }

    // Scheduling is the one workspace that intentionally floats above an activity drawer.
    // All ordinary modals retain the historical close-the-drawer behaviour.
    if (drawerOpen && !keepDrawerOpen) closeDrawer();

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
    // Save the opener so focus can be returned when the modal closes.
    modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
    // Return focus before aria-hiding to avoid "Blocked aria-hidden" browser warnings.
    if (modal.contains(document.activeElement)) {
      if (modalOpener && document.body.contains(modalOpener)) {
        modalOpener.focus({ preventScroll: true });
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    modalOpener = null;
    modal.setAttribute('aria-hidden', 'true');
    clearModalVariant(modal);

    const cb = onModalClose;
    onModalClose = null;
    try {
      if (cb) cb();
    } catch (_err) {
      // Safety: never leave the modal layer stuck open.
    } finally {
      syncLayerClasses();
    }
  }

  function closeAll() {
    const root = ensureHost();
    closeModal();
    closeSecondaryDrawer();
    closeDrawer();
    drawerOpen = false;
    modalOpen = false;
    onDrawerClose = null;
    onModalClose = null;
    if (root && document.body.contains(root)) {
      root.classList.remove('is-drawer-open', 'is-modal-open', 'is-backdrop-visible');
      const drawer = root.querySelector('.ds-drawer');
      if (drawer) drawer.setAttribute('aria-hidden', 'true');
      const modal = root.querySelector('.ds-modal');
      if (modal) modal.setAttribute('aria-hidden', 'true');
      const backdrop = root.querySelector('.ds-ui-backdrop');
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
        event.stopPropagation();
        const action = button.dataset.cardAction || '';
        if (!action || typeof onAction !== 'function') return;
        onAction(action, button);
      });
    });
  }

  sharedInteractionLayer = {
    openDrawer,
    closeDrawer,
    openSecondaryDrawer,
    closeSecondaryDrawer,
    openModal,
    closeModal,
    closeAll,
    bindInteractiveCards,
    get isDrawerOpen() {
      return drawerOpen;
    },
    get isModalOpen() {
      return modalOpen;
    },
    get isSecondaryDrawerOpen() {
      return secondaryDrawerOpen;
    }
  };
  return sharedInteractionLayer;
}

export function showConfirmModal(ui, { title = 'אישור פעולה', message = '', confirmLabel = 'אישור', confirmClass = 'ds-btn--danger', onConfirm } = {}) {
  if (!ui) return;
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const actionsHtml = `
    <button type="button" class="ds-btn ds-btn--ghost" data-confirm-cancel>ביטול</button>
    <button type="button" class="ds-btn ${confirmClass}" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
  `;
  ui.openModal({
    title,
    content: `<p style="margin:0;line-height:1.6;direction:rtl">${safeMessage}</p>`,
    actions: actionsHtml,
    onClose: () => {}
  });
  const layer = document.getElementById(UI_LAYER_ID);
  if (!layer) return;
  const okBtn = layer.querySelector('[data-confirm-ok]');
  const cancelBtn = layer.querySelector('[data-confirm-cancel]');
  if (okBtn) {
    okBtn.addEventListener('click', () => {
      ui.closeModal();
      if (typeof onConfirm === 'function') onConfirm();
    }, { once: true });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      ui.closeModal();
    }, { once: true });
  }
}
