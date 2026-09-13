const STYLE_ID = 'ds-pa-proposal-activity-drawer-style-v1';
const ENHANCED_ATTR = 'data-pa-activity-drawer-style';

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function infoValueByLabel(detail, wantedLabel) {
  const cell = Array.from(detail.querySelectorAll('.ds-pa-info-cell')).find((candidate) =>
    text(candidate.querySelector('.ds-pa-info-label')?.textContent) === wantedLabel
  );
  return text(cell?.querySelector('.ds-pa-info-value')?.textContent);
}

export function ensureProposalActivityDrawerStyles(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef?.head || documentRef.getElementById(STYLE_ID)) return false;

  const style = documentRef.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html body #app [data-pa-proposal-detail].ds-pa-proposal-detail {
      position: fixed !important;
      inset: 0 !important;
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      width: 100% !important;
      max-width: none !important;
      z-index: 1450 !important;
      display: flex !important;
      align-items: stretch !important;
      justify-content: flex-start !important;
      padding: 0 !important;
      margin: 0 !important;
      background: rgba(15, 23, 42, 0.48) !important;
      overflow: hidden !important;
    }
    html body #app [data-pa-proposal-detail] > .ds-pa-proposal-detail-toolbar {
      display: none !important;
    }
    html body #app [data-pa-proposal-detail] > .ds-pa-drawer {
      position: relative !important;
      inset: auto !important;
      inline-size: min(820px, 55vw) !important;
      width: min(820px, 55vw) !important;
      max-inline-size: calc(100vw - 32px) !important;
      max-width: calc(100vw - 32px) !important;
      block-size: 100% !important;
      height: 100% !important;
      max-block-size: 100% !important;
      max-height: 100% !important;
      margin: 0 auto 0 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: #fff !important;
      box-shadow: 18px 0 48px rgba(15, 23, 42, 0.24) !important;
      overflow: hidden !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-panel {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      max-width: none !important;
      height: 100% !important;
      max-height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: #f4f6f9 !important;
      overflow: hidden !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-head {
      position: relative !important;
      z-index: 4 !important;
      flex: 0 0 auto !important;
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: 16px !important;
      padding: 18px 20px 10px !important;
      border: 0 !important;
      background: linear-gradient(135deg, #1a2740 0%, #243b60 100%) !important;
      color: #fff !important;
      box-shadow: none !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-head-info {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-name--hero {
      margin: 0 0 8px !important;
      color: #fff !important;
      font-size: clamp(1.3rem, 2vw, 1.7rem) !important;
      font-weight: 800 !important;
      line-height: 1.2 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-meta-line {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 6px !important;
      margin: 0 !important;
      color: rgba(255,255,255,.88) !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-meta-sep {
      display: none !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-meta-item {
      display: inline-flex !important;
      align-items: center !important;
      min-height: 27px !important;
      padding: 4px 12px !important;
      border: 1px solid rgba(255,255,255,.22) !important;
      border-radius: 999px !important;
      background: rgba(255,255,255,.94) !important;
      color: #526176 !important;
      font-size: .78rem !important;
      font-weight: 750 !important;
      line-height: 1 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-meta-item--status {
      border-color: rgba(34, 197, 94, .28) !important;
      background: #ecfdf3 !important;
      color: #157347 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-meta-item--type {
      color: #334155 !important;
    }
    html body #app [data-pa-proposal-detail] [data-pa-close-drawer] {
      flex: 0 0 auto !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 38px !important;
      min-width: 38px !important;
      height: 38px !important;
      padding: 0 !important;
      border: 1px solid rgba(255,255,255,.2) !important;
      border-radius: 50% !important;
      background: rgba(255,255,255,.06) !important;
      color: rgba(255,255,255,.78) !important;
      font-size: 1.05rem !important;
      line-height: 1 !important;
      box-shadow: none !important;
    }
    html body #app [data-pa-proposal-detail] [data-pa-close-drawer]:hover {
      background: rgba(255,255,255,.14) !important;
      color: #fff !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-action-bar {
      position: relative !important;
      z-index: 4 !important;
      flex: 0 0 auto !important;
      min-height: 46px !important;
      padding: 0 20px 16px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 12px !important;
      border: 0 !important;
      border-bottom: 1px solid rgba(255,255,255,.1) !important;
      background: linear-gradient(135deg, #1a2740 0%, #243b60 100%) !important;
      color: #fff !important;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16) !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-badges {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 6px !important;
      min-width: 0 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-badges .ds-pa-state-note {
      margin: 0 !important;
      border-color: rgba(255,255,255,.2) !important;
      background: rgba(255,255,255,.12) !important;
      color: #fff !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-icon-btns {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 7px !important;
      flex-wrap: wrap !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-icon-btns .ds-pa-row-action {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 34px !important;
      min-width: 34px !important;
      height: 34px !important;
      padding: 0 !important;
      border: 1px solid rgba(255,255,255,.24) !important;
      border-radius: 50% !important;
      background: rgba(255,255,255,.96) !important;
      color: #28415f !important;
      box-shadow: none !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-icon-btns .ds-pa-row-action--danger {
      color: #b42318 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-drawer-body {
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow-y: auto !important;
      overscroll-behavior: contain !important;
      padding: 16px 18px 24px !important;
      background: #f4f6f9 !important;
      scrollbar-gutter: stable;
    }
    html body #app [data-pa-proposal-detail] [data-proposal-activity-creator-host]:empty,
    html body #app [data-pa-proposal-detail] [data-proposal-domain-routing-host]:empty {
      display: none !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      align-items: start !important;
      gap: 12px !important;
      margin: 0 0 14px !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-info-card,
    html body #app [data-pa-proposal-detail] .ds-pa-activities-wide {
      width: 100% !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 14px 16px !important;
      box-sizing: border-box !important;
      border: 1px solid #d9dee7 !important;
      border-radius: 14px !important;
      background: #fff !important;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .04) !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-card-title {
      margin: 0 0 10px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: #27324a !important;
      font-size: .92rem !important;
      font-weight: 800 !important;
      line-height: 1.25 !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-info-grid {
      gap: 10px 14px !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-activities-wide {
      margin-top: 0 !important;
      padding: 14px 16px 12px !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-activities-wide > .ds-pa-card-title {
      margin-bottom: 9px !important;
    }
    html body #app [data-pa-proposal-detail] [data-pa-drawer-items] {
      height: auto !important;
      min-height: 0 !important;
    }
    html body #app [data-pa-proposal-detail] .proposal-activity-creator {
      margin-top: 10px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    html body #app [data-pa-proposal-detail] .proposal-activity-creator__head {
      margin-bottom: 4px !important;
    }
    html body #app [data-pa-proposal-detail] .proposal-activity-creator__title {
      color: #27324a !important;
      font-size: .9rem !important;
    }
    html body #app [data-pa-proposal-detail] .proposal-activity-creator__item {
      gap: 12px !important;
      padding: 10px 0 !important;
      border-top-color: #e5e9f0 !important;
    }
    html body #app [data-pa-proposal-detail] .proposal-activity-creator__button {
      min-width: 112px !important;
      padding: 6px 10px !important;
      border-radius: 8px !important;
      font-size: .78rem !important;
      box-shadow: none !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary {
      margin-top: 10px !important;
    }
    html body #app [data-pa-proposal-detail] .ds-pa-notes-card {
      margin-top: 12px !important;
    }
    @media (max-width: 1180px) {
      html body #app [data-pa-proposal-detail] > .ds-pa-drawer {
        inline-size: min(760px, 64vw) !important;
        width: min(760px, 64vw) !important;
      }
    }
    @media (max-width: 900px) {
      html body #app [data-pa-proposal-detail] > .ds-pa-drawer {
        inline-size: 100vw !important;
        width: 100vw !important;
        max-inline-size: 100vw !important;
        max-width: 100vw !important;
      }
      html body #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid {
        grid-template-columns: 1fr !important;
      }
      html body #app [data-pa-proposal-detail] .ds-pa-drawer-head {
        padding-inline: 16px !important;
      }
      html body #app [data-pa-proposal-detail] .ds-pa-drawer-action-bar {
        padding-inline: 16px !important;
      }
      html body #app [data-pa-proposal-detail] .ds-pa-drawer-body {
        padding-inline: 14px !important;
      }
    }
  `;
  documentRef.head.appendChild(style);
  return true;
}

export function enhanceProposalActivityDrawer(detail) {
  if (!detail?.querySelector) return false;
  detail.classList.add('ds-pa-proposal-detail--activity-style');
  detail.setAttribute(ENHANCED_ATTR, 'true');

  const metaLine = detail.querySelector('.ds-pa-drawer-meta-line');
  if (metaLine) {
    metaLine.querySelectorAll('.ds-pa-drawer-meta-item').forEach((item) => item.classList.add('ds-pa-drawer-meta-chip'));
    const typeValue = infoValueByLabel(detail, 'סוג הצעה');
    if (typeValue && !metaLine.querySelector('.ds-pa-drawer-meta-item--type')) {
      const chip = detail.ownerDocument.createElement('span');
      chip.className = 'ds-pa-drawer-meta-item ds-pa-drawer-meta-item--type ds-pa-drawer-meta-chip';
      chip.textContent = typeValue;
      metaLine.prepend(chip);
    }
  }

  detail.querySelector('[data-pa-close-drawer]')?.classList.add('ds-pa-drawer-close--activity');
  detail.querySelector('.ds-pa-drawer-action-bar')?.classList.add('ds-pa-drawer-action-bar--activity');
  return true;
}

export function applyProposalActivityDrawerStyle(root = globalThis.document, scope = globalThis) {
  if (!root?.querySelectorAll) return root;
  ensureProposalActivityDrawerStyles(scope);
  root.querySelectorAll('[data-pa-proposal-detail]').forEach((detail) => enhanceProposalActivityDrawer(detail));
  return root;
}

export function installProposalActivityDrawerStyle(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef) return false;
  if (scope.__dsProposalActivityDrawerStyleInstalled) return false;
  scope.__dsProposalActivityDrawerStyleInstalled = true;

  const apply = () => applyProposalActivityDrawerStyle(documentRef, scope);
  if (documentRef.readyState === 'loading') {
    documentRef.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  const root = documentRef.getElementById('app') || documentRef.documentElement;
  if (root && typeof scope.MutationObserver === 'function') {
    new scope.MutationObserver(apply).observe(root, { childList: true, subtree: true });
  }
  return true;
}

installProposalActivityDrawerStyle(globalThis);
