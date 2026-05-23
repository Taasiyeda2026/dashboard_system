import { escapeHtml } from './shared/html.js';

const DATA_URL = './catalog/catalog_programs_tashpaz.json';
const AUDIENCE_OPTIONS = ['הכול', 'יסודי', 'חטיבה'];
const TYPE_OPTIONS = ['הכול', 'תוכנית', 'סדנה', 'סיור'];

function ensureCatalogStyles() {
  if (document.getElementById('catalog-screen-styles')) return;
  const style = document.createElement('style');
  style.id = 'catalog-screen-styles';
  style.textContent = `
.catalog-screen{direction:rtl;display:flex;flex-direction:column;gap:18px;color:#0f172a}
.catalog-header h2{margin:0 0 6px;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.2px}
.catalog-header .ds-muted{margin:0;color:#64748b;font-size:14px}
.catalog-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:linear-gradient(180deg,#f8fbff,#f1f6fd);border:1px solid #dbe8f4;border-radius:14px;padding:10px 12px}
.catalog-filter{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #d5e4f3;border-radius:10px;padding:6px 10px;font-size:13px;color:#334155;font-weight:600}
.catalog-filter select{border:none;background:transparent;font:inherit;color:#0f172a;min-width:94px;outline:none}
.catalog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(295px,1fr));gap:14px;align-items:stretch}
.catalog-card{position:relative;border:1px solid #dbe6f1;background:#fff;border-radius:16px;padding:14px;display:grid;grid-template-rows:auto auto auto auto 1fr;gap:10px;min-height:292px;cursor:pointer;transition:.18s ease box-shadow,.18s ease transform,.18s ease border-color;overflow:hidden}
.catalog-card::before{content:'';position:absolute;inset:0 0 auto 0;height:7px;background:#c7d2fe}
.catalog-card:hover{transform:translateY(-2px);border-color:#94a3b8;box-shadow:0 12px 24px rgba(15,23,42,.10)}
.catalog-card h3{margin:0;font-size:22px;line-height:1.25;color:#0f172a}
.catalog-lead{min-height:44px;max-height:84px;margin:0;font-size:14px;line-height:1.5;color:#475569;overflow:hidden}
.catalog-chipline{display:flex;gap:7px;flex-wrap:wrap}
.catalog-chip{font-size:11px;border-radius:999px;padding:3px 9px;color:#1e293b;background:#e7eef7;border:1px solid #d2deec;font-weight:700}
.catalog-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#334155;margin-top:auto}
.catalog-meta div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:7px 8px;line-height:1.35;min-height:58px}
.catalog-meta strong{display:block;margin-bottom:2px;color:#0f172a;font-size:11px}
.catalog-card--elementary{background:linear-gradient(180deg,#fdfeff 0,#f2faff 100%);border-color:#c9e6f7}
.catalog-card--elementary::before{background:linear-gradient(90deg,#93c5fd,#67e8f9,#5eead4)}
.catalog-card--elementary .catalog-chip{background:#effcff;border-color:#bae6fd;color:#135178}
.catalog-card--elementary .catalog-meta div{background:#f6fcff;border-color:#d8edf8}
.catalog-card--middle{background:linear-gradient(180deg,#f6f9ff 0,#e8f0ff 100%);border-color:#b8cbec}
.catalog-card--middle::before{background:linear-gradient(90deg,#1e3a8a,#1d4ed8,#2563eb)}
.catalog-card--middle h3{color:#0e2145}
.catalog-card--middle .catalog-lead{color:#334155}
.catalog-card--middle .catalog-chip{background:#e6eefc;border-color:#bfdbfe;color:#1e3a8a}
.catalog-card--middle .catalog-meta div{background:#f2f7ff;border-color:#d5e1f9}
.catalog-card--neutral::before{background:linear-gradient(90deg,#94a3b8,#cbd5e1)}
.catalog-detail-actions{display:flex;gap:8px;flex-wrap:wrap}
.catalog-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}
.catalog-btn--primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.catalog-a4-wrap{display:flex;justify-content:center}
.catalog-a4{width:210mm;min-height:297mm;background:#fff;color:#1f2937;border:1px solid #d7dee7;border-radius:10px;padding:11mm;box-shadow:0 8px 24px rgba(15,23,42,.08);display:flex;flex-direction:column;gap:9px}
.catalog-a4-header{border-radius:14px;padding:14px;border:1px solid transparent}
.catalog-a4-header h1{margin:0;font-size:28px;line-height:1.2}
.catalog-a4-header p{margin:6px 0 0;font-size:14px;line-height:1.5;max-width:95%}
.catalog-a4-badge{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:8px}
.catalog-a4--elementary .catalog-a4-header{background:linear-gradient(135deg,#effbff,#ddf5ff);border-color:#c5e7f8;color:#103d59}
.catalog-a4--elementary .catalog-a4-badge{background:#ccfbf1;color:#0f766e;border:1px solid #99f6e4}
.catalog-a4--middle .catalog-a4-header{background:linear-gradient(135deg,#1e3a8a,#1f3f96 55%,#2457d8);border-color:#1d4ed8;color:#f8fbff}
.catalog-a4--middle .catalog-a4-badge{background:#dbeafe;color:#1e3a8a;border:1px solid #bfdbfe}
.catalog-a4--middle .catalog-a4-header p{color:#dbeafe}
.catalog-a4--neutral .catalog-a4-header{background:linear-gradient(135deg,#f8fafc,#eef2f7);border-color:#dbe3ec;color:#0f172a}
.catalog-a4--neutral .catalog-a4-badge{background:#e2e8f0;color:#334155;border:1px solid #cbd5e1}
.catalog-frame-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.catalog-box{background:#f8fafc;border:1px solid #d8e1eb;border-radius:10px;padding:10px}
.catalog-box h3{margin:0 0 6px;font-size:15px}
.catalog-box p{margin:0;line-height:1.55;white-space:pre-line}
.catalog-box ul{margin:0;padding-inline-start:18px;line-height:1.5}
.catalog-list-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.catalog-a4--elementary .catalog-box{background:#fbfeff;border-color:#d8edf8}
.catalog-a4--middle .catalog-box{background:#f6f9ff;border-color:#d8e3f9}
.catalog-a4--neutral .catalog-box{background:#f8fafc}
@media (max-width:900px){.catalog-a4{width:100%;min-height:auto;padding:14px}.catalog-frame-grid{grid-template-columns:1fr 1fr}.catalog-list-grid{grid-template-columns:1fr}}
@media (max-width:760px){.catalog-grid{grid-template-columns:1fr}.catalog-header h2{font-size:24px}.catalog-filter{font-size:12px}}
@media (max-width:640px){.catalog-meta,.catalog-frame-grid,.catalog-list-grid{grid-template-columns:1fr}.catalog-card{min-height:unset}}
@media print {
  body *{visibility:hidden !important}
  .catalog-print-zone,.catalog-print-zone *{visibility:visible !important}
  .catalog-print-hide{display:none !important}
  .catalog-print-zone{position:absolute;inset:0;background:#fff}
  .catalog-a4{margin:0;border:none;box-shadow:none;border-radius:0;width:210mm;min-height:297mm;page-break-after:avoid;padding:10mm}
  .catalog-box{break-inside:avoid-page}
  @page{size:A4;margin:8mm}
}
`;
  document.head.appendChild(style);
}

function toneClassForProgram(program, prefix) {
  const audience = String(program?.audienceLevel || '').trim();
  const template = String(program?.pageTemplate || '').toLowerCase();
  if (audience === 'יסודי' || template.includes('elementary') || template.includes('yesodi')) return `${prefix}--elementary`;
  if (audience === 'חטיבה' || template.includes('middle') || template.includes('hativa')) return `${prefix}--middle`;
  return `${prefix}--neutral`;
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
    shortDescription: String(p.shortDescription || p.openingLine || p.subtitle || p.sections?.openingStatement || ''),
    coreIdea: String(p.coreIdea || p.description || p.sections?.mainIdea || ''),
    goals: String(p.goals || p.sections?.programFlow || ''),
    schoolValue: String(p.schoolValue || p.sections?.schoolValue || ''),
    syllabus: Array.isArray(p.syllabus) ? p.syllabus : [],
    stations: Array.isArray(p.stations) ? p.stations : [],
    participantsReceive: Array.isArray(p.participantsReceive) ? p.participantsReceive : [],
    closingBox: String(p.closingBox || p.sections?.finalOutcome || ''),
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
        <header class="catalog-header"><h2>קטלוג תוכניות תלמידים תשפ״ז</h2><p class="ds-muted">בחירת תוכנית לפי שכבת גיל וסוג פעילות</p></header>
        <div class="catalog-toolbar">
          <label class="catalog-filter">שכבת גיל <select data-catalog-filter="audience">${AUDIENCE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${o === audience ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
          <label class="catalog-filter">סוג פעילות <select data-catalog-filter="type">${TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${o === type ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
        </div>
        <div class="catalog-grid">
          ${filtered.map((p) => `<article class="catalog-card ${toneClassForProgram(p, 'catalog-card')}" data-audience-level="${escapeHtml(p.audienceLevel)}" data-page-template="${escapeHtml(p.pageTemplate)}" data-catalog-open="${escapeHtml(p.id)}">
            <h3>${escapeHtml(p.name)}</h3>
            <p class="catalog-lead">${escapeHtml(p.shortDescription || p.coreIdea || 'לא סופק תיאור')}</p>
            <div class="catalog-chipline"><span class="catalog-chip">${escapeHtml(p.audienceLevel)}</span><span class="catalog-chip">${escapeHtml(p.productType)}</span><span class="catalog-chip">${escapeHtml(p.grades)}</span></div>
            <div class="catalog-meta"><div><strong>כיתות</strong>${escapeHtml(p.grades)}</div><div><strong>היקף</strong>${escapeHtml(p.scope)}</div><div><strong>משך מפגש</strong>${escapeHtml(p.sessionDuration)}</div><div><strong>מס׳ גפ״ן</strong>${escapeHtml(p.gefenNumber || '—')}</div></div>
          </article>`).join('') || '<p class="ds-muted">לא נמצאו תוכניות עבור הסינון שנבחר.</p>'}
        </div>
      </section>`;
    }

    const labels = sectionLabelsByType(selected.productType);
    const syllabusSource = selected.productType === 'סיור' ? selected.stations : selected.syllabus;
    const a4ToneClass = toneClassForProgram(selected, 'catalog-a4');
    return `<section class="catalog-screen catalog-print-zone">
      <div class="catalog-detail-actions catalog-print-hide">
        <button class="catalog-btn" data-catalog-back>חזרה לקטלוג</button>
        <button class="catalog-btn catalog-btn--primary" data-catalog-print>הדפסה / PDF</button>
      </div>
      <div class="catalog-a4-wrap"><article class="catalog-a4 ${a4ToneClass}" data-audience-level="${escapeHtml(selected.audienceLevel)}" data-page-template="${escapeHtml(selected.pageTemplate)}">
        <header class="catalog-a4-header"><span class="catalog-a4-badge">${escapeHtml(selected.audienceLevel)}</span><h1>${escapeHtml(selected.name)}</h1><p>${escapeHtml(selected.shortDescription || 'תוכנית לימודית מותאמת לבית הספר')}</p></header>
        <section class="catalog-frame-grid"><div class="catalog-box"><strong>כיתות</strong><p>${escapeHtml(selected.grades)}</p></div><div class="catalog-box"><strong>היקף</strong><p>${escapeHtml(selected.scope)}</p></div><div class="catalog-box"><strong>משך מפגש</strong><p>${escapeHtml(selected.sessionDuration)}</p></div><div class="catalog-box"><strong>מספר גפ״ן</strong><p>${escapeHtml(selected.gefenNumber || '—')}</p></div></section>
        <section class="catalog-list-grid"><div class="catalog-box"><h3>תיאור / רעיון מרכזי</h3><p>${escapeHtml(selected.coreIdea || 'לא סופק מידע')}</p></div><div class="catalog-box"><h3>מה לומדים ואיך לומדים</h3><p>${escapeHtml(selected.goals || 'לא סופק מידע')}</p></div></section>
        <section class="catalog-box"><h3>הערך לבית הספר</h3><p>${escapeHtml(selected.schoolValue || 'לא סופק מידע')}</p></section>
        <section class="catalog-box"><h3>${escapeHtml(labels.syllabus)}</h3><ul>${listFromTextOrArray(syllabusSource)}</ul></section>
        <section class="catalog-list-grid"><div class="catalog-box"><h3>${escapeHtml(labels.happening)}</h3><p>${escapeHtml(selected.shortDescription || selected.coreIdea || 'לא סופק מידע')}</p></div><div class="catalog-box"><h3>מה מקבלים המשתתפים</h3><ul>${listFromTextOrArray(selected.participantsReceive)}</ul></div></section>
        <section class="catalog-box"><h3>${escapeHtml(labels.outcome)}</h3><p>${escapeHtml(selected.closingBox || 'לא סופק מידע')}</p></section>
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
