import { supabase } from './supabase-client.js';

const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const TABLE_SELECTOR = '.israa-v2__table';
const DEBOUNCE_MS = 70;
const rowCache = new Map();
let timer = null;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, '')) || 0;
  return `${number.toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪`;
}

function formatDate(value) {
  if (!value) return '—';
  const parts = String(value).slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : clean(value);
}

function injectStyles() {
  if (document.getElementById('israa-tracking-hierarchy-styles')) return;
  const style = document.createElement('style');
  style.id = 'israa-tracking-hierarchy-styles';
  style.textContent = `
    .israa-v2__table th.israa-group-identification { background:#f8fafc !important; }
    .israa-v2__table th.israa-group-activity { background:#f0f9ff !important; }
    .israa-v2__table th.israa-group-finance { background:#f7fee7 !important; }
    .israa-v2__table th.israa-group-tracking { background:#fff7ed !important; }
    .israa-v2__table th.israa-group-actions { background:#f8fafc !important; }
    .israa-v2__table :is(th,td).israa-group-start { border-inline-start:2px solid #cbd5e1 !important; }
    .israa-v2__school-identity { display:grid; gap:2px; min-width:0; }
    .israa-v2__school-name { min-width:0; font-weight:750; line-height:1.25; white-space:normal; }
    .israa-v2__school-symbol { color:#64748b; font-size:9.5px; line-height:1.2; white-space:nowrap; }
    .israa-v2__school-edit { display:grid; grid-template-columns:minmax(120px,1fr) 76px; gap:5px; align-items:center; }
    .israa-v2__school-edit-label { display:grid; gap:2px; color:#64748b; font-size:8.5px; }
    .israa-v2__detail-panel.israa-hierarchy-ready {
      display:grid !important;
      grid-template-columns:repeat(2,minmax(0,1fr)) !important;
      gap:9px !important;
      padding:10px !important;
      background:#f8fafc;
    }
    .israa-v2__detail-section {
      min-width:0;
      border:1px solid #dbe3ec;
      border-radius:9px;
      background:#fff;
      overflow:hidden;
    }
    .israa-v2__detail-section--wide { grid-column:1 / -1; }
    .israa-v2__detail-section-title {
      margin:0;
      padding:6px 9px;
      border-bottom:1px solid #e2e8f0;
      background:#f1f5f9;
      color:#334155;
      font-size:10.5px;
      font-weight:850;
    }
    .israa-v2__detail-section-grid {
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:7px 10px;
      padding:8px 9px;
    }
    .israa-v2__detail-section-grid--proposal { grid-template-columns:repeat(4,minmax(0,1fr)); }
    .israa-v2__detail-section-grid--notes { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .israa-v2__detail-section .israa-v2__detail-item { min-width:0; }
    .israa-v2__detail-section .israa-v2__detail-item--wide { grid-column:auto !important; }
    .israa-v2__detail-section textarea { min-height:72px; }
    .israa-v2__program-table-wrap { overflow-x:auto; padding:8px 9px; }
    .israa-v2__program-table { width:100%; min-width:650px; border-collapse:collapse; font-size:10.5px; }
    .israa-v2__program-table th,
    .israa-v2__program-table td { padding:5px 6px; border:1px solid #e2e8f0; text-align:right; }
    .israa-v2__program-table th { background:#f8fafc; color:#475569; font-weight:800; }
    .israa-v2__program-empty { padding:10px; color:#64748b; font-size:10.5px; }
    @media (max-width:900px) {
      .israa-v2__detail-panel.israa-hierarchy-ready { grid-template-columns:1fr !important; }
      .israa-v2__detail-section--wide { grid-column:auto; }
      .israa-v2__detail-section-grid,
      .israa-v2__detail-section-grid--proposal,
      .israa-v2__detail-section-grid--notes { grid-template-columns:1fr 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function headerIndex(table, label) {
  return [...table.querySelectorAll('thead th')].findIndex((th) => clean(th.textContent) === label);
}

function groupForLabel(label) {
  if (['בית ספר וסמל מוסד', 'רשות', 'מס׳ הצעה'].includes(label)) return 'identification';
  if (['תוכנית', 'מס׳ גפ״ן', 'קבוצות'].includes(label)) return 'activity';
  if (['סכום', 'סבירות', 'צבר ריאלי'].includes(label)) return 'finance';
  if (['סטטוס', 'תאריך מעקב', 'הפעולה הבאה'].includes(label)) return 'tracking';
  return 'actions';
}

function applyColumnGroups(table) {
  const headers = [...table.querySelectorAll('thead th')];
  const groupStarts = new Set();
  let previous = '';
  headers.forEach((header, index) => {
    const group = groupForLabel(clean(header.textContent));
    header.classList.add(`israa-group-${group}`);
    if (group !== previous) groupStarts.add(index);
    previous = group;
  });

  table.querySelectorAll('thead tr, tbody > tr.israa-v2__row').forEach((row) => {
    [...row.children].forEach((cell, index) => {
      const header = headers[index];
      if (!header) return;
      const group = groupForLabel(clean(header.textContent));
      cell.classList.add(`israa-group-${group}`);
      if (groupStarts.has(index)) cell.classList.add('israa-group-start');
    });
  });
}

function combineSchoolAndSymbol(table) {
  const schoolIndex = headerIndex(table, 'בית ספר');
  const symbolIndex = headerIndex(table, 'סמל מוסד');
  if (schoolIndex < 0 || symbolIndex < 0) return;

  const headers = [...table.querySelectorAll('thead th')];
  headers[schoolIndex].textContent = 'בית ספר וסמל מוסד';
  headers[symbolIndex].remove();

  const cols = [...table.querySelectorAll('colgroup col')];
  if (cols[symbolIndex]) cols[symbolIndex].remove();
  if (cols[schoolIndex]) cols[schoolIndex].style.width = '218px';

  table.querySelectorAll('tbody > tr.israa-v2__row').forEach((row) => {
    const cells = [...row.children];
    const schoolCell = cells[schoolIndex];
    const symbolCell = cells[symbolIndex];
    if (!schoolCell || !symbolCell) return;

    const editing = row.classList.contains('is-editing') || row.classList.contains('is-new');
    if (editing) {
      const schoolContent = document.createElement('div');
      schoolContent.className = 'israa-v2__school-edit';
      const schoolPart = document.createElement('div');
      while (schoolCell.firstChild) schoolPart.appendChild(schoolCell.firstChild);
      const symbolPart = document.createElement('label');
      symbolPart.className = 'israa-v2__school-edit-label';
      symbolPart.innerHTML = '<span>סמל מוסד</span>';
      while (symbolCell.firstChild) symbolPart.appendChild(symbolCell.firstChild);
      schoolContent.append(schoolPart, symbolPart);
      schoolCell.appendChild(schoolContent);
    } else {
      const schoolText = clean(schoolCell.textContent);
      const symbolText = clean(symbolCell.textContent);
      schoolCell.innerHTML = `<div class="israa-v2__school-identity"><span class="israa-v2__school-name">${escapeHtml(schoolText || '—')}</span><span class="israa-v2__school-symbol">סמל מוסד: ${escapeHtml(symbolText || '—')}</span></div>`;
    }
    symbolCell.remove();
  });

  table.querySelectorAll('tbody > tr.israa-v2__detail td[colspan]').forEach((cell) => {
    const current = Number(cell.getAttribute('colspan') || 1);
    cell.setAttribute('colspan', String(Math.max(1, current - 1)));
  });
}

async function loadRow(rowId) {
  if (!rowId || rowId === '__new__') return null;
  const cached = rowCache.get(rowId);
  if (cached && Date.now() - cached.at < 30000) return cached.data;
  const { data, error } = await supabase
    .from('israa_program_tracking')
    .select('*')
    .eq('id', rowId)
    .maybeSingle();
  if (error) throw error;
  rowCache.set(rowId, { at: Date.now(), data: data || null });
  return data || null;
}

function itemByLabel(panel, label) {
  return [...panel.querySelectorAll(':scope > .israa-v2__detail-item')]
    .find((item) => clean(item.querySelector('.israa-v2__detail-label')?.textContent) === label) || null;
}

function detailField(label, key, value, editing, type = 'text') {
  const safeValue = value == null ? '' : String(value);
  let control;
  if (!editing) {
    control = `<div class="israa-v2__detail-value">${escapeHtml(type === 'date' ? formatDate(safeValue) : (clean(safeValue) || '—'))}</div>`;
  } else if (type === 'textarea') {
    control = `<textarea class="israa-v2__textarea" data-v2-field="${escapeHtml(key)}">${escapeHtml(safeValue)}</textarea>`;
  } else {
    const list = key === 'outreach_method' ? ' list="israa-v2-outreach-options"' : '';
    control = `<input class="israa-v2__input" data-v2-field="${escapeHtml(key)}" type="${type}" value="${escapeHtml(safeValue)}"${list}>`;
  }
  return `<div class="israa-v2__detail-item"><span class="israa-v2__detail-label">${escapeHtml(label)}</span>${control}</div>`;
}

function section(title, className, items) {
  const element = document.createElement('section');
  element.className = `israa-v2__detail-section ${className || ''}`.trim();
  element.innerHTML = `<h4 class="israa-v2__detail-section-title">${escapeHtml(title)}</h4><div class="israa-v2__detail-section-grid"></div>`;
  const grid = element.querySelector('.israa-v2__detail-section-grid');
  items.filter(Boolean).forEach((item) => grid.appendChild(item));
  return element;
}

function programsFromRow(data, mainRow) {
  if (Array.isArray(data?.proposal_items) && data.proposal_items.length) return data.proposal_items;
  const program = clean(mainRow?.querySelector('[data-v2-field="program_name"]')?.value || mainRow?.querySelector('.israa-v2__program-name')?.textContent);
  if (!program) return [];
  return [{
    program_name: program,
    gefen_number: clean(mainRow?.querySelector('[data-v2-field="gefen_numbers"]')?.value || ''),
    quantity: clean(mainRow?.querySelector('[data-v2-field="quantity"]')?.value || ''),
    total_price: clean(mainRow?.querySelector('[data-v2-field="total_amount"]')?.value || '')
  }];
}

function programsSection(data, mainRow) {
  const items = programsFromRow(data, mainRow);
  const sectionElement = document.createElement('section');
  sectionElement.className = 'israa-v2__detail-section israa-v2__detail-section--wide';
  sectionElement.innerHTML = '<h4 class="israa-v2__detail-section-title">פירוט מלא של התוכניות</h4>';
  if (!items.length) {
    sectionElement.insertAdjacentHTML('beforeend', '<div class="israa-v2__program-empty">טרם נבחרה תוכנית.</div>');
    return sectionElement;
  }
  const rows = items.map((item) => `<tr>
    <td>${escapeHtml(clean(item.program_name || item.item_name) || '—')}</td>
    <td>${escapeHtml(clean(item.gefen_number) || '—')}</td>
    <td>${escapeHtml(clean(item.quantity) || '—')}</td>
    <td>${escapeHtml(item.total_price == null || item.total_price === '' ? '—' : formatMoney(item.total_price))}</td>
    <td>${escapeHtml(clean(item.meetings_count) || '—')}</td>
    <td>${escapeHtml(clean(item.hours_count) || '—')}</td>
  </tr>`).join('');
  sectionElement.insertAdjacentHTML('beforeend', `<div class="israa-v2__program-table-wrap"><table class="israa-v2__program-table"><thead><tr><th>תוכנית</th><th>מס׳ גפ״ן</th><th>קבוצות</th><th>סכום</th><th>מפגשים</th><th>שעות</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  return sectionElement;
}

async function organizeDetail(detailRow, table) {
  const panel = detailRow.querySelector('.israa-v2__detail-panel');
  if (!panel || panel.classList.contains('israa-hierarchy-ready')) return;
  const rowId = detailRow.dataset.v2DetailFor;
  const mainRow = table.querySelector(`tbody > tr.israa-v2__row[data-v2-row-id="${CSS.escape(rowId || '')}"]`);
  const editing = rowId === '__new__' || mainRow?.classList.contains('is-editing');

  let data = null;
  try {
    data = await loadRow(rowId);
  } catch (error) {
    console.error('[israa-hierarchy-row-load]', error);
  }

  const contactItems = [
    itemByLabel(panel, 'איש קשר'),
    itemByLabel(panel, 'טלפון'),
    itemByLabel(panel, 'דוא״ל')
  ];
  const dateItem = itemByLabel(panel, 'תאריך הצעה');
  const natureItem = itemByLabel(panel, 'אופי ההצעה');
  const notesItem = itemByLabel(panel, 'הערות / חסמים');
  if (notesItem) {
    const label = notesItem.querySelector('.israa-v2__detail-label');
    if (label) label.textContent = 'הערות';
  }

  const contactSection = section('פרטי איש הקשר', '', contactItems);
  const proposalSection = section('פרטי ההצעה', '', [
    dateItem,
    natureItem,
    htmlToElement(detailField('תוקף ההצעה', 'valid_until', data?.valid_until, editing, 'date')),
    htmlToElement(detailField('אופן הפנייה', 'outreach_method', data?.outreach_method, editing, 'text'))
  ]);
  proposalSection.querySelector('.israa-v2__detail-section-grid')?.classList.add('israa-v2__detail-section-grid--proposal');

  const notesSection = section('הערות וחסמים', 'israa-v2__detail-section--wide', [
    notesItem,
    htmlToElement(detailField('חסמים', 'barriers', data?.barriers, editing, 'textarea'))
  ]);
  notesSection.querySelector('.israa-v2__detail-section-grid')?.classList.add('israa-v2__detail-section-grid--notes');

  panel.innerHTML = '';
  panel.classList.add('israa-hierarchy-ready');
  panel.append(contactSection, proposalSection, notesSection, programsSection(data, mainRow));
  if (editing && !document.getElementById('israa-v2-outreach-options')) {
    const list = document.createElement('datalist');
    list.id = 'israa-v2-outreach-options';
    list.innerHTML = ['שיחה טלפונית','דוא״ל','פגישה','וואטסאפ','פנייה יזומה','הפניה','אחר']
      .map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
    panel.appendChild(list);
  }
}

function htmlToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

async function enhanceContainer(container) {
  const table = container.querySelector(TABLE_SELECTOR);
  if (!table || table.dataset.israaHierarchyReady === 'true') return;
  table.dataset.israaHierarchyReady = 'true';
  combineSchoolAndSymbol(table);
  applyColumnGroups(table);
  for (const detailRow of table.querySelectorAll('tbody > tr.israa-v2__detail')) {
    await organizeDetail(detailRow, table);
  }
}

async function run() {
  injectStyles();
  for (const container of document.querySelectorAll(CONTAINER_SELECTOR)) {
    await enhanceContainer(container);
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => run().catch((error) => console.error('[israa-tracking-hierarchy]', error)), DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
window.addEventListener('hashchange', schedule);
window.addEventListener('israa-tracking-updated', () => {
  rowCache.clear();
  schedule();
});
