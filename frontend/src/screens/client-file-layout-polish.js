const STYLE_ID = 'client-file-layout-polish-v1';

function ensureClientFileStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ds-client-file.is-layout-polished {
      direction: ltr;
      display: grid !important;
      grid-template-columns: minmax(330px, 0.78fr) minmax(0, 1.22fr) !important;
      gap: 16px 20px !important;
      width: 100%;
      max-width: 1120px;
      min-height: 0 !important;
      margin: 0 auto !important;
      padding: 2px 0 12px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      align-items: start;
    }

    #app .ds-client-file.is-layout-polished > * {
      direction: rtl;
      min-width: 0;
    }

    #app .ds-client-file__header {
      grid-column: 1 / -1;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      padding: 4px 2px 14px;
      border-bottom: 1px solid var(--ds-border);
    }

    #app .ds-client-file__heading {
      min-width: 0;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__title {
      margin: 0 !important;
      color: #0f172a;
      font-size: clamp(1.2rem, 2vw, 1.55rem);
      line-height: 1.2;
    }

    #app .ds-client-file__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 5px 16px;
      margin-top: 7px;
    }

    #app .ds-client-file__meta > p {
      display: inline-flex !important;
      grid-template-columns: none !important;
      align-items: baseline;
      gap: 5px !important;
      margin: 0 !important;
      color: #64748b;
      font-size: 0.8rem;
      line-height: 1.35;
    }

    #app .ds-client-file__meta > p > span {
      color: #64748b !important;
      font-weight: 500 !important;
    }

    #app .ds-client-file__meta > p > span::after {
      content: ':';
    }

    #app .ds-client-file__meta > p > strong {
      color: #334155;
      font-weight: 700;
    }

    #app .ds-client-file__header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }

    #app .ds-client-file__header-actions [data-pa-client-add-proposal] {
      min-height: 36px;
      padding: 0 14px;
      border-radius: 10px;
      white-space: nowrap;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__close {
      position: static !important;
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--ds-border) !important;
      border-radius: 10px;
      background: #fff !important;
      color: #64748b !important;
      font-size: 0.95rem !important;
      line-height: 1;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__close:hover,
    #app .ds-client-file.is-layout-polished .ds-client-file__close:focus-visible {
      border-color: color-mix(in srgb, var(--ds-accent) 38%, var(--ds-border)) !important;
      background: var(--ds-accent-soft) !important;
      color: var(--ds-accent) !important;
      outline: 0;
    }

    #app .ds-client-file.is-layout-polished > .ds-client-file__identity {
      grid-column: 2;
      align-self: start;
      padding: 14px 16px 16px;
      border: 1px solid var(--ds-border);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 3px 14px rgba(15, 23, 42, 0.04);
    }

    #app .ds-client-file.is-layout-polished > .ds-client-file__proposals {
      grid-column: 1;
      width: auto !important;
      min-height: 0 !important;
      align-self: start !important;
      padding: 14px 15px 15px !important;
      border: 1px solid var(--ds-border) !important;
      border-radius: 16px !important;
      background: #fff !important;
      box-shadow: 0 3px 14px rgba(15, 23, 42, 0.04) !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__contacts-head,
    #app .ds-client-file.is-layout-polished .ds-client-file__proposals-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 10px !important;
    }

    #app .ds-client-file.is-layout-polished h3 {
      margin: 0 !important;
      color: #0f172a !important;
      font-size: 1rem !important;
      line-height: 1.25;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__contacts-head .ds-btn {
      min-height: 32px;
      padding: 0 10px;
      border-radius: 9px;
      font-size: 0.78rem;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contacts {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px !important;
      margin-top: 0 !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto !important;
      grid-template-rows: auto auto;
      gap: 4px 8px !important;
      min-height: 68px;
      padding: 9px 10px !important;
      border: 1px solid color-mix(in srgb, var(--ds-accent) 16%, var(--ds-border)) !important;
      border-radius: 11px !important;
      background: color-mix(in srgb, var(--ds-accent) 2%, #fff) !important;
      align-items: start !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__identity {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__identity strong {
      overflow: hidden;
      color: #172033;
      font-size: 0.88rem;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__identity span {
      margin-top: 2px;
      color: #64748b;
      font-size: 0.72rem;
      line-height: 1.25;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__channels {
      grid-column: 1;
      grid-row: 2;
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      min-width: 0;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__channels a,
    #app .ds-client-file.is-layout-polished .ds-client-contact__channels span {
      overflow: hidden;
      max-width: 100%;
      color: #64748b;
      font-size: 0.72rem;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__actions {
      grid-column: 2;
      grid-row: 1 / span 2;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__actions button {
      display: inline-grid;
      place-items: center;
      width: 25px;
      height: 25px;
      padding: 0;
      border-radius: 7px;
      color: var(--ds-accent);
      font-size: 0.82rem;
    }

    #app .ds-client-file.is-layout-polished .ds-client-contact__actions button:hover,
    #app .ds-client-file.is-layout-polished .ds-client-contact__actions button:focus-visible {
      background: var(--ds-accent-soft);
      outline: 0;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal {
      margin: 6px 0 !important;
      padding: 4px !important;
      border-color: color-mix(in srgb, var(--ds-accent) 18%, var(--ds-border)) !important;
      border-radius: 11px !important;
      box-shadow: none !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal__main {
      grid-template-columns: 22px minmax(0, 1fr) auto !important;
      gap: 7px !important;
      padding: 7px 8px !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal__main strong {
      color: #172033;
      font-size: 0.85rem;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal__main small {
      font-size: 0.69rem !important;
      line-height: 1.3;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal__main b {
      color: #0f766e;
      font-size: 0.78rem !important;
      white-space: nowrap;
    }

    #app .ds-client-file.is-layout-polished .ds-client-proposal__actions {
      padding: 0 7px 5px !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-file__proposals > hr {
      display: none !important;
    }

    #app .ds-client-file.is-layout-polished .ds-client-archive {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--ds-border);
    }

    #app .ds-client-file.is-layout-polished .ds-client-archive summary {
      color: #64748b;
      font-size: 0.78rem;
      font-weight: 650;
    }

    #app .ds-client-file.is-layout-polished .ds-client-archive.is-empty summary {
      cursor: default;
      color: #94a3b8;
      font-weight: 500;
      list-style: none;
    }

    #app .ds-client-file.is-layout-polished .ds-client-archive.is-empty summary::-webkit-details-marker {
      display: none;
    }

    #app .ds-client-file.is-layout-polished .ds-client-archive.is-empty > div {
      display: none;
    }

    #app .ds-client-file.is-layout-polished .ds-client-empty {
      margin: 8px 0 0;
      font-size: 0.78rem;
    }

    @media (max-width: 1000px) {
      #app .ds-client-file.is-layout-polished {
        direction: rtl;
        grid-template-columns: 1fr !important;
        gap: 12px !important;
      }

      #app .ds-client-file__header,
      #app .ds-client-file.is-layout-polished > .ds-client-file__identity,
      #app .ds-client-file.is-layout-polished > .ds-client-file__proposals {
        grid-column: 1 !important;
      }
    }

    @media (max-width: 680px) {
      #app .ds-client-file__header {
        flex-direction: column;
        gap: 10px;
      }

      #app .ds-client-file__header-actions {
        width: 100%;
        justify-content: space-between;
      }

      #app .ds-client-file.is-layout-polished .ds-client-contacts {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function normalizedText(element) {
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('he-IL');
}

function dedupeVisibleContacts(file) {
  const contactsHost = file.querySelector('.ds-client-contacts');
  if (!contactsHost) return;
  const kept = [];
  contactsHost.querySelectorAll('.ds-client-contact').forEach((card) => {
    const name = normalizedText(card.querySelector('.ds-client-contact__identity strong'));
    const role = normalizedText(card.querySelector('.ds-client-contact__identity span'));
    const channels = new Set(Array.from(card.querySelectorAll('.ds-client-contact__channels a'))
      .map((item) => normalizedText(item))
      .filter(Boolean));
    const duplicate = kept.some((record) => {
      if (!name || record.name !== name) return false;
      if (channels.size && record.channels.size) {
        return Array.from(channels).some((channel) => record.channels.has(channel));
      }
      return role && record.role === role;
    });
    if (duplicate) {
      card.remove();
      return;
    }
    kept.push({ name, role, channels });
  });
}

function decorateArchive(file) {
  const archive = file.querySelector('.ds-client-archive');
  const summary = archive?.querySelector('summary');
  if (!archive || !summary) return;
  const match = String(summary.textContent || '').match(/(\d+)\s*$/);
  const count = match ? Number(match[1]) : archive.querySelectorAll('.ds-client-proposal').length;
  archive.open = false;
  if (!count) {
    archive.classList.add('is-empty');
    summary.textContent = 'אין הצעות קודמות';
    return;
  }
  archive.classList.remove('is-empty');
  summary.textContent = `הצעות קודמות (${count})`;
}

function buildCompactHeader(file) {
  if (file.querySelector(':scope > .ds-client-file__header')) return;
  const identity = Array.from(file.children).find((item) => item.classList?.contains('ds-client-file__identity'));
  const proposals = Array.from(file.children).find((item) => item.classList?.contains('ds-client-file__proposals'));
  if (!identity || !proposals) return;

  const title = identity.querySelector('.ds-client-file__title');
  const metaRows = Array.from(identity.children).filter((item) => item.tagName === 'P');
  const closeButton = Array.from(file.children).find((item) => item.matches?.('[data-pa-client-close]'));
  const proposalsHead = proposals.querySelector('.ds-client-file__proposals-head');
  const addProposalButton = proposalsHead?.querySelector('[data-pa-client-add-proposal]');
  const proposalsTitle = proposalsHead?.querySelector('h3');
  if (proposalsTitle) proposalsTitle.textContent = 'הצעות מחיר';

  const header = document.createElement('header');
  header.className = 'ds-client-file__header';

  const heading = document.createElement('div');
  heading.className = 'ds-client-file__heading';
  if (title) heading.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'ds-client-file__meta';
  metaRows.forEach((row) => meta.appendChild(row));
  heading.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'ds-client-file__header-actions';
  if (addProposalButton) actions.appendChild(addProposalButton);
  if (closeButton) actions.appendChild(closeButton);

  header.append(heading, actions);
  file.insertBefore(header, file.firstChild);
}

function polishClientFile(file) {
  if (!file || file.dataset.layoutPolished === 'yes') return;
  ensureClientFileStyle();
  buildCompactHeader(file);
  dedupeVisibleContacts(file);
  decorateArchive(file);
  file.classList.add('is-layout-polished');
  file.dataset.layoutPolished = 'yes';
}

function polishAllClientFiles() {
  document.querySelectorAll('#app [data-pa-client-file]').forEach(polishClientFile);
}

let polishQueued = false;
function scheduleClientFilePolish() {
  if (polishQueued) return;
  polishQueued = true;
  requestAnimationFrame(() => {
    polishQueued = false;
    polishAllClientFiles();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleClientFilePolish, { once: true });
} else {
  scheduleClientFilePolish();
}

new MutationObserver(scheduleClientFilePolish).observe(document.documentElement, {
  childList: true,
  subtree: true
});
