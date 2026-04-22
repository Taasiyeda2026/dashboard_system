import { escapeHtml } from './html.js';
import { visibleActivityCategoryLabel, hebrewSheetLabel } from './ui-hebrew.js';
import { formatDateHe } from './format-date.js';

function statusLabel(status) {
  const v = String(status || '').trim().toLowerCase();
  if (v === 'open') return 'פתוח';
  if (v === 'closed') return 'סגור';
  return v ? status : '—';
}

function statusKind(status) {
  const v = String(status || '').trim().toLowerCase();
  if (v === 'closed') return 'success';
  if (v === 'open') return 'warning';
  return 'neutral';
}

function activityHoursLabel(row) {
  const s = String(row.start_time || '').trim();
  const e = String(row.end_time || '').trim();
  if (s && e) return `${s} - ${e}`;
  return s || e || '—';
}

function meetingScheduleHtml(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) {
    return '<p><strong>כל התאריכים:</strong> —</p>';
  }
  const items = schedule
    .map((item) => {
      const d = escapeHtml(formatDateHe(String(item?.date || '')));
      const done = String(item?.performed || '').toLowerCase() === 'yes';
      return `<li class="ds-meeting-list__item">
        <span class="ds-meeting-list__date">${d}</span>
        <span class="ds-meeting-list__state">${done ? 'בוצע' : 'טרם בוצע'}</span>
      </li>`;
    })
    .join('');
  return `
    <div class="ds-detail-date-stack ds-detail-date-stack--narrow">
      <p><strong>כל התאריכים:</strong></p>
      <ul class="ds-meeting-list">${items}</ul>
    </div>`;
}

const EDITABLE_FIELDS_ALL = [
  'activity_manager',
  'authority',
  'school',
  'grade',
  'class_group',
  'activity_type',
  'activity_no',
  'activity_name',
  'sessions',
  'price',
  'funding',
  'start_time',
  'end_time',
  'emp_id',
  'instructor_name',
  'emp_id_2',
  'instructor_name_2',
  'Date1',
  'Date2',
  'Date3',
  'Date4',
  'Date5',
  'Date6',
  'Date7',
  'Date8',
  'Date9',
  'Date10',
  'Date11',
  'Date12',
  'Date13',
  'Date14',
  'Date15',
  'Date16',
  'Date17',
  'Date18',
  'Date19',
  'Date20',
  'Date21',
  'Date22',
  'Date23',
  'Date24',
  'Date25',
  'Date26',
  'Date27',
  'Date28',
  'Date29',
  'Date30',
  'Date31',
  'Date32',
  'Date33',
  'Date34',
  'Date35',
  'status',
  'notes',
  'finance_status',
  'finance_notes'
];

const EDITABLE_FIELDS_BASIC = ['status', 'notes', 'finance_status', 'finance_notes'];

const FIELD_LABELS = {
  activity_manager: 'מנהל פעילות',
  authority: 'רשות',
  school: 'בית ספר',
  grade: 'שכבה',
  class_group: 'כיתה',
  activity_type: 'סוג פעילות',
  activity_no: 'מספר פעילות',
  activity_name: 'שם פעילות',
  sessions: 'כמות מפגשים',
  price: 'מחיר',
  funding: 'מימון',
  start_time: 'שעת התחלה',
  end_time: 'שעת סיום',
  emp_id: 'מזהה מדריך 1',
  instructor_name: 'שם מדריך 1',
  emp_id_2: 'מזהה מדריך 2',
  instructor_name_2: 'שם מדריך 2',
  start_date: 'תאריך התחלה',
  end_date: 'תאריך סיום',
  Date1: 'תאריך 1',
  Date2: 'תאריך 2',
  Date3: 'תאריך 3',
  Date4: 'תאריך 4',
  Date5: 'תאריך 5',
  Date6: 'תאריך 6',
  Date7: 'תאריך 7',
  Date8: 'תאריך 8',
  Date9: 'תאריך 9',
  Date10: 'תאריך 10',
  Date11: 'תאריך 11',
  Date12: 'תאריך 12',
  Date13: 'תאריך 13',
  Date14: 'תאריך 14',
  Date15: 'תאריך 15',
  Date16: 'תאריך 16',
  Date17: 'תאריך 17',
  Date18: 'תאריך 18',
  Date19: 'תאריך 19',
  Date20: 'תאריך 20',
  Date21: 'תאריך 21',
  Date22: 'תאריך 22',
  Date23: 'תאריך 23',
  Date24: 'תאריך 24',
  Date25: 'תאריך 25',
  Date26: 'תאריך 26',
  Date27: 'תאריך 27',
  Date28: 'תאריך 28',
  Date29: 'תאריך 29',
  Date30: 'תאריך 30',
  Date31: 'תאריך 31',
  Date32: 'תאריך 32',
  Date33: 'תאריך 33',
  Date34: 'תאריך 34',
  Date35: 'תאריך 35',
  status: 'סטטוס',
  notes: 'הערות',
  finance_status: 'סטטוס כספים',
  finance_notes: 'הערות כספים'
};

const LIST_FIELDS = [
  'activity_type',
  'grade',
  'funding',
  'authority',
  'school',
  'activity_manager',
  'status',
  'finance_status'
];

function settingsDropdownListName(fieldName) {
  var map = {
    activity_type: 'activity_type',
    grade: 'grade',
    funding: 'funding',
    authority: 'authority',
    school: 'school',
    activity_manager: 'activity_manager',
    status: 'status',
    finance_status: 'finance_status'
  };
  return map[fieldName] || fieldName;
}

function isListBasedField(fieldName) {
  return LIST_FIELDS.indexOf(fieldName) >= 0;
}

/**
 * Returns dropdown options for a field, constrained by source sheet for activity_type.
 */
function resolveDropdownOptions(fieldName, settings, sourceSheet) {
  if (fieldName === 'grade') {
    return ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ז\'', 'ח\'', 'ט\'', 'י\'', 'י\"א', 'י\"ב'];
  }
  var dropdownOptions = settings?.dropdown_options || {};
  var listName = settingsDropdownListName(fieldName);
  var allOptions = Array.isArray(dropdownOptions[listName]) ? dropdownOptions[listName] : [];

  if (fieldName === 'activity_type' && sourceSheet) {
    var src = String(sourceSheet).toLowerCase();
    var programTypes = Array.isArray(settings?.program_activity_types)
      ? settings.program_activity_types
      : ['course', 'after_school'];
    var oneDayTypes = Array.isArray(settings?.one_day_activity_types)
      ? settings.one_day_activity_types
      : ['workshop', 'tour', 'escape_room'];

    var validTypes;
    if (src.includes('long')) {
      validTypes = programTypes;
    } else if (src.includes('short')) {
      validTypes = oneDayTypes;
    }
    if (validTypes && validTypes.length > 0) {
      if (allOptions.length > 0) {
        return allOptions.filter(function(o) { return validTypes.indexOf(String(o)) >= 0; });
      }
      return validTypes;
    }
  }

  return allOptions;
}

/**
 * Renders a single editable field as an HTML input/select/textarea.
 * List-based fields always render as <select> dropdowns.
 */
function editorInputHtml(fieldName, rawValue, settings, sourceSheet) {
  var value = String(rawValue ?? '');
  var safeValue = escapeHtml(value);
  var label = FIELD_LABELS[fieldName] || fieldName;
  var isDateColumn = /^Date([1-9]|[12]\d|3[0-5])$/.test(fieldName);
  var isList = isListBasedField(fieldName) && !isDateColumn;
  var options = isList ? resolveDropdownOptions(fieldName, settings, sourceSheet) : [];

  if (isList) {
    var currentIncluded = value && options.indexOf(value) < 0;
    var opts = ['<option value="">—</option>']
      .concat(
        (currentIncluded ? [value] : []).concat(options).map(function(optionVal) {
          var v = String(optionVal || '');
          var selected = v === value ? ' selected' : '';
          return '<option value="' + escapeHtml(v) + '"' + selected + '>' + escapeHtml(v) + '</option>';
        })
      )
      .join('');
    return '<label class="ds-field"><span class="ds-field__label">' + escapeHtml(label) + '</span><select name="' + escapeHtml(fieldName) + '" class="ds-input">' + opts + '</select></label>';
  }

  if (fieldName === 'notes' || fieldName === 'finance_notes') {
    return '<label class="ds-field"><span class="ds-field__label">' + escapeHtml(label) + '</span><textarea name="' + escapeHtml(fieldName) + '" class="ds-input" rows="2">' + safeValue + '</textarea></label>';
  }

  var inputType = 'text';
  if (fieldName === 'start_date' || fieldName === 'end_date' || isDateColumn) inputType = 'date';
  if (fieldName === 'sessions' || fieldName === 'price') inputType = 'number';
  return '<label class="ds-field"><span class="ds-field__label">' + escapeHtml(label) + '</span><input name="' + escapeHtml(fieldName) + '" class="ds-input" type="' + inputType + '" value="' + safeValue + '" /></label>';
}

/** Detail block for a raw activity row (week/month/my-data style fields). */
export function activityRowDetailHtml(
  row,
  { privateNote = null, hideEmpIds = false, hideRowId = false, hideActivityNo = false, showFinance = true } = {}
) {
  const id1 = String(row.emp_id || '').trim();
  const id2 = String(row.emp_id_2 || '').trim();
  const ids = [id1, id2].filter(Boolean).join(' · ') || '—';
  const names = [row.instructor_name, row.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const instLine = hideEmpIds ? names || '—' : names ? `${ids} (${names})` : ids;
  const operationNoteLine =
    privateNote === null ? '' : `<p><strong>הערות תפעול:</strong> ${escapeHtml(privateNote)}</p>`;
  const financeLine = showFinance ? `<p><strong>סטטוס כספי:</strong> ${escapeHtml(String(row.finance_status || '—'))}</p>` : '';
  const scheduleLine = meetingScheduleHtml(row);
  const done = Number(row.meetings_done || 0);
  const total = Number(row.meetings_total || 0);
  const statusText = statusLabel(row.status);
  const statusClass = statusKind(row.status);
  const startDate = escapeHtml(formatDateHe(row.start_date) || '—');
  const endDate = escapeHtml(formatDateHe(row.end_date) || '—');
  const actTypeLbl   = escapeHtml(visibleActivityCategoryLabel(row.activity_type));
  const srcLbl       = escapeHtml(hebrewSheetLabel(row.source_sheet));
  const srcBadge     = srcLbl
    ? `<span class="ds-tag ds-tag--source">${srcLbl}</span>`
    : '';
  const grade = String(row.grade || '').trim();
  const classGroup = String(row.class_group || '').trim();
  const classDisplay = [grade, classGroup].filter(Boolean).join(' ');

  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>סוג פעילות:</strong> ${actTypeLbl}${srcBadge ? ' ' + srcBadge : ''}</p>
      <p><strong>מדריך/ה:</strong> ${escapeHtml(names || instLine)}</p>
      ${hideRowId ? '' : `<p><strong>מזהה שורה:</strong> ${escapeHtml(String(row.RowID || ''))}</p>`}
      ${hideActivityNo ? '' : `<p><strong>מספר פעילות:</strong> ${escapeHtml(String(row.activity_no || '—'))}</p>`}
      <p><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</p>
      ${classDisplay ? `<p><strong>שכבה/כיתה:</strong> ${escapeHtml(classDisplay)}</p>` : ''}
      <p><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</p>
      <p><strong>שעות:</strong> ${escapeHtml(activityHoursLabel(row))}</p>
      <div class="ds-detail-date-stack ds-detail-date-stack--narrow">
        <p><strong>סטטוס ותאריכים:</strong></p>
        <div class="ds-date-badges">
          <span class="ds-chip ds-chip--status ds-chip--status-${statusClass}">${escapeHtml(statusText)}</span>
          <span class="ds-date-pill">📅 התחלה: ${startDate}</span>
          <span class="ds-date-pill">🏁 סיום: ${endDate}</span>
        </div>
      </div>
      <p><strong>בוצעו מפגשים:</strong> ${escapeHtml(`${done}/${total}`)}</p>
      ${scheduleLine}
      <p><strong>מנהל פעילויות:</strong> ${escapeHtml(row.activity_manager || '—')}</p>
      ${financeLine}
      ${operationNoteLine}
    </div>`;
}

/**
 * פירוט פעילות + טופס עריכה ישיר (ללא כפתור טוגל).
 * כשיש הרשאת עריכה: מוצג פירוט קריאה בלבד ואחריו טופס עריכה ישיר.
 * כשאין הרשאה: פירוט קריאה בלבד בלבד.
 */
export function activityWorkDrawerHtml(
  row,
  {
    privateNote = null,
    canEdit = false,
    hideEmpIds = false,
    hideRowId = false,
    hideActivityNo = false,
    showFinance = true,
    showFinanceFields = true,
    settings = {}
  } = {}
) {
  const base = activityRowDetailHtml(row, { privateNote, hideEmpIds, hideRowId, hideActivityNo, showFinance });
  if (!canEdit) return base;

  const src = escapeHtml(String(row.source_sheet || '').trim());
  const rid = escapeHtml(String(row.RowID || '').trim());
  const allFieldsEditable = !!settings?.all_data_fields_editable;
  const sessions = Math.max(1, Math.min(Number(row.sessions) || 1, 35));
  const sourceSheet = String(row.source_sheet || '').trim();

  var fields = allFieldsEditable ? EDITABLE_FIELDS_ALL.slice() : EDITABLE_FIELDS_BASIC.slice();
  if (!showFinanceFields) {
    fields = fields.filter(function(fieldName) {
      return fieldName !== 'finance_status' && fieldName !== 'finance_notes';
    });
  }
  if (hideEmpIds) {
    fields = fields.filter(function(fieldName) {
      return fieldName !== 'emp_id' && fieldName !== 'emp_id_2';
    });
  }
  if (hideActivityNo) {
    fields = fields.filter(function(fieldName) {
      return fieldName !== 'activity_no';
    });
  }

  var editorFieldsHtml = '';
  fields.forEach(function(fieldName) {
    var m = /^Date(\d+)$/.exec(fieldName);
    if (m) {
      var dateNum = parseInt(m[1], 10);
      var inputHtml = editorInputHtml(fieldName, row[fieldName], settings, sourceSheet);
      if (dateNum > sessions) {
        editorFieldsHtml += '<div class="ds-date-extra-wrap" data-date-extra hidden>' + inputHtml + '</div>';
      } else {
        editorFieldsHtml += inputHtml;
      }
    } else {
      editorFieldsHtml += editorInputHtml(fieldName, row[fieldName], settings, sourceSheet);
    }
  });

  return `${base}
    <form class="ds-stack ds-activity-editor" data-edit-activity data-source-sheet="${src}" data-row-id="${rid}">
      <h3 class="ds-activity-editor__title">✏️ עריכה</h3>
      ${editorFieldsHtml}
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-add-date-btn" data-add-date>+ תאריך</button>
      <button type="submit" class="ds-btn ds-btn--primary ds-activity-editor__submit">💾 שמירה</button>
      <p class="ds-muted ds-activity-edit-status" role="status"></p>
    </form>`;
}
