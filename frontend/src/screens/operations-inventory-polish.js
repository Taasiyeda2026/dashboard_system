function addInventoryPolishStyle() {
  if (document.getElementById('ops-inventory-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-inventory-polish-style';
  style.textContent = `
    .ds-ops-workshops-panel [data-ops-print-workshops] { display: none !important; }
    .ds-ops-workshops-panel .ds-ops-usage-cell {
      position: relative !important;
      cursor: pointer !important;
      text-align: center !important;
      padding-left: 24px !important;
      padding-right: 24px !important;
      transition: background-color .16s ease, box-shadow .16s ease;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell:hover {
      background: #f8fbfd !important;
      box-shadow: inset 0 0 0 1px #cfe1ec;
    }
    .ds-ops-workshops-panel .ds-ops-usage-display {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
      font-weight: 700 !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell .ds-ops-stock-edit-btn {
      position: absolute !important;
      left: 6px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 16px !important;
      height: 16px !important;
      min-width: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #94a3b8 !important;
      font-size: 11px !important;
      line-height: 16px !important;
      opacity: 0 !important;
      box-shadow: none !important;
      transition: opacity .16s ease, color .16s ease;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell:hover .ds-ops-stock-edit-btn,
    .ds-ops-workshops-panel .ds-ops-usage-cell:focus-within .ds-ops-stock-edit-btn {
      opacity: 1 !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell .ds-ops-stock-edit-btn:hover {
      color: var(--ds-accent, #0292b7) !important;
      background: transparent !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell.ops-inventory-edited {
      background: #f0fdf4 !important;
    }
    .ds-ops-workshops-panel .ds-ops-usage-cell.ops-inventory-edited::after {
      content: '';
      position: absolute;
      right: 7px;
      top: 50%;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #22c55e;
      transform: translateY(-50%);
      box-shadow: 0 0 0 2px #dcfce7;
    }
  `;
  document.head.appendChild(style);
}

function renameInventoryTab() {
  document.querySelectorAll('.ds-ops-mgmt-tab').forEach((button) => {
    if (String(button.textContent || '').trim() === 'כמויות סדנאות') {
      button.textContent = 'ציוד ומלאי';
    }
  });
}

function polishUsageCells() {
  document.querySelectorAll('.ds-ops-workshops-panel .ds-ops-usage-cell').forEach((cell) => {
    const editButton = cell.querySelector('.ds-ops-stock-edit-btn');
    if (!editButton) return;
    editButton.title = 'עריכת שימוש מלאי';
    editButton.setAttribute('aria-label', 'עריכת שימוש מלאי');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    if (cell.dataset.inventoryPolished) return;
    cell.dataset.inventoryPolished = '1';
    cell.addEventListener('click', (event) => {
      if (event.target.closest('.ds-ops-stock-edit-btn')) return;
      editButton.click();
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      editButton.click();
    });
    editButton.addEventListener('click', () => {
      setTimeout(() => cell.classList.add('ops-inventory-edited'), 850);
    });
  });
}

function runInventoryPolish() {
  addInventoryPolishStyle();
  renameInventoryTab();
  polishUsageCells();
}

function scheduleInventoryPolish() {
  setTimeout(runInventoryPolish, 90);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleInventoryPolish, { once: true });
  else scheduleInventoryPolish();
  new MutationObserver(scheduleInventoryPolish).observe(document.documentElement, { childList: true, subtree: true });
}
