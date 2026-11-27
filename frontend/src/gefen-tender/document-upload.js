/**
 * Compact SharePoint document upload helpers for Gefen tender 2027.
 * Upload goes through Edge Function — no Graph secrets in the browser.
 */

import { supabase } from '../supabase-client.js';
import { RECOMMENDATION_FOLDER_BY_PROGRAM } from './constants.js';

export const GEFEN_DOC_MAX_BYTES = 5 * 1024 * 1024;

/** Admin section file rules from tender practice: 5MB + allowed types. */
export const ADMIN_FILE_RULES = {
  // Registration / tax certificates — PDF or image
  1: { accept: ['.pdf', '.jpg', '.jpeg', '.png'], mime: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: false, label: 'PDF / JPG / PNG עד 5MB' },
  2: { accept: ['.pdf', '.jpg', '.jpeg', '.png'], mime: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: false, label: 'PDF / JPG / PNG עד 5MB' },
  3: { accept: ['.pdf'], mime: ['application/pdf'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: false, label: 'PDF עד 5MB' },
  4: { accept: ['.pdf', '.jpg', '.jpeg', '.png'], mime: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: false, label: 'PDF / JPG / PNG עד 5MB' },
  5: { accept: ['.pdf'], mime: ['application/pdf'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: true, label: 'PDF עד 5MB (ניתן כמה קבצים)' },
  6: { accept: ['.pdf'], mime: ['application/pdf'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: true, label: 'PDF עד 5MB (ניתן כמה קבצים)' },
  10: { accept: ['.pdf'], mime: ['application/pdf'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: true, label: 'PDF עד 5MB (ניתן כמה קבצים)' },
  12: { accept: ['.pdf'], mime: ['application/pdf'], maxBytes: GEFEN_DOC_MAX_BYTES, multiple: false, label: 'PDF עד 5MB' }
};

const DEFAULT_RULE = {
  accept: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.xls'],
  mime: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  maxBytes: GEFEN_DOC_MAX_BYTES,
  multiple: true,
  label: 'מסמכים עד 5MB'
};

export function fileRuleForArea(area, sectionNumber = null) {
  if (area === 'administrative' && sectionNumber != null) {
    return ADMIN_FILE_RULES[Number(sectionNumber)] || {
      ...DEFAULT_RULE,
      multiple: true,
      label: 'PDF / מסמך עד 5MB'
    };
  }
  return DEFAULT_RULE;
}

export function normalizeDocuments(value) {
  if (Array.isArray(value)) return value.filter((d) => d && (d.url || d.name));
  if (value && typeof value === 'object' && (value.url || value.name)) return [value];
  if (typeof value === 'string' && value.trim()) {
    return [{
      id: `link-${Date.now()}`,
      name: value.trim().split('/').pop() || 'קישור',
      url: value.trim(),
      source: 'link',
      linked_at: new Date().toISOString()
    }];
  }
  return [];
}

export function primaryDocumentUrl(docs) {
  const list = normalizeDocuments(docs);
  return list.find((d) => d.url)?.url || '';
}

export function validateUploadFile(file, rule = DEFAULT_RULE) {
  if (!file || !file.size) throw new Error('לא נבחר קובץ.');
  const max = rule.maxBytes || GEFEN_DOC_MAX_BYTES;
  if (file.size > max) throw new Error(`הקובץ חורג ממגבלת ${(max / (1024 * 1024)).toFixed(0)}MB.`);
  const name = String(file.name || '').toLowerCase();
  const okExt = (rule.accept || []).some((ext) => name.endsWith(ext.toLowerCase()));
  const okMime = !file.type || (rule.mime || []).includes(file.type) || file.type === 'application/octet-stream';
  if (!okExt && !okMime) {
    throw new Error(`סוג קובץ לא מורשה. מותר: ${(rule.accept || []).join(', ')}`);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

export async function gefenSharePointInvoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('gefen-tender-sharepoint', {
    body: { action, ...payload }
  });
  if (error || data?.error) {
    throw new Error(data?.message || error?.message || 'פעולת SharePoint נכשלה.');
  }
  return data;
}

export async function uploadGefenDocument(file, meta = {}, rule = DEFAULT_RULE) {
  validateUploadFile(file, rule);
  const base64 = await fileToBase64(file);
  const result = await gefenSharePointInvoke('upload', {
    area: meta.area,
    section_number: meta.section_number,
    section_label: meta.section_label,
    program_id: meta.program_id,
    program_title: meta.program_title,
    person_name: meta.person_name,
    recommendations_folder: meta.recommendations_folder
      || RECOMMENDATION_FOLDER_BY_PROGRAM[meta.program_id]
      || meta.program_title,
    file_name: file.name,
    mime_type: file.type,
    base64
  });
  return result.document;
}

export function makeLinkedDocument(url, name = '') {
  const href = String(url || '').trim();
  if (!href) throw new Error('יש להזין קישור תקין.');
  return {
    id: `link-${crypto.randomUUID?.() || Date.now()}`,
    name: String(name || '').trim() || href.split('/').pop() || 'קישור SharePoint',
    url: href,
    source: 'link',
    linked_at: new Date().toISOString()
  };
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Compact upload zone HTML. Caller wires events via data-* hooks.
 * Does NOT auto-complete section status.
 */
export function renderDocumentUploader({
  docs = [],
  area,
  scopeKey,
  sectionNumber = null,
  allowLink = true,
  disabled = false
} = {}) {
  const rule = fileRuleForArea(area, sectionNumber);
  const list = normalizeDocuments(docs);
  const accept = (rule.accept || []).join(',');
  const multiple = rule.multiple !== false;
  const rows = list.length
    ? `<ul class="gt-docs">${list.map((d, i) => `<li class="gt-docs__item">
        <span class="gt-docs__name" title="${esc(d.name || '')}">${esc(d.name || 'מסמך')}</span>
        <span class="gt-docs__meta">${esc(fmtDate(d.uploaded_at || d.linked_at))}${d.source === 'link' ? ' · קישור' : ''}</span>
        <span class="gt-docs__actions">
          ${d.url ? `<a class="gt-btn--sm" target="_blank" rel="noopener noreferrer" href="${esc(d.url)}">פתיחה</a>
          <a class="gt-btn--sm" target="_blank" rel="noopener noreferrer" href="${esc(d.url)}" download>הורדה</a>` : ''}
          <button type="button" class="gt-btn--sm" data-doc-replace="${esc(scopeKey)}" data-doc-index="${i}" ${disabled ? 'disabled' : ''}>החלפה</button>
          <button type="button" class="gt-btn--sm" data-doc-unlink="${esc(scopeKey)}" data-doc-index="${i}" ${disabled ? 'disabled' : ''}>הסרת שיוך</button>
        </span>
      </li>`).join('')}</ul>`
    : '<div class="gt-docs__empty">טרם שויך מסמך</div>';

  return `<div class="gt-upload" data-doc-scope="${esc(scopeKey)}" data-doc-area="${esc(area)}" data-doc-section="${sectionNumber ?? ''}">
    <div class="gt-upload__drop" data-doc-drop="${esc(scopeKey)}" tabindex="0" aria-label="העלאת מסמך">
      <span>גררו קובץ לכאן או</span>
      <button type="button" class="gt-btn--sm gt-btn--primary" data-doc-pick="${esc(scopeKey)}" ${disabled ? 'disabled' : ''}>בחירת קובץ</button>
      <small>${esc(rule.label || '')}</small>
    </div>
    <input type="file" hidden data-doc-file="${esc(scopeKey)}" accept="${esc(accept)}"${multiple ? ' multiple' : ''}>
    ${allowLink ? `<div class="gt-upload__link">
      <input type="url" data-doc-link-url="${esc(scopeKey)}" placeholder="או קישור SharePoint קיים" ${disabled ? 'disabled' : ''}>
      <input type="text" data-doc-link-name="${esc(scopeKey)}" placeholder="שם לתצוגה (רשות)" ${disabled ? 'disabled' : ''}>
      <button type="button" class="gt-btn--sm" data-doc-link-add="${esc(scopeKey)}" ${disabled ? 'disabled' : ''}>צירוף קישור</button>
    </div>` : ''}
    ${rows}
  </div>`;
}
