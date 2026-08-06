import * as XLSX from 'xlsx';

const MAIN_HEADERS = [
  'מספר הצעה', 'תאריך הצעה', 'רשות', 'בעלות', 'בית ספר', 'סמל מוסד',
  'איש קשר', 'תפקיד', 'טלפון', 'דוא״ל', 'סוג פעילות', 'פירוט ההצעה', 'מספרי גפ״ן',
  'התוכנית הצפויה / בחירה נדרשת', 'שכבה', 'קבוצות / משתתפים', 'סכום ההצעה',
  'מבנה ההצעה', 'הערכת סגירה (%)', 'תחזית כספית', 'סטטוס', 'פעולה להמשך',
  'תאריך מעקב', 'הערה',
];
const ITEM_HEADERS = ['מספר הצעה', 'בית ספר', 'שם הפעילות', 'מספר גפ״ן', 'מספר קבוצות'];

const text = (value) => String(value == null ? '' : value).trim();
const number = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const date = (value) => {
  if (!value) return '';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed;
};
const contactName = (row) => text(row.contact_person || row.manager_name);
const contactRole = (row) => text(row.contact_role);

function mainRow(row) {
  const amount = number(row.total_amount);
  const probability = number(row.probability);
  return [
    text(row.quote_number), date(row.proposal_date), text(row.authority), text(row.ownership),
    text(row.school_name), text(row.semel_mosad), contactName(row), contactRole(row),
    text(row.phone || row.manager_phone), text(row.email || row.manager_email), text(row.activity_type), text(row.program_name),
    text(row.gefen_numbers), text(row.expected_program), text(row.grade), text(row.participants_groups),
    amount, text(row.proposal_nature), probability / 100, amount * probability / 100,
    text(row.status), text(row.next_action), date(row.follow_up_date), text(row.notes),
  ];
}

function itemRows(rows) {
  return rows.flatMap((row) => Array.isArray(row.proposal_items) ? row.proposal_items.map((item) => [
    text(row.quote_number), text(row.school_name), text(item?.program_name),
    text(item?.gefen_number), item?.quantity == null || item.quantity === '' ? '' : number(item.quantity),
  ]) : []);
}

function decorateSheet(sheet, headers, rowCount, widths, longColumns = []) {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!rows'] = [{ hpt: 24 }, ...Array.from({ length: rowCount }, () => ({ hpt: 34 }))];
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, rowCount + 1)}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) continue;
      cell.s = {
        font: { bold: row === 0 },
        fill: row === 0 ? { fgColor: { rgb: 'E2E8F0' } } : undefined,
        alignment: { horizontal: 'right', vertical: 'center', wrapText: row === 0 || longColumns.includes(col) },
        border: { top: { style: 'thin', color: { rgb: 'D7DEE8' } }, bottom: { style: 'thin', color: { rgb: 'D7DEE8' } }, left: { style: 'thin', color: { rgb: 'D7DEE8' } }, right: { style: 'thin', color: { rgb: 'D7DEE8' } } },
      };
    }
  }
}

export function buildIsraaWorkbook(sourceRows) {
  const rows = [...new Map((Array.isArray(sourceRows) ? sourceRows : []).map((row) => [String(row.id || row.proposal_agreement_id || row.quote_number), row])).values()];
  const main = XLSX.utils.aoa_to_sheet([MAIN_HEADERS, ...rows.map(mainRow)], { cellDates: true });
  const items = XLSX.utils.aoa_to_sheet([ITEM_HEADERS, ...itemRows(rows)], { cellDates: true });
  decorateSheet(main, MAIN_HEADERS, rows.length, [14,13,16,14,22,13,18,14,16,24,16,32,22,18,30,12,22,16,16,18,16,34,14,34], [11,12,13,15,21,23]);
  decorateSheet(items, ITEM_HEADERS, itemRows(rows).length, [14,24,34,18,20], [2]);
  for (let r = 1; r <= rows.length; r += 1) {
    for (const c of [1, 22]) if (main[XLSX.utils.encode_cell({ r, c })]?.v) main[XLSX.utils.encode_cell({ r, c })].z = 'dd/mm/yyyy';
    for (const c of [16, 19]) main[XLSX.utils.encode_cell({ r, c })].z = '₪#,##0.00';
    main[XLSX.utils.encode_cell({ r, c: 18 })].z = '0%';
    for (const c of [5, 8, 12]) if (main[XLSX.utils.encode_cell({ r, c })]) main[XLSX.utils.encode_cell({ r, c })].t = 's';
  }
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, main, 'מעקב הצעות איסראא');
  XLSX.utils.book_append_sheet(workbook, items, 'פירוט פעילויות');
  workbook.Workbook.Names = [
    { Name: 'IsraaTrackingTable', Ref: `'מעקב הצעות איסראא'!$A$1:$X$${rows.length + 1}` },
    { Name: 'IsraaActivityItemsTable', Ref: `'פירוט פעילויות'!$A$1:$E$${itemRows(rows).length + 1}` },
  ];
  return workbook;
}

export function exportIsraaWorkbook(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('אין רשומות התואמות לסינון לייצוא.');
  const filename = `מעקב_הצעות_איסראא_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(buildIsraaWorkbook(rows), filename, { bookType: 'xlsx', cellStyles: true, compression: true });
  return filename;
}

export { MAIN_HEADERS, ITEM_HEADERS };
