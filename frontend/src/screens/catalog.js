import { api } from '../api.js';
import { escapeHtml } from './shared/html.js';
const AUDIENCE_OPTIONS = ['הכול', 'יסודי', 'חטיבה', 'תיכון'];
const TYPE_OPTIONS = [
  { label: 'הכול', value: 'הכול' },
  { label: 'קורס', value: 'תוכנית' },
  { label: 'סדנה', value: 'סדנה' },
  { label: 'סיור', value: 'סיור' },
  { label: 'חוג / אפטרסקול', value: 'חוג' },
  { label: 'חדר בריחה', value: 'חדר בריחה' }
];
const STANDALONE_GROUP_LABELS = { escape: 'חדרי בריחה', makers: 'מייקרים', space: 'חלל', tours: 'סיורים', classes: 'חוגים / אפטרסקול' };
const STANDALONE_CATEGORIES = [
  ['makers', STANDALONE_GROUP_LABELS.makers],
  ['space', STANDALONE_GROUP_LABELS.space],
  ['tours', STANDALONE_GROUP_LABELS.tours],
  ['classes', STANDALONE_GROUP_LABELS.classes],
  ['escape', STANDALONE_GROUP_LABELS.escape]
];
const STANDALONE_LABELS = Object.fromEntries(STANDALONE_CATEGORIES);
const CATALOG_SHORT_TITLE_OVERRIDES = new Map([
  ['טכנולוגיות חלל', 'טכנולוגיות החלל'],
  ['טכנולוגיות החלל', 'טכנולוגיות החלל'],
  ['פורצות דרך', 'פורצות דרך'],
  ['סודות ויסודות הבינה המלאכותית', 'בינה מלאכותית'],
  ['רוקחים עולם', 'רוקחים עולם'],
  ['אופק לתעשייה', 'אופק לתעשייה']
]);
const SCHOOL_VALUE_COLUMNS = ['למה לבחור בזה?', 'איך זה נראה בכיתה?', 'מה התלמידים לוקחים איתם?'];

function ensureCatalogStyles() {
  if (document.getElementById('catalog-screen-styles')) return;
  const style = document.createElement('style');
  style.id = 'catalog-screen-styles';
  style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap');
* { font-family: 'Heebo', sans-serif; }
.catalog-screen{direction:rtl;display:flex;flex-direction:column;gap:18px;color:#1f2937}
.catalog-header h2{margin:0 0 6px;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.2px}
.catalog-header .ds-muted{margin:0;color:#64748b;font-size:14px}
.catalog-toolbar{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;background:linear-gradient(180deg,#f8fbff,#f1f6fd);border:1px solid #dbe8f4;border-radius:16px;padding:14px}
.catalog-filter-field{display:flex;flex-direction:column;gap:7px;min-width:220px;flex:0 1 260px;color:#334155;font-size:13px;font-weight:800}
.catalog-filter-field span{display:block;line-height:1.2}
.catalog-filter-field select{display:block;width:100%;min-height:42px;border:1px solid #d5e4f3;border-radius:11px;background:#fff;padding:8px 12px;font:inherit;font-weight:600;color:#0f172a;outline:none}
.catalog-filter-field select:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.16)}
.catalog-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:start}
.catalog-group{background:linear-gradient(180deg,#ffffff,#f8fbff);border:1px solid #dbe6f1;border-radius:18px;padding:14px;min-width:0}
.catalog-group-title{margin:0 0 12px;font-size:18px;line-height:1.2;font-weight:900;color:#0f172a;text-align:center}
.catalog-group-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}
.catalog-subgroup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}
.catalog-subgroup-card{position:relative;border:1px solid #cbd5e1;background:#f8fafc;border-radius:12px;padding:12px 10px;cursor:pointer;text-align:center;font-size:15px;font-weight:800;color:#0f172a;transition:.18s ease box-shadow,.18s ease transform,.18s ease border-color}
.catalog-subgroup-card:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(15,23,42,.08);border-color:#94a3b8}
.catalog-subgroup-card.is-active{background:#dbeafe;border-color:#2563eb;color:#1e3a8a}
.catalog-card{position:relative;border:1px solid #dbe6f1;background:#fff;border-radius:14px;padding:13px 10px;min-height:68px;cursor:pointer;transition:.18s ease box-shadow,.18s ease transform,.18s ease border-color;overflow:hidden;display:flex;align-items:center;justify-content:center;text-align:center}
.catalog-card::before{content:'';position:absolute;inset:0 0 auto 0;height:5px;background:#c7d2fe}
.catalog-card:hover{transform:translateY(-2px);border-color:#94a3b8;box-shadow:0 8px 18px rgba(15,23,42,.10)}
.catalog-card h3{margin:0;font-size:15.5px;line-height:1.25;color:#0f172a;font-weight:800}
.catalog-empty{margin:0;color:#64748b;font-size:13px;line-height:1.5;text-align:center;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:14px 10px}
.catalog-card--elementary{background:linear-gradient(180deg,#fdfeff 0,#f2faff 100%);border-color:#c9e6f7}
.catalog-card--elementary::before{background:linear-gradient(90deg,#93c5fd,#67e8f9,#5eead4)}
.catalog-card--middle{background:linear-gradient(180deg,#f6f9ff 0,#e8f0ff 100%);border-color:#b8cbec}
.catalog-card--middle::before{background:linear-gradient(90deg,#1e3a8a,#1d4ed8,#2563eb)}
.catalog-card--middle h3{color:#0e2145}
.catalog-card--neutral::before{background:linear-gradient(90deg,#94a3b8,#cbd5e1)}
.catalog-detail-actions{display:flex;gap:10px;flex-wrap:wrap;width:100%;max-width:1120px;margin:0 auto;align-items:center}
.catalog-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}
.catalog-btn--primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.catalog-a4-wrap{display:flex;justify-content:center;width:100%;max-width:1120px;margin:0 auto;padding:0 24px;box-sizing:border-box}
.catalog-a4{--catalog-accent:#1d4ed8;--catalog-accent-soft:#eff6ff;--catalog-accent-border:#bfdbfe;--catalog-hero-start:#f8fbff;--catalog-hero-end:#edf4ff;width:100%;max-width:1120px;min-height:auto;background:#ffffff;color:#1f2937;border:1px solid #ddd8f0;border-radius:22px;padding:24px;box-shadow:0 4px 20px rgba(100,90,170,0.08);display:flex;flex-direction:column;gap:18px;box-sizing:border-box;overflow:hidden}
.catalog-theme--bio{--catalog-accent:#15803d;--catalog-accent-soft:#f0fdf4;--catalog-accent-border:#bbf7d0;--catalog-hero-start:#f7fee7;--catalog-hero-end:#ecfdf5}
.catalog-theme--space{--catalog-accent:#4f46e5;--catalog-accent-soft:#eef2ff;--catalog-accent-border:#c7d2fe;--catalog-hero-start:#eef2ff;--catalog-hero-end:#f5f3ff}
.catalog-theme--ai{--catalog-accent:#0891b2;--catalog-accent-soft:#ecfeff;--catalog-accent-border:#a5f3fc;--catalog-hero-start:#ecfeff;--catalog-hero-end:#eff6ff}
.catalog-theme--entrepreneurship{--catalog-accent:#c2410c;--catalog-accent-soft:#fff7ed;--catalog-accent-border:#fed7aa;--catalog-hero-start:#fff7ed;--catalog-hero-end:#fefce8}
.catalog-theme--empowerment{--catalog-accent:#be185d;--catalog-accent-soft:#fdf2f8;--catalog-accent-border:#fbcfe8;--catalog-hero-start:#fdf2f8;--catalog-hero-end:#faf5ff}
.catalog-hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.catalog-logo-mark{flex:0 0 auto;display:flex;align-items:center;justify-content:center;max-width:190px}
.catalog-logo-mark img{display:block;max-width:190px;max-height:74px;width:auto;height:auto;object-fit:contain}
.catalog-hero-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.catalog-subtitle{margin:2px 0 10px;color:#334155;font-size:20px;font-weight:800;line-height:1.4}
.catalog-opening-line{max-width:760px;font-size:16px;color:#334155;margin:0;line-height:1.75;background:rgba(255,255,255,0.62);border:1px solid rgba(255,255,255,0.82);border-radius:14px;padding:10px 13px}
.catalog-gefen-badge{display:inline-flex;align-items:center;justify-content:center;background:#fff;color:var(--catalog-accent);border:1px solid var(--catalog-accent-border);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:900;margin:0 0 10px;box-shadow:0 6px 16px rgba(15,23,42,.06)}
.catalog-tag{background:white;border:1px solid var(--catalog-accent-border);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;color:var(--catalog-accent)}
.catalog-content-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}
.catalog-content-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:24px;box-shadow:0 8px 22px rgba(15,23,42,.045);min-width:0}
.catalog-content-card h3{margin:0 0 10px;color:#0f172a;font-size:18px;line-height:1.35;font-weight:900}
.catalog-content-card p{margin:0;color:#334155;font-size:15px;line-height:1.85;white-space:pre-line;overflow-wrap:anywhere}
.catalog-syllabus-section{grid-column:1/-1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:24px;padding:24px;box-shadow:0 8px 22px rgba(15,23,42,.045);min-width:0;direction:rtl;text-align:right}
.catalog-syllabus-section h3{margin:0 0 14px;color:#0f172a;font-size:18px;line-height:1.35;font-weight:900}
.catalog-syllabus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.catalog-syllabus-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:18px;min-width:0;box-shadow:0 7px 18px rgba(15,23,42,.04);direction:rtl;text-align:right}
.catalog-syllabus-card strong{display:inline-flex;align-items:center;justify-content:center;color:var(--catalog-accent);background:#fff;border:1px solid var(--catalog-accent-border);border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.3;font-weight:900;margin-bottom:8px}
.catalog-syllabus-card h4{margin:0 0 6px;color:#0f172a;font-size:15px;line-height:1.45;font-weight:900;overflow-wrap:anywhere;unicode-bidi:plaintext}
.catalog-syllabus-card p{margin:0;color:#334155;font-size:14px;line-height:1.75;white-space:pre-line;overflow-wrap:anywhere;unicode-bidi:plaintext}
.catalog-highlight{grid-column:1/-1;background:var(--catalog-accent-soft);border:1px solid var(--catalog-accent-border);border-radius:24px;padding:24px 28px;box-shadow:0 8px 22px rgba(15,23,42,.04)}
.catalog-highlight p{margin:0;color:#1f2937;font-size:16px;line-height:1.85;font-weight:700;white-space:pre-line;overflow-wrap:anywhere}
.catalog-quick-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
.catalog-quick-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:13px 10px;text-align:center;box-shadow:0 6px 16px rgba(15,23,42,.035);min-width:0}
.catalog-quick-card strong{display:block;color:#475569;font-size:12px;line-height:1.25;font-weight:800;margin-bottom:5px}
.catalog-quick-card span{display:block;color:#0f172a;font-size:15px;line-height:1.35;font-weight:900;overflow-wrap:anywhere}
.catalog-strip{background:#f7f6fb;border:1px solid #ddd8f0;border-radius:10px;padding:10px 12px}
.catalog-strip h3{font-size:13.5px;font-weight:700;background:#e5f5ee;color:#1a6645;border-radius:6px;padding:4px 8px;display:inline-block;margin:0 0 10px}
.catalog-strip-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.catalog-strip-grid .catalog-box{background:white}
.catalog-strip-grid .catalog-box strong{display:block;font-size:12px;font-weight:700;color:#1a6645;margin-bottom:5px}
.catalog-mini-card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.catalog-mini-card{border:1px solid #ddd8f0;background:#f7f6fb;border-radius:10px;padding:9px 10px;font-size:13px;font-weight:600;color:#4b3fa0;text-align:center;line-height:1.4}
.catalog-close{background:#f7f6fb;border:1px solid #ddd8f0;border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:12px}
.catalog-close h3{background:#e5f5ee;color:#1a6645}
.catalog-footer{margin-top:auto;border-top:1px solid #ddd8f0;padding-top:8px;display:flex;justify-content:space-between;font-size:11.5px;color:#94a3b8}
.catalog-a4-header{background:linear-gradient(135deg,var(--catalog-hero-start) 0%,var(--catalog-hero-end) 100%);border:1px solid var(--catalog-accent-border);border-radius:26px;padding:28px;color:#1f2937;box-shadow:0 12px 30px rgba(15,23,42,.055)}
.catalog-a4-header h1{font-size:34px;font-weight:900;color:#0f172a;margin:0 0 8px;line-height:1.2;letter-spacing:-.3px}
.catalog-a4-badge{background:#e5f5ee;color:#1a6645;border:1px solid #a8dfc4;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;display:inline-flex;margin-bottom:8px}
.catalog-a4--elementary .catalog-a4-header,.catalog-a4--middle .catalog-a4-header,.catalog-a4--neutral .catalog-a4-header{background:linear-gradient(135deg,#f0eefb 0%,#e8e4f8 100%);border-color:#cdc6ef;color:#1f2937}
.catalog-a4--elementary .catalog-a4-badge,.catalog-a4--middle .catalog-a4-badge,.catalog-a4--neutral .catalog-a4-badge{background:#e5f5ee;color:#1a6645;border:1px solid #a8dfc4}
.catalog-frame-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ddd8f0;border-radius:10px;overflow:hidden}
.catalog-frame-grid .catalog-box{border:none;border-right:1px solid #ddd8f0;border-radius:0;padding:10px 12px;text-align:center;background:#f7f6fb}
.catalog-frame-grid .catalog-box:last-child{border-right:none}
.catalog-frame-grid .catalog-box strong{display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px}
.catalog-frame-grid .catalog-box p{font-size:17px;font-weight:800;color:#1f2937;margin:0}
.catalog-box{background:#ffffff;border:1px solid #ddd8f0;border-radius:10px;padding:11px 13px}
.catalog-box h3{margin:0 0 7px;font-size:13.5px;font-weight:700;background:#ede9fb;color:#4b3fa0;border-radius:6px;padding:4px 8px;display:inline-block}
.catalog-box p{font-size:13px;color:#1f2937;line-height:1.6;margin:0;white-space:pre-line}
.catalog-box ul{margin:0;padding-inline-start:18px;font-size:13px;color:#1f2937;line-height:1.7}
.catalog-box table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
.catalog-box table th{background:#ede9fb;color:#4b3fa0;font-weight:700;padding:6px 8px;border:1px solid #ddd8f0;text-align:right}
.catalog-box table td{padding:6px 8px;border:1px solid #ddd8f0;color:#1f2937;vertical-align:top}
.catalog-box table tr:nth-child(even) td{background:#f7f6fb}
.catalog-list-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:900px){.catalog-a4-wrap{padding:0}.catalog-a4{width:100%;min-height:auto;padding:16px;border-radius:18px}.catalog-a4-header{padding:20px;border-radius:22px}.catalog-a4-header h1{font-size:28px}.catalog-hero-top{flex-direction:column}.catalog-logo-mark{align-self:flex-start}.catalog-frame-grid{grid-template-columns:1fr 1fr}.catalog-list-grid{grid-template-columns:1fr}.catalog-quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:1100px){.catalog-groups{grid-template-columns:1fr}.catalog-group-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.catalog-header h2{font-size:24px}.catalog-toolbar{align-items:stretch}.catalog-filter-field{flex:1 1 100%;min-width:0;font-size:12px}}
@media (max-width:640px){.catalog-frame-grid,.catalog-list-grid,.catalog-content-grid,.catalog-strip-grid,.catalog-mini-card-grid,.catalog-quick-grid,.catalog-syllabus-grid{grid-template-columns:1fr}.catalog-card{min-height:62px}.catalog-group-grid{grid-template-columns:1fr}.catalog-content-card,.catalog-highlight,.catalog-syllabus-section{padding:20px}.catalog-opening-line{font-size:14px}.catalog-subtitle{font-size:17px}}
@page{size:A4;margin:0}
@media print {
  body{background:#fff !important}
  .toolbar,.catalog-print-hide{display:none !important}
  body *{visibility:hidden !important}
  .catalog-print-zone,.catalog-print-zone *{visibility:visible !important}
  .catalog-print-zone{position:absolute;inset:0;background:#fff}
  .catalog-a4{margin:0;border:0;box-shadow:none;border-radius:0;width:210mm;min-height:297mm;page-break-after:always;padding:10mm}
  .catalog-a4-wrap{display:block;max-width:none;padding:0}
  .catalog-box,.catalog-strip,.catalog-mini-card{break-inside:avoid-page}
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

function normalizeAudienceLevel(value) {
  const raw = String(value || '').trim();
  if (raw === 'חטיבות' || raw === 'חטיבה' || raw === 'חט״ב') return 'חטיבה';
  if (raw === 'יסודי') return 'יסודי';
  return raw || 'לא צוין';
}

function catalogFiltersHtml(audience, type) {
  return `<div class="catalog-toolbar">
    <label class="catalog-filter-field">
      <span>שכבת גיל</span>
      <select data-catalog-filter="audience">${AUDIENCE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${o === audience ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>
    </label>
    <label class="catalog-filter-field">
      <span>סוג פעילות</span>
      <select data-catalog-filter="type">${TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === type ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
    </label>
  </div>`;
}

function normalizeProductType(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (normalized === 'course') return 'תוכנית';
  if (normalized === 'after_school' || normalized === 'חוג אפטרסקול') return 'חוג';
  if (normalized === 'workshop') return 'סדנה';
  if (normalized === 'tour') return 'סיור';
  if (normalized === 'escape_room') return 'חדר בריחה';
  if (raw === 'חוגים') return 'חוג';
  if (raw === 'סיורים') return 'סיור';
  if (raw === 'סדנאות') return 'סדנה';
  return raw || 'תוכנית';
}

function normalizeCatalogGroup(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return '';
  if (['after_school', 'afterschool', 'classes', 'club', 'clubs'].includes(normalized) || raw.includes('אפטרסקול') || raw.includes('חוג')) return 'classes';
  if (['makers', 'maker', 'workshop_makers'].includes(normalized) || raw.includes('מייקרים')) return 'makers';
  if (['space', 'workshop_space'].includes(normalized) || raw.includes('חלל')) return 'space';
  if (['escape', 'escape_room', 'digital_escape_room'].includes(normalized) || raw.includes('חדר בריחה')) return 'escape';
  if (['tour', 'tours'].includes(normalized) || raw.includes('סיור')) return 'tours';
  return '';
}

function inferScope(p) {
  if (p.scope) return String(p.scope);
  if (p.meetings) return String(p.meetings);
  if (p.syllabusCount) return `${String(p.syllabusCount)} מפגשים`;
  if (Array.isArray(p.syllabus) && p.syllabus.length) return `${String(p.syllabus.length)} מפגשים`;
  return 'לא צוין';
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const asString = String(value).trim();
    if (asString) return value;
  }
  return '';
}


function textBeforeMarketingDash(value) {
  return String(value || '')
    .split(/\s+[–—-]\s+/)[0]
    .trim();
}

function catalogCardTitleFromTitle(fullName) {
  const sourceName = String(fullName || '').trim();
  for (const [needle, shortTitle] of CATALOG_SHORT_TITLE_OVERRIDES) {
    if (sourceName.includes(needle)) return shortTitle;
  }

  const compactTitle = textBeforeMarketingDash(sourceName);
  return compactTitle || sourceName || 'ללא שם';
}

function normalizeProgram(item, idx) {
  const p = item && typeof item === 'object' ? item : {};
  const fullName = String(pickFirstNonEmpty(p.catalog_title) || 'ללא שם');
  return {
    id: String(pickFirstNonEmpty(p.activity_no, p.id, p.programId, p.slug) || `program-${idx + 1}`),
    name: fullName,
    catalogCardTitle: catalogCardTitleFromTitle(fullName),
    audienceLevel: normalizeAudienceLevel(p.audience_level || p.audienceLevel || 'לא צוין'),
    productType: normalizeProductType(
      p.item_type ||
      p.productType ||
      p.activity_type ||
      p.type ||
      'תוכנית'
    ),
    grades: String(pickFirstNonEmpty(p.grades, p.target_grades, p.targetGrades) || 'לא צוין'),
    targetGrades: String(pickFirstNonEmpty(p.targetGrades, p.target_grades, p.grades) || ''),
    domain: String(pickFirstNonEmpty(p.domain, p.catalog_domain) || ''),
    scope: String(pickFirstNonEmpty(p.scope, p.meetings_count, p.hours_count, p.meetings) || inferScope(p)),
    sessionDuration: String(pickFirstNonEmpty(p.session_duration, p.unit_duration, p.sessionDuration, p.duration) || 'לא צוין'),
    gefenNumber: String(pickFirstNonEmpty(p.gefen_number, p.gefenNumber, p.gefen) || ''),
    subtitle: String(pickFirstNonEmpty(p.catalog_subtitle) || ''),
    openingLine: String(pickFirstNonEmpty(p.opening_line, p.openingLine, p.sections?.openingStatement) || ''),
    shortDescription: String(pickFirstNonEmpty(p.catalog_short_description, p.short_description, p.description_short, p.shortDescription) || ''),
    coreIdea: String(pickFirstNonEmpty(p.catalog_core_idea, p.core_idea, p.coreIdea, p.sections?.mainIdea) || ''),
    goals: String(pickFirstNonEmpty(p.catalog_goals, p.goals, p.catalog_program_flow, p.program_flow, p.sections?.programFlow) || ''),
    programFlow: String(pickFirstNonEmpty(p.catalog_program_flow, p.program_flow, p.catalog_goals, p.goals, p.sections?.programFlow) || ''),
    studentDevelops: pickFirstNonEmpty(p.catalog_participants_receive, p.student_develops, p.participants_receive, p.studentDevelops, p.participantsReceive) || '',
    schoolValue: String(pickFirstNonEmpty(p.catalog_school_value, p.school_value, p.schoolValue, p.sections?.schoolValue) || ''),
    syllabus: Array.isArray(p.catalog_syllabus) ? p.catalog_syllabus : [],
    stations: Array.isArray(p.stations) ? p.stations : [],
    participantsReceive: pickFirstNonEmpty(p.catalog_participants_receive, p.student_develops, p.participants_receive, p.studentDevelops, p.participantsReceive) || [],
    closingBox: String(pickFirstNonEmpty(p.catalog_closing_box, p.closing_box, p.closingBox, p.sections?.finalOutcome) || ''),
    finalOutcome: String(pickFirstNonEmpty(p.final_outcome, p.catalog_closing_box, p.closing_box, p.closingBox, p.sections?.finalOutcome) || ''),
    footer: String(pickFirstNonEmpty(p.catalog_footer, p.footer, p.final_outcome, p.closing_box) || ''),
    pageTemplate: String(pickFirstNonEmpty(p.catalog_page_template, p.page_template, p.pageTemplate) || 'default'),
    catalogGroup: normalizeCatalogGroup(p.catalog_group || p.catalogGroup),
    catalogSource: String(pickFirstNonEmpty(p.catalog_source, p.catalogSource) || ''),
    pricingOptions: Array.isArray(p.pricing_options) ? p.pricing_options : []
  };
}

function isStandaloneActivity(program) {
  return program.productType === 'סדנה' || program.productType === 'סיור' || program.productType === 'חוג' || program.productType === 'חדר בריחה';
}

function isAfterSchoolProgram(program) {
  if (program.catalogGroup === 'classes') return true;
  const haystack = [program.productType, program.name, program.subtitle, program.coreIdea, program.shortDescription]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return haystack.includes('after_school') || haystack.includes('אפטרסקול') || haystack.includes('חוג');
}

function isEscapeRoomProgram(program) {
  if (program.catalogGroup === 'escape') return true;
  if (program.productType === 'חדר בריחה') return true;
  const haystack = [program.name, program.subtitle, program.coreIdea, program.shortDescription]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return haystack.includes('חדר בריחה') || haystack.includes('escape room') || haystack.includes('escape_room');
}

function isSpaceWorkshop(program) {
  if (program.catalogGroup === 'space') return true;
  const haystack = [program.name, program.subtitle, program.coreIdea, program.shortDescription]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return haystack.includes('חלל');
}

function isTamirWorkshop(program) {
  if (program.catalogGroup === 'makers') return true;
  if (program.productType !== 'סדנה') return false;
  if (program.catalogSource === 'proposal_activity_pricing' && !program.catalogGroup) return true;
  const haystack = [program.name, program.subtitle, program.coreIdea, program.shortDescription]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return haystack.includes('תמיר');
}

function renderCatalogCard(program) {
  return `<article class="catalog-card ${toneClassForProgram(program, 'catalog-card')}" data-audience-level="${escapeHtml(program.audienceLevel)}" data-page-template="${escapeHtml(program.pageTemplate)}" data-catalog-open="${escapeHtml(program.id)}">
    <h3>${escapeHtml(program.catalogCardTitle || program.name)}</h3>
  </article>`;
}

function renderCatalogGroup(title, programs) {
  return `<section class="catalog-group">
    <h3 class="catalog-group-title">${escapeHtml(title)}</h3>
    <div class="catalog-group-grid">
      ${programs.length ? programs.map(renderCatalogCard).join('') : '<p class="catalog-empty">אין פריטים להצגה</p>'}
    </div>
  </section>`;
}

function matchesCatalogType(program, type) {
  if (type === 'הכול') return true;
  if (type === 'חדר בריחה') return isEscapeRoomProgram(program);
  if (type === 'חוג') return program.productType === 'חוג' || isAfterSchoolProgram(program);
  return program.productType === type;
}

function splitToList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  return text
    .split(/\n|\r|•|\u2022|;|,/g)
    .map((part) => part.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean);
}

function fallbackText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function meaningfulText(value) {
  const text = String(value || '').trim();
  return text && text !== 'לא צוין' && text !== '—' ? text : '';
}

function renderQualityTags(program) {
  const tags = [];
  const domain = meaningfulText(program.domain);
  const grades = meaningfulText(program.grades);
  const scope = meaningfulText(program.scope);
  const gefen = meaningfulText(program.gefenNumber);

  if (domain) tags.push(`תחום תוכן: ${domain}`);
  if (grades) tags.push(`כיתות: ${grades}`);
  if (scope) tags.push(`משך: ${scope}`);
  if (gefen) tags.push(`מספר גפ״ן: ${gefen}`);

  return tags.length
    ? `<div class="catalog-hero-tags">${tags.map((tag) => `<span class="catalog-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
}

function renderGefenBadge(program) {
  const gefen = meaningfulText(program.gefenNumber);
  return gefen ? `<span class="catalog-gefen-badge">מס׳ גפ״ן ${escapeHtml(gefen)}</span>` : '';
}

function renderQuickInfoCards(program) {
  const cards = [
    ['כיתות', meaningfulText(program.targetGrades || program.grades)],
    ['סוג פעילות', meaningfulText(program.productType)],
    ['תחומים', meaningfulText(program.domain)],
    ['היקף', meaningfulText(program.scope)],
    ['משך מפגש', meaningfulText(program.sessionDuration)],
    ['מספר גפ״ן', meaningfulText(program.gefenNumber)]
  ].filter(([, value]) => value);

  return cards.length
    ? `<section class="catalog-quick-grid">${cards.map(([label, value]) => `<div class="catalog-quick-card"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')}</section>`
    : '';
}

function renderProgramContentCard(title, value) {
  const text = meaningfulText(value);
  if (!text) return '';
  return `<section class="catalog-content-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></section>`;
}

function meetingTagText(item, fallbackIndex) {
  const rawLabel = meaningfulText(item?.meeting_label || item?.meetingLabel || item?.meeting);
  if (rawLabel) {
    if (/^מפגש\b/.test(rawLabel)) return rawLabel;
    if (/^[\d\s\-–—]+$/.test(rawLabel)) return `מפגש ${rawLabel}`;
    return rawLabel;
  }
  const order = meaningfulText(item?.meeting_order || item?.meetingOrder || fallbackIndex);
  return order ? `מפגש ${order}` : '';
}

function renderSyllabusCard(item, idx) {
  if (item && typeof item === 'object') {
    const title = meaningfulText(item.title || item.topic);
    const description = meaningfulText(item.description || item.details);
    if (!title && !description) return '';
    const tag = meetingTagText(item, idx + 1);
    return `<article class="catalog-syllabus-card">${tag ? `<strong>${escapeHtml(tag)}</strong>` : ''}${title ? `<h4>${escapeHtml(title)}</h4>` : ''}${description ? `<p>${escapeHtml(description)}</p>` : ''}</article>`;
  }

  const text = meaningfulText(item);
  if (!text) return '';
  return `<article class="catalog-syllabus-card"><p>${escapeHtml(text)}</p></article>`;
}

function renderProgramSyllabus(program) {
  const rows = Array.isArray(program.syllabus)
    ? program.syllabus.map(renderSyllabusCard).filter(Boolean)
    : [];
  return rows.length
    ? `<section class="catalog-syllabus-section"><h3>סילבוס התוכנית</h3><div class="catalog-syllabus-grid">${rows.join('')}</div></section>`
    : '';
}

function renderProgramBodyCards(program) {
  const finalOutcome = meaningfulText(program.finalOutcome) || meaningfulText(program.closingBox);
  const programFlow = meaningfulText(program.programFlow) || meaningfulText(program.goals);
  const cards = [
    renderProgramContentCard('מטרת־העל', program.shortDescription),
    renderProgramContentCard('על התוכנית', program.coreIdea),
    renderProgramContentCard('תיאור התוכנית', program.goals),
    renderProgramContentCard('מה לומדים ואיך לומדים', programFlow),
    renderProgramContentCard('כלים ומיומנויות', program.studentDevelops),
    renderProgramContentCard('התוצר המסכם', finalOutcome)
  ].filter(Boolean);
  const syllabus = renderProgramSyllabus(program);
  if (syllabus) cards.push(syllabus);
  const schoolValue = meaningfulText(program.schoolValue);
  if (schoolValue) {
    cards.push(`<section class="catalog-highlight"><p>${escapeHtml(schoolValue)}</p></section>`);
  }
  return cards.length ? `<section class="catalog-content-grid">${cards.join('')}</section>` : '';
}

function domainToneClass(program) {
  const haystack = [program.domain, program.name, program.subtitle, program.coreIdea]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (haystack.includes('ביומימיקרי') || haystack.includes('קיימות') || haystack.includes('סביבה')) return 'catalog-theme--bio';
  if (haystack.includes('חלל') || haystack.includes('space')) return 'catalog-theme--space';
  if (haystack.includes('ai') || haystack.includes('בינה') || haystack.includes('טכנולוג')) return 'catalog-theme--ai';
  if (haystack.includes('יזמות') || haystack.includes('עסק')) return 'catalog-theme--entrepreneurship';
  if (haystack.includes('העצמה') || haystack.includes('פורצות') || haystack.includes('מנהיג')) return 'catalog-theme--empowerment';
  return '';
}

export const catalogScreen = {
  load: async () => {
    const payload = await api.getCatalogPrograms();
    const programs = Array.isArray(payload?.programs)
      ? payload.programs.map((row, idx) => normalizeProgram(row, idx))
      : [];
    return {
      programs,
      selectedId: '',
      audience: 'הכול',
      type: 'הכול',
      groupMode: '',
      standaloneCategory: 'makers',
      loadError: payload?.error ? 'לא ניתן לטעון את נתוני הקטלוג. בדקו חיבור והרשאות.' : ''
    };
  },

  render: (data) => {
    ensureCatalogStyles();
    const audience = data.audience || 'הכול';
    const type = data.type || 'הכול';
    const selected = data.programs.find((p) => p.id === data.selectedId) || null;

    const filtered = data.programs.filter((p) => (audience === 'הכול' || p.audienceLevel === audience) && matchesCatalogType(p, type));
    const elementaryPrograms = filtered.filter((p) => p.audienceLevel === 'יסודי' && p.productType === 'תוכנית');
    const middlePrograms = filtered.filter((p) => p.audienceLevel === 'חטיבה' && p.productType === 'תוכנית');
    const highSchoolPrograms = filtered.filter((p) => p.audienceLevel === 'תיכון' && p.productType === 'תוכנית');
    const workshopAndTours = filtered.filter((p) => isStandaloneActivity(p));

    const standaloneByCategory = {
      makers: workshopAndTours.filter((p) => p.productType === 'סדנה' && isTamirWorkshop(p) && !isSpaceWorkshop(p) && !isEscapeRoomProgram(p)),
      space: workshopAndTours.filter((p) => p.productType === 'סדנה' && isSpaceWorkshop(p) && !isEscapeRoomProgram(p)),
      tours: workshopAndTours.filter((p) => p.productType === 'סיור'),
      classes: workshopAndTours.filter((p) => p.productType === 'חוג' || isAfterSchoolProgram(p)),
      escape: workshopAndTours.filter((p) => isEscapeRoomProgram(p))
    };
    const visibleStandaloneCategories = STANDALONE_CATEGORIES.filter(([key]) => (standaloneByCategory[key] || []).length);
    const selectedStandaloneCategory = visibleStandaloneCategories.some(([key]) => key === data.standaloneCategory)
      ? data.standaloneCategory
      : (visibleStandaloneCategories[0]?.[0] || data.standaloneCategory || 'makers');
    const hasCatalogResults = elementaryPrograms.length || middlePrograms.length || highSchoolPrograms.length || visibleStandaloneCategories.length;

    if (!selected && data.groupMode === 'standalone') {
      const selectedStandalonePrograms = standaloneByCategory[selectedStandaloneCategory] || [];
      const standaloneCategoryButtons = visibleStandaloneCategories;
      return `<section class="catalog-screen">
        <header class="catalog-header"><h2>סדנאות, סיורים וחוגים</h2><p class="ds-muted">בחירה ממוקדת לפי קבוצות פעילות</p></header>
        ${catalogFiltersHtml(audience, type)}
        ${data.loadError ? `<p class="catalog-empty">${escapeHtml(data.loadError)}</p>` : ''}
        <div class="catalog-detail-actions">
          <button class="catalog-btn" data-catalog-back>חזרה לקטלוג</button>
        </div>
        ${standaloneCategoryButtons.length ? `<section class="catalog-group">
          <div class="catalog-subgroup-grid">
            ${standaloneCategoryButtons.map(([key, label]) => `<button class="catalog-subgroup-card ${selectedStandaloneCategory === key ? 'is-active' : ''}" data-catalog-subgroup="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </section>` : ''}
        ${selectedStandalonePrograms.length ? `<section class="catalog-group">
          <h3 class="catalog-group-title">${escapeHtml(STANDALONE_LABELS[selectedStandaloneCategory])}</h3>
          <div class="catalog-group-grid">
            ${selectedStandalonePrograms.map(renderCatalogCard).join('')}
          </div>
        </section>` : '<p class="catalog-empty">לא נמצאו תוכניות מתאימות לסינון שנבחר</p>'}
      </section>`;
    }

    if (!selected) {
      return `<section class="catalog-screen">
        <header class="catalog-header"><h2>קטלוג תוכניות תשפ״ז</h2><p class="ds-muted">בחירת תוכנית לפי שכבת גיל וסוג פעילות</p></header>
        ${catalogFiltersHtml(audience, type)}
        ${data.loadError ? `<p class="catalog-empty">${escapeHtml(data.loadError)}</p>` : ''}
        ${hasCatalogResults ? `<div class="catalog-groups">
          ${elementaryPrograms.length ? renderCatalogGroup('יסודי', elementaryPrograms) : ''}
          ${middlePrograms.length ? renderCatalogGroup('חטיבה', middlePrograms) : ''}
          ${highSchoolPrograms.length ? renderCatalogGroup('תיכון', highSchoolPrograms) : ''}
          ${visibleStandaloneCategories.length ? `<section class="catalog-group">
            <h3 class="catalog-group-title">סדנאות, סיורים וחוגים</h3>
            <div class="catalog-group-grid">
              ${visibleStandaloneCategories.map(([key, label]) => `<article class="catalog-card catalog-card--neutral" data-catalog-subgroup="${escapeHtml(key)}"><h3>${escapeHtml(label)}</h3></article>`).join('')}
            </div>
          </section>` : ''}
        </div>` : '<p class="catalog-empty">לא נמצאו תוכניות מתאימות לסינון שנבחר</p>'}
      </section>`;
    }

    const a4ToneClass = toneClassForProgram(selected, 'catalog-a4');
    const a4ThemeClass = domainToneClass(selected);
    const openingText = meaningfulText(selected.openingLine);
    const bodyCardsHtml = renderProgramBodyCards(selected);
    return `<section class="catalog-screen catalog-print-zone">
      <div class="catalog-detail-actions catalog-print-hide">
        <button class="catalog-btn" data-catalog-back>חזרה לקטלוג</button>
        <button class="catalog-btn catalog-btn--primary" data-catalog-print>הדפסה / PDF</button>
      </div>
      <div class="catalog-a4-wrap"><article class="catalog-a4 ${a4ToneClass} ${a4ThemeClass}" data-catalog-page="1">
        <header class="catalog-a4-header">
          <div class="catalog-hero-top"><div>${renderGefenBadge(selected)}<h1>${escapeHtml(selected.name)}</h1>${selected.subtitle ? `<p class="catalog-subtitle">${escapeHtml(selected.subtitle)}</p>` : ''}${openingText ? `<p class="catalog-opening-line">${escapeHtml(openingText)}</p>` : ''}</div><div class="catalog-logo-mark"><img src="./assets/logo_system.png" alt="לוגו תעשיידע" onerror="this.onerror=null;this.src='./frontend/assets/logo_system.png'"></div></div>
        </header>
        ${renderQuickInfoCards(selected)}
        ${bodyCardsHtml}
        <footer class="catalog-footer"><span>עמותת תעשיידע — חינוך טכנולוגי, חדשנות ויזמות</span><span>קטלוג תוכניות תשפ״ז</span></footer>
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
      const selected = data.programs.find((p) => p.id === data.selectedId) || null;
      const openCard = ev.target.closest('[data-catalog-open]');
      if (openCard) {
        data.selectedId = openCard.dataset.catalogOpen;
        rerender();
        return;
      }
      if (ev.target.closest('[data-catalog-group-open="standalone"]')) {
        data.groupMode = 'standalone';
        data.standaloneCategory = 'makers';
        data.selectedId = '';
        rerender();
        return;
      }
      const subgroupButton = ev.target.closest('[data-catalog-subgroup]');
      if (subgroupButton) {
        data.groupMode = 'standalone';
        data.standaloneCategory = subgroupButton.dataset.catalogSubgroup || 'makers';
        data.selectedId = '';
        rerender();
        return;
      }
      if (ev.target.closest('[data-catalog-back]')) {
        if (selected && isStandaloneActivity(selected)) {
          data.selectedId = '';
          data.groupMode = 'standalone';
        } else {
          data.selectedId = '';
          data.groupMode = '';
        }
        rerender();
        return;
      }
      if (ev.target.closest('[data-catalog-print]')) window.print();
    });
  }
};
