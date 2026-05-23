import { escapeHtml } from './shared/html.js';

const DATA_URL = './catalog/catalog_programs_tashpaz.json';
const AUDIENCE_OPTIONS = ['הכול', 'יסודי', 'חטיבה'];
const TYPE_OPTIONS = ['הכול', 'תוכנית', 'סדנה', 'סיור'];

function ensureCatalogStyles() {
  if (document.getElementById('catalog-screen-styles')) return;
  const style = document.createElement('style');
  style.id = 'catalog-screen-styles';
  style.textContent = `
.catalog-screen{direction:rtl;display:flex;flex-direction:column;gap:14px}
.catalog-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.catalog-filter{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #d9e2ec;border-radius:999px;padding:4px 10px;font-size:13px}
.catalog-filter select{border:none;background:transparent;font:inherit;color:#1f2937;min-width:92px;outline:none}
.catalog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
.catalog-card{border:1px solid #dce3ea;background:#fff;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:190px;cursor:pointer}
.catalog-card:hover{border-color:#9eb7d2;box-shadow:0 4px 16px rgba(15,23,42,.08)}
.catalog-chipline{display:flex;gap:6px;flex-wrap:wrap}
.catalog-chip{font-size:12px;background:#eef3f8;border-radius:999px;padding:2px 8px;color:#334155}
.catalog-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;color:#374151}
.catalog-detail-actions{display:flex;gap:8px;flex-wrap:wrap}
.catalog-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}
.catalog-btn--primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.catalog-a4-wrap{display:flex;justify-content:center}
.catalog-a4{width:210mm;min-height:297mm;background:#fff;color:#1f2937;border:1px solid #d7dee7;border-radius:8px;padding:14mm;box-shadow:0 8px 24px rgba(15,23,42,.08)}
.catalog-top-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.catalog-box{background:#f8fafc;border:1px solid #d8e1eb;border-radius:10px;padding:10px}
.catalog-frame-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.catalog-list4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (max-width:900px){.catalog-a4{width:100%;min-height:auto;padding:14px}.catalog-top-grid,.catalog-frame-grid,.catalog-list4{grid-template-columns:1fr 1fr}}
@media (max-width:640px){.catalog-meta,.catalog-top-grid,.catalog-frame-grid,.catalog-list4{grid-template-columns:1fr}}
@media print {
  body *{visibility:hidden !important}
  .catalog-print-zone,.catalog-print-zone *{visibility:visible !important}
  .catalog-print-hide{display:none !important}
  .catalog-print-zone{position:absolute;inset:0;background:#fff}
  .catalog-a4{margin:0;border:none;box-shadow:none;border-radius:0;width:210mm;min-height:297mm;page-break-after:avoid}
  @page{size:A4;margin:8mm}
}
`;
  document.head.appendChild(style);
}

function normalizeProgram(item, idx) {
  const p = item && typeof item === 'object' ? item : {};
  return {
    id: String(p.id || p.programId || p.slug || `program-${idx + 1}`),
    name: String(p.name || p.programName || p.title || 'ללא שם'),
    audienceLevel: String(p.audienceLevel || 'לא צוין'),
    productType: String(p.productType || 'תוכנית'),
    grades: String(p.grades || 'לא צוין'),
    scope: String(p.scope || p.meetings || 'לא צוין'),
    sessionDuration: String(p.sessionDuration || p.duration || 'לא צוין'),
    gefenNumber: String(p.gefenNumber || p.gefen || ''),
    shortDescription: String(
      p.shortDescription ||
      p.openingLine ||
      p.subtitle ||
      p.sections?.openingStatement ||
      ''
    ),
    coreIdea: String(
      p.coreIdea ||
      p.description ||
      p.sections?.mainIdea ||
      ''
    ),
    goals: String(
      p.goals ||
      p.sections?.programFlow ||
      ''
    ),
    schoolValue: String(
      p.schoolValue ||
      p.sections?.schoolValue ||
      ''
    ),
    syllabus: Array.isArray(p.syllabus) ? p.syllabus : [],
    stations: Array.isArray(p.stations) ? p.stations : [],
    participantsReceive: Array.isArray(p.participantsReceive) ? p.participantsReceive : [],
    closingBox: String(
      p.closingBox ||
      p.sections?.finalOutcome ||
      ''
    ),
    footer: String(p.footer || ''),
    pageTemplate: String(p.pageTemplate || 'default')
  };
}

function sectionLabelsByType(type) {
  if (type === 'סדנה') return { happening: 'מה עושים בסדנה', syllabus: 'עיקרון מדעי / ערך לימודי', outcome: 'תוצר הסדנה' };
  if (type === 'סיור') return { happening: 'מה קורה בסיור', syllabus: 'תחנות / מוקדי ביקור', outcome: 'ערך חינוכי לבית הספר' };
  return { happening: 'מה קורה בתוכנית', syllabus: 'סילבוס התוכנית', outcome: 'תוצר מסכם / שיא תהליך' };
}

function listFromTextOrArray(arr, fallback = 'לא סופק מידע') {
  if (Array.isArray(arr) && arr.length) return arr.map((x) => `<li>${escapeHtml(String(x))}</li>`).join('');
  return `<li>${escapeHtml(fallback)}</li>`;
}

export const catalogScreen = {
  load: async () => {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('טעינת הקטלוג נכשלה');
    const data = await res.json();
    const programs = (Array.isArray(data) ? data : data.programs || []).map(normalizeProgram);
    return { programs, selectedId: '', audience: 'הכול', type: 'הכול' };
  },

  render: (data) => {
    ensureCatalogStyles();
    const audience = data.audience || 'הכול';
    const type = data.type || 'הכול';
    const selected = data.programs.find((p) => p.id === data.selectedId) || null;

    if (!selected) {
      const filtered = data.programs.filter((p) => (audience === 'הכול' || p.audienceLevel === audience) && (type === 'הכול' || p.productType === type));
      return `<section class="catalog-screen">
        <h2>קטלוג תוכניות תלמידים תשפ״ז</h2>
        <p class="ds-muted">בחירת תוכנית לפי שכבת גיל וסוג פעילות</p>
        <div class="catalog-toolbar">
          <label class="catalog-filter">שכבת גיל <select data-catalog-filter="audience">${AUDIENCE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${o === audience ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
          <label class="catalog-filter">סוג פעילות <select data-catalog-filter="type">${TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${o === type ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
        </div>
        <div class="catalog-grid">
          ${filtered.map((p) => `<article class="catalog-card" data-catalog-open="${escapeHtml(p.id)}">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="catalog-chipline"><span class="catalog-chip">${escapeHtml(p.audienceLevel)}</span><span class="catalog-chip">${escapeHtml(p.productType)}</span></div>
            <div class="catalog-meta"><div><strong>כיתות:</strong> ${escapeHtml(p.grades)}</div><div><strong>היקף:</strong> ${escapeHtml(p.scope)}</div><div><strong>משך מפגש:</strong> ${escapeHtml(p.sessionDuration)}</div><div><strong>מס׳ גפ״ן:</strong> ${escapeHtml(p.gefenNumber || '—')}</div></div>
            <p class="ds-muted">${escapeHtml(p.shortDescription || p.coreIdea || '')}</p>
          </article>`).join('') || '<p class="ds-muted">לא נמצאו תוכניות עבור הסינון שנבחר.</p>'}
        </div>
      </section>`;
    }

    const labels = sectionLabelsByType(selected.productType);
    const syllabusSource = selected.productType === 'סיור' ? selected.stations : selected.syllabus;
    return `<section class="catalog-screen catalog-print-zone">
      <div class="catalog-detail-actions catalog-print-hide">
        <button class="catalog-btn" data-catalog-back>חזרה לקטלוג</button>
        <button class="catalog-btn catalog-btn--primary" data-catalog-print>הדפסה / PDF</button>
      </div>
      <div class="catalog-a4-wrap"><article class="catalog-a4">
        <header><h1>${escapeHtml(selected.name)}</h1><p>${escapeHtml(selected.shortDescription || '')}</p></header>
        <section class="catalog-top-grid"><div class="catalog-box"><h3>תיאור / הרעיון המרכזי</h3><p>${escapeHtml(selected.coreIdea || 'לא סופק מידע')}</p></div><div class="catalog-box"><h3>מטרות / מה לומדים ואיך לומדים</h3><p>${escapeHtml(selected.goals || 'לא סופק מידע')}</p></div></section>
        <section class="catalog-frame-grid"><div class="catalog-box"><strong>כיתות</strong><p>${escapeHtml(selected.grades)}</p></div><div class="catalog-box"><strong>היקף</strong><p>${escapeHtml(selected.scope)}</p></div><div class="catalog-box"><strong>משך מפגש</strong><p>${escapeHtml(selected.sessionDuration)}</p></div><div class="catalog-box"><strong>מספר גפ״ן</strong><p>${escapeHtml(selected.gefenNumber || '—')}</p></div></section>
        <section class="catalog-box"><h3>הערך לבית הספר</h3><p>${escapeHtml(selected.schoolValue || 'לא סופק מידע')}</p></section>
        <section class="catalog-box"><h3>${escapeHtml(labels.syllabus)}</h3><ul>${listFromTextOrArray(syllabusSource)}</ul></section>
        <section class="catalog-box"><h3>${escapeHtml(labels.happening)}</h3><p>${escapeHtml(selected.shortDescription || selected.coreIdea || 'לא סופק מידע')}</p></section>
        <section class="catalog-box"><h3>מה מקבלים המשתתפים</h3><div class="catalog-list4"><ul>${listFromTextOrArray(selected.participantsReceive)}</ul><div><strong>${escapeHtml(labels.outcome)}</strong><p>${escapeHtml(selected.closingBox || 'לא סופק מידע')}</p></div></div></section>
        <footer class="catalog-box"><p>${escapeHtml(selected.footer || 'תעשיידע | קטלוג תוכניות תלמידים תשפ״ז')}</p></footer>
      </article></div>
    </section>`;
  },

  bind: ({ root, data, rerender }) => {
    root.addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-catalog-filter]');
      if (!sel) return;
      const key = sel.dataset.catalogFilter;
      if (key === 'audience') data.audience = sel.value;
      if (key === 'type') data.type = sel.value;
      rerender();
    });

    root.addEventListener('click', (ev) => {
      const openCard = ev.target.closest('[data-catalog-open]');
      if (openCard) {
        data.selectedId = openCard.dataset.catalogOpen;
        rerender();
        return;
      }
      if (ev.target.closest('[data-catalog-back]')) {
        data.selectedId = '';
        rerender();
        return;
      }
      if (ev.target.closest('[data-catalog-print]')) window.print();
    });
  }
};
