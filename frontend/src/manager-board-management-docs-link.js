const MANAGEMENT_DOCS_URL = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/Forms/view.aspx?FolderCTID=0x012000A5A5234B5799C3499038E27027EDF12F&id=%2Fsites%2Ftaasiyeda2027%2FShared%20Documents%2F%D7%A0%D7%99%D7%94%D7%95%D7%9C';
const STYLE_ID = 'manager-management-docs-link-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .manager-workspace-management-with-docs{display:inline-flex;align-items:center;gap:5px;min-width:0}
    .manager-workspace-management-docs{display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;width:36px;height:36px;box-sizing:border-box;border:1px solid #e49a00;border-radius:9px;background:#ffad00;color:#fff;box-shadow:0 3px 10px rgba(245,158,11,.38);text-decoration:none;cursor:pointer;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}
    .manager-workspace-management-docs:hover{background:#f59e0b;color:#fff;transform:translateY(-1px);box-shadow:0 5px 14px rgba(245,158,11,.46)}
    .manager-workspace-management-docs:focus-visible{outline:3px solid rgba(14,165,233,.35);outline-offset:2px}
    .manager-workspace-management-docs svg{width:21px;height:21px;display:block}
    @media(max-width:720px){.manager-workspace-management-with-docs{width:100%}.manager-workspace-management-with-docs .manager-workspace-tab{flex:1;min-width:0}.manager-workspace-management-docs{flex-basis:32px;width:32px;height:32px}.manager-workspace-management-docs svg{width:19px;height:19px}}
  `;
  document.head.appendChild(style);
}

function buildLink() {
  const link = document.createElement('a');
  link.className = 'manager-workspace-management-docs';
  link.dataset.managerManagementDocs = 'true';
  link.href = MANAGEMENT_DOCS_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'מסמכי ניהול';
  link.setAttribute('aria-label', 'פתיחת מסמכי הניהול ב-SharePoint');
  link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3.5 6.75A1.75 1.75 0 0 1 5.25 5h4.1c.46 0 .9.18 1.22.5l1.18 1.18c.33.33.77.52 1.24.52h5.76a1.75 1.75 0 0 1 1.75 1.75v7.8a2.25 2.25 0 0 1-2.25 2.25H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.75 10h16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  link.addEventListener('click', (event) => event.stopPropagation());
  return link;
}

function attachManagementDocsLink() {
  const nav = document.querySelector('.manager-workspace-tabs[data-manager-workspace-tabs], .manager-workspace-tabs');
  if (!nav || nav.querySelector('[data-manager-management-docs]')) return;
  const managementTab = nav.querySelector('[data-manager-workspace-tab="management"]');
  if (!managementTab) return;
  ensureStyle();
  const wrapper = document.createElement('span');
  wrapper.className = 'manager-workspace-management-with-docs';
  managementTab.before(wrapper);
  wrapper.append(managementTab, buildLink());
}

function scheduleAttach() {
  requestAnimationFrame(attachManagementDocsLink);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleAttach, { once: true });
  else scheduleAttach();
  const root = document.getElementById('app') || document.documentElement;
  if (typeof MutationObserver === 'function') new MutationObserver(scheduleAttach).observe(root, { childList: true, subtree: true });
  document.addEventListener('app:navigate', scheduleAttach);
}

export { MANAGEMENT_DOCS_URL, attachManagementDocsLink };
