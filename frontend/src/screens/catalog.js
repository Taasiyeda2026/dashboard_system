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
const catalogBoundRoots = new WeakSet();
const catalogRootState = new WeakMap();
let isPrintingCatalog = false;
let catalogPrintResetTimer = 0;

function resetCatalogPrintState() {
  isPrintingCatalog = false;
  if (typeof document !== 'undefined') document.body?.classList.remove('catalog-printing');
  if (catalogPrintResetTimer) {
    clearTimeout(catalogPrintResetTimer);
    catalogPrintResetTimer = 0;
  }
}

function printCatalogOnce() {
  if (isPrintingCatalog) return;
  if (typeof window === 'undefined' || typeof window.print !== 'function') return;
  isPrintingCatalog = true;
  document.body?.classList.add('catalog-printing');
  window.addEventListener('afterprint', resetCatalogPrintState, { once: true });
  catalogPrintResetTimer = setTimeout(resetCatalogPrintState, 1500);
  window.print();
}

function ensureCatalogStyles() {
  if (document.getElementById('catalog-screen-styles')) return;
  const style = document.createElement('style');
  style.id = 'catalog-screen-styles';
  style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap');
* { font-family: 'Heebo', sans-serif;box-sizing:border-box}
html,body{overflow-x:hidden}
.catalog-screen{direction:rtl;display:flex;flex-direction:column;gap:18px;color:#1f2937;max-width:100%;text-align:right}
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
.catalog-card{position:relative;border:1px solid #dbe6f1;background:#fff;border-radius:14px;padding:14px 12px;min-height:88px;cursor:pointer;transition:.18s ease box-shadow,.18s ease transform,.18s ease border-color;overflow:hidden;display:flex;align-items:center;justify-content:center;text-align:center}
.catalog-card::before{content:'';position:absolute;inset:0 0 auto 0;height:5px;background:#c7d2fe}
.catalog-card:hover{transform:translateY(-2px);border-color:#94a3b8;box-shadow:0 8px 18px rgba(15,23,42,.10)}
.catalog-card h3{margin:0;font-size:15.5px;line-height:1.25;color:#0f172a;font-weight:800}
.catalog-card-text{display:grid;gap:5px;min-width:0}
.catalog-card-text p{margin:0;color:#64748b;font-size:13px;line-height:1.35;font-weight:700}
.catalog-empty{margin:0;color:#64748b;font-size:13px;line-height:1.5;text-align:center;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:14px 10px}
.catalog-card--elementary{background:linear-gradient(180deg,#fdfeff 0,#f2faff 100%);border-color:#c9e6f7}
.catalog-card--elementary::before{background:linear-gradient(90deg,#93c5fd,#67e8f9,#5eead4)}
.catalog-card--middle{background:linear-gradient(180deg,#f6f9ff 0,#e8f0ff 100%);border-color:#b8cbec}
.catalog-card--middle::before{background:linear-gradient(90deg,#1e3a8a,#1d4ed8,#2563eb)}
.catalog-card--middle h3{color:#0e2145}
.catalog-card--neutral::before{background:linear-gradient(90deg,#94a3b8,#cbd5e1)}
.catalog-detail-actions{display:flex;gap:10px;flex-wrap:wrap;width:100%;max-width:1180px;margin:0 auto;align-items:center;padding:0 16px}
.catalog-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}
.catalog-btn--primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.catalog-print-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;width:100%;max-width:1180px;margin:0 auto;padding:8px 16px;background:var(--color-background-primary,#fff);border-bottom:.5px solid var(--color-border-tertiary,#d9dee8);font-size:13px;color:var(--color-text-secondary,#64748b);box-sizing:border-box}
.catalog-print-bar-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.catalog-print-btn{background:#1a3a2a;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
.catalog-print-btn:hover{background:#0f2318}
.catalog-a4-wrap{display:flex;justify-content:center;width:100%;max-width:1200px;margin:0 auto;padding:0 16px;box-sizing:border-box}
.catalog-a4{--program-primary:#1a3a2a;--program-accent:#2d5a3d;--program-accent-soft:#eef8ef;--program-accent-border:#cfe7d4;--program-bg:#f7f5ef;--program-card-bg:#fffefb;--program-border:#e5ded0;--program-text:#17231c;--program-muted:#5f6f66;width:100%;max-width:1160px;min-height:auto;background:linear-gradient(180deg,#fbfaf5 0,#f3f7ef 100%);color:var(--program-text);border:1px solid rgba(207,221,207,.7);border-radius:28px;padding:22px;display:flex;flex-direction:column;gap:22px;box-sizing:border-box;overflow:hidden;direction:rtl;text-align:right;box-shadow:0 18px 55px rgba(15,45,31,.08)}
.catalog-theme--nature{--program-primary:#1a3a2a;--program-accent:#2d5a3d;--program-accent-soft:#e8f5e0;--program-accent-border:#c2e0a0}
.catalog-theme--space{--program-primary:#172554;--program-accent:#4F46E5;--program-accent-soft:#EEF2FF;--program-accent-border:#C7D2FE}
.catalog-theme--ai{--program-primary:#12355B;--program-accent:#0EA5A4;--program-accent-soft:#E6FFFB;--program-accent-border:#B6E8E4}
.catalog-theme--entrepreneurship{--program-primary:#6B3D00;--program-accent:#B86B00;--program-accent-soft:#FFF7E6;--program-accent-border:#F6D7A6}
.catalog-theme--industry{--program-primary:#263238;--program-accent:#64748B;--program-accent-soft:#F1F5F9;--program-accent-border:#CBD5E1}
.catalog-theme--games{--program-primary:#3B0764;--program-accent:#A855F7;--program-accent-soft:#F6EDFF;--program-accent-border:#DEC5FF}
.catalog-theme--pharma{--program-primary:#064E3B;--program-accent:#10B981;--program-accent-soft:#ECFDF5;--program-accent-border:#A7F3D0}
.catalog-theme--leadership{--program-primary:#351C75;--program-accent:#A855F7;--program-accent-soft:#F6EDFF;--program-accent-border:#DEC5FF}
.catalog-hero-top{position:relative;background:radial-gradient(circle at 12% 18%,rgba(125,211,184,.34),transparent 31%),linear-gradient(135deg,#fffdf6 0,#edf8f1 52%,#e9f7f7 100%);border:1px solid rgba(184,213,190,.8);border-radius:26px;padding:34px 38px;display:grid;grid-template-columns:minmax(0,1fr);gap:22px;overflow:hidden}
.catalog-hero-top::before{content:'';position:absolute;inset:auto -80px -110px auto;width:260px;height:260px;border-radius:50%;background:rgba(45,90,61,.09)}
.catalog-domain-icon{display:none}
.catalog-hero-main{position:relative;z-index:1;min-width:0;display:grid;gap:12px;max-width:880px}
.catalog-subtitle{margin:0;color:#42564b;font-size:18px;line-height:1.75;font-weight:600;max-width:820px}
.catalog-gefen-badge{display:inline-flex;width:max-content;margin:0;background:rgba(255,255,255,.68);border:1px solid rgba(194,224,160,.75);border-radius:999px;padding:5px 12px;color:#315742;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
.catalog-a4-header h1{font-size:clamp(30px,4.2vw,52px);font-weight:900;color:#102519;margin:0;line-height:1.13;letter-spacing:-.8px;overflow-wrap:anywhere}
.catalog-domain-chips,.catalog-chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:4px}
.catalog-domain-chip,.catalog-chip{background:#eef8ef;border:1px solid #cfe7d4;border-radius:999px;padding:7px 13px;font-size:13px;font-weight:700;color:#245238;line-height:1.35}
.catalog-opening-line{margin:0;background:rgba(255,254,251,.82);border:1px solid rgba(224,216,202,.85);border-radius:20px;padding:18px 22px;color:#42564b;font-size:15px;font-weight:600;line-height:1.9;white-space:pre-line;overflow-wrap:anywhere;unicode-bidi:plaintext;box-shadow:0 10px 26px rgba(15,45,31,.05)}
.catalog-quick-grid{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:10px;margin:0}
.catalog-quick-card{background:rgba(255,255,255,.78);border:1px solid rgba(194,224,160,.75);border-radius:999px;padding:8px 14px;min-width:0;display:flex;align-items:center;gap:8px;box-shadow:0 8px 20px rgba(15,45,31,.05)}
.catalog-quick-card strong{display:block;color:#5f6f66;font-size:12px;line-height:1.25;font-weight:800;white-space:nowrap}
.catalog-quick-card span{display:block;color:#102519;font-size:13px;line-height:1.35;font-weight:800;overflow-wrap:anywhere;max-width:100%;unicode-bidi:plaintext}
.catalog-area-divider{grid-column:1/-1;font-size:15px;font-weight:900;color:#244934;letter-spacing:0;padding:2px 2px 0;border:0}
.catalog-content-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:stretch}
.catalog-content-card{background:rgba(255,254,251,.94);border:1px solid rgba(224,216,202,.88);border-radius:24px;padding:24px 26px;min-width:0;box-shadow:0 12px 34px rgba(15,45,31,.06)}
.catalog-content-card--wide{grid-column:1/-1}
.catalog-content-card--green,.catalog-content-card--value,.catalog-content-card--skills{background:#f4fbf1;border-color:#d7ead0}
.catalog-content-card p{margin:0;color:#36483d;font-size:15px;line-height:1.95;white-space:pre-line;overflow-wrap:anywhere;unicode-bidi:plaintext}
.catalog-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.catalog-sec-head i{font-size:18px;color:#2d5a3d}
.catalog-sec-head span{font-size:17px;font-weight:900;color:#102519}
.catalog-sec-head::after{content:'';display:block;width:36px;height:3px;background:#b8d9bd;border-radius:999px;margin-right:4px}
.catalog-content-card--outcome{background:linear-gradient(135deg,#f9f4e8 0,#eef8ef 100%);border-color:#e2d8bf;padding:24px 26px}
.catalog-content-card--outcome .catalog-sec-head i{color:#2d5a3d}
.catalog-content-card--outcome .catalog-sec-head span{color:#102519}
.catalog-content-card--outcome .catalog-sec-head::after{background:#cfe7d4}
.catalog-content-card--outcome p{color:#36483d;font-size:15px;line-height:1.95}
.catalog-steps{display:flex;align-items:center;flex-wrap:wrap;gap:0;margin-top:10px}
.catalog-step{display:flex;flex-direction:column;align-items:center;gap:4px}
.catalog-step-dot{width:36px;height:36px;border-radius:50%;background:#e8f5e0;border:1.5px solid #c2e0a0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#2d5a3d}
.catalog-step-label{font-size:10px;font-weight:700;color:#2d5a3d}
.catalog-step-arrow{color:var(--color-border-secondary,#cbd5e1);font-size:16px;margin:0 4px 16px;flex-shrink:0}
.catalog-syllabus-section{grid-column:1/-1;display:grid;gap:10px;min-width:0;direction:rtl;text-align:right}
.catalog-syl-wrap{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-items:stretch}
.catalog-syllabus-item{min-width:0;width:100%;box-sizing:border-box;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:flex-start;background:rgba(255,254,251,.95);border:1px solid rgba(224,216,202,.9);border-radius:14px;padding:10px 11px;box-shadow:0 6px 16px rgba(15,45,31,.045);break-inside:avoid;page-break-inside:avoid}
.catalog-syllabus-badge{width:28px;height:28px;border-radius:50%;background:#e5f4e7;border:1px solid #b8d9bd;color:#1f4a30;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;line-height:1;flex:0 0 28px}
.catalog-syllabus-content{min-width:0;display:grid;gap:4px}
.catalog-syllabus-title{margin:0;color:#102519;font-size:.82rem;line-height:1.28;font-weight:900;overflow-wrap:anywhere;unicode-bidi:plaintext}
.catalog-syllabus-desc{margin:0;color:#4f6358;font-size:.74rem;line-height:1.35;overflow-wrap:anywhere;unicode-bidi:plaintext;white-space:pre-line}
.catalog-strip{background:#f7f6fb;border:1px solid #ddd8f0;border-radius:10px;padding:10px 12px}
.catalog-strip h3{font-size:13.5px;font-weight:700;background:#e5f5ee;color:#1a6645;border-radius:6px;padding:4px 8px;display:inline-block;margin:0 0 10px}
.catalog-strip-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.catalog-strip-grid .catalog-box{background:white}
.catalog-strip-grid .catalog-box strong{display:block;font-size:12px;font-weight:700;color:#1a6645;margin-bottom:5px}
.catalog-mini-card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.catalog-mini-card{border:1px solid #ddd8f0;background:#f7f6fb;border-radius:10px;padding:9px 10px;font-size:13px;font-weight:600;color:#4b3fa0;text-align:center;line-height:1.4}
.catalog-close{background:#f7f6fb;border:1px solid #ddd8f0;border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:12px}
.catalog-close h3{background:#e5f5ee;color:#1a6645}
.catalog-footer{margin-top:auto;border-top:1px solid var(--program-border);padding-top:10px;display:flex;justify-content:space-between;gap:12px;font-size:11.5px;color:var(--program-muted)}
.catalog-a4-header{background:transparent;border:0;border-radius:0;padding:0;color:var(--program-text);box-shadow:none}
.catalog-a4-header h1{font-size:clamp(30px,4.2vw,52px);font-weight:900;color:#102519;margin:0;line-height:1.13;letter-spacing:-.8px;overflow-wrap:anywhere}
.catalog-a4-badge{background:#e5f5ee;color:#1a6645;border:1px solid #a8dfc4;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;display:inline-flex;margin-bottom:8px}
.catalog-a4--elementary .catalog-a4-header,.catalog-a4--middle .catalog-a4-header,.catalog-a4--neutral .catalog-a4-header{background:transparent;border-color:transparent;color:var(--program-text)}
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
@media (max-width:1024px){.catalog-quick-grid{display:flex}}
@media (max-width:900px){.catalog-detail-actions{padding:0}.catalog-a4-wrap{padding:0}.catalog-a4{width:100%;min-height:auto;padding:16px;border-radius:18px}.catalog-hero-top{padding:18px;border-radius:var(--border-radius-lg,18px)}.catalog-frame-grid{grid-template-columns:1fr 1fr}.catalog-list-grid{grid-template-columns:1fr}.catalog-content-grid{grid-template-columns:1fr}.catalog-syl-wrap{grid-template-columns:repeat(2,minmax(0,1fr))}.catalog-footer{flex-direction:column}}
@media (max-width:1100px){.catalog-groups{grid-template-columns:1fr}.catalog-group-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.catalog-header h2{font-size:24px}.catalog-toolbar{align-items:stretch}.catalog-filter-field{flex:1 1 100%;min-width:0;font-size:12px}}
@media (max-width:640px){.catalog-frame-grid,.catalog-list-grid,.catalog-strip-grid,.catalog-mini-card-grid{grid-template-columns:1fr}.catalog-card{min-height:62px}.catalog-group-grid{grid-template-columns:1fr}.catalog-content-card{padding:18px}.catalog-quick-grid{display:grid;grid-template-columns:1fr}.catalog-quick-card{border-radius:16px;align-items:flex-start;justify-content:space-between}.catalog-hero-top{padding:24px 20px}.catalog-syl-wrap{grid-template-columns:1fr}.catalog-syllabus-item{grid-template-columns:1fr;gap:7px}.catalog-syllabus-badge{width:max-content;min-width:34px;height:24px;padding:0 10px;border-radius:999px}}
@media (max-width:430px){.catalog-a4{padding:14px}.catalog-hero-top{padding:16px}.catalog-content-card p{font-size:13px}}
@media print {
  @page{size:A4 portrait;margin:0}
  html,body{background:#fff !important;margin:0 !important;padding:0 !important;width:210mm !important;min-width:0 !important;overflow:visible !important}
  body.catalog-printing > *{display:none !important}
  body.catalog-printing > #app{display:block !important;visibility:visible !important;width:210mm !important;min-height:0 !important;margin:0 !important;padding:0 !important;background:#fff !important;overflow:visible !important}
  body.catalog-printing #app,body.catalog-printing .app-shell,body.catalog-printing .shell-main,body.catalog-printing .shell-stage,body.catalog-printing #screenRoot{position:static !important;display:block !important;visibility:visible !important;width:210mm !important;max-width:210mm !important;min-width:0 !important;min-height:0 !important;height:auto !important;margin:0 !important;padding:0 !important;background:#fff !important;box-shadow:none !important;border:0 !important;overflow:visible !important;transform:none !important}
  body.catalog-printing .shell-backdrop,body.catalog-printing .shell-sidebar,body.catalog-printing .shell-top,body.catalog-printing .catalog-print-hide{display:none !important;visibility:hidden !important}
  body.catalog-printing #screenRoot > :not(.catalog-screen.catalog-print-zone){display:none !important}
  body.catalog-printing .catalog-screen.catalog-print-zone,body.catalog-printing .catalog-screen.catalog-print-zone *{visibility:visible !important}
  body.catalog-printing .catalog-screen.catalog-print-zone{position:static !important;display:block !important;inset:auto !important;width:210mm !important;max-width:210mm !important;min-height:0 !important;margin:0 !important;padding:0 !important;background:#fff !important;color:#000 !important;box-shadow:none !important;border:0 !important;gap:0 !important;overflow:visible !important}
  body.catalog-printing .catalog-a4-wrap.catalog-print-zone{position:static !important;display:block !important;width:210mm !important;max-width:210mm !important;margin:0 !important;padding:0 !important;background:#fff !important;overflow:visible !important}
  body.catalog-printing .catalog-print-page{width:210mm !important;min-height:297mm !important;height:auto !important;margin:0 !important;padding:12mm 14mm !important;box-sizing:border-box !important;background:#fff !important;page-break-after:auto !important;break-after:auto !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  body.catalog-printing .catalog-a4.catalog-print-page{max-width:210mm !important;box-shadow:none !important;border:none !important;border-radius:0 !important;overflow:visible !important}
  body.catalog-printing .catalog-print-page .catalog-hero-top{padding:14mm 12mm !important;border-radius:18px !important}
  body.catalog-printing .catalog-print-page .catalog-content-grid{gap:6mm !important}
  body.catalog-printing .catalog-print-page .catalog-content-card{padding:7mm !important;border-radius:16px !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-section{gap:3mm !important}
  body.catalog-printing .catalog-print-page .catalog-syl-wrap{grid-template-columns:repeat(3,minmax(0,1fr)) !important;gap:3mm !important;align-items:stretch !important;break-inside:auto !important;page-break-inside:auto !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-item{min-width:0 !important;width:100% !important;box-sizing:border-box !important;padding:2.8mm 3mm !important;border-radius:10px !important;gap:2.2mm !important;min-height:auto !important;height:auto !important;break-inside:avoid-page !important;page-break-inside:avoid !important;box-shadow:none !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-badge{width:7mm !important;height:7mm !important;flex-basis:7mm !important;font-size:9.5px !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-content{gap:1.2mm !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-title{font-size:9.8px !important;line-height:1.25 !important}
  body.catalog-printing .catalog-print-page .catalog-syllabus-desc{font-size:8.8px !important;line-height:1.3 !important}
  body.catalog-printing .catalog-print-page .catalog-footer{page-break-inside:avoid;break-inside:avoid}
  body.catalog-printing .card,body.catalog-printing .catalog-content-card,body.catalog-printing .g2,body.catalog-printing .catalog-content-grid,body.catalog-printing .catalog-hero-top{page-break-inside:avoid;break-inside:avoid}
  body.catalog-printing .catalog-hero-top::after{display:none}
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
  if (!raw) return 'לא צוין';
  if (raw.includes('יסודי')) return 'יסודי';
  if (raw.includes('תיכון') && raw.includes('חטיבה')) return 'חטיבה';
  if (raw === 'חטיבות' || raw === 'חטיבה' || raw === 'חט״ב' || raw.includes('חטיבה')) return 'חטיבה';
  if (raw.includes('תיכון')) return 'תיכון';
  if (raw === 'יסודי') return 'יסודי';
  return raw;
}

function audienceLevelFromGrades(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'לא צוין';
  if (/י|יא|י״א|יב|י״ב/.test(raw)) return 'תיכון';
  if (/[ז-ט]/.test(raw)) return 'חטיבה';
  if (/[א-ו]/.test(raw)) return 'יסודי';
  return 'לא צוין';
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
  if (normalized === 'course' || normalized === 'program' || raw === 'קורס' || raw === 'תוכנית') return 'תוכנית';
  if (normalized === 'after_school' || normalized === 'חוג אפטרסקול') return 'חוג';
  if (normalized === 'workshop') return 'סדנה';
  if (normalized === 'tour') return 'סיור';
  if (normalized === 'escape_room') return 'חדר בריחה';
  if (raw === 'חוגים') return 'חוג';
  if (raw === 'סיורים') return 'סיור';
  if (raw === 'סדנאות') return 'סדנה';
  return raw || 'תוכנית';
}

function isCatalogCourseProgram(program) {
  const productType = normalizeProductType(program?.productType);
  return productType === 'תוכנית';
}

function programMatchesAudience(program, audience) {
  if (audience === 'הכול') return true;
  const level = normalizeAudienceLevel(program?.audienceLevel);
  if (level === audience) return true;
  const raw = String(program?.audienceLevel || '').trim();
  return raw.includes(audience);
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

function catalogCardTitleFromFields(p, fullName) {
  const explicit = String(p?.catalog_short_title || p?.short_name || '').trim();
  if (explicit) return explicit;
  const sourceName = String(fullName || '').trim();
  for (const [needle, shortTitle] of CATALOG_SHORT_TITLE_OVERRIDES) {
    if (sourceName.includes(needle)) return shortTitle;
  }

  const compactTitle = textBeforeMarketingDash(sourceName);
  return compactTitle || sourceName || 'ללא שם';
}

function normalizeProgram(item, idx) {
  const p = item && typeof item === 'object' ? item : {};
  const catalogSyllabus = Array.isArray(p.catalog_syllabus) ? p.catalog_syllabus : [];
  const fullName = String(pickFirstNonEmpty(p.catalog_title, p.catalogTitle, p.title) || 'ללא שם');
  const targetGrades = String(pickFirstNonEmpty(p.target_grades, p.targetGrades) || '');
  return {
    id: String(pickFirstNonEmpty(p.gefen_number, p.gefenNumber, p.activity_no, p.id, p.programId, p.slug) || `program-${idx + 1}`),
    name: fullName,
    catalogTitle: fullName,
    title: fullName,
    catalogCardTitle: catalogCardTitleFromFields(p, fullName),
    catalogSubtitle: String(pickFirstNonEmpty(p.catalog_subtitle, p.catalogSubtitle, p.subtitle) || ''),
    audienceLevel: normalizeAudienceLevel(
      p.audience_level || p.audienceLevel || p.catalog_section || audienceLevelFromGrades(targetGrades)
    ),
    productType: normalizeProductType(
      p.item_type ||
      p.productType ||
      p.activity_type ||
      p.type ||
      'תוכנית'
    ),
    targetGrades,
    domain: String(pickFirstNonEmpty(p.domain) || ''),
    scope: String(pickFirstNonEmpty(p.scope) || inferScope(p)),
    sessionDuration: String(pickFirstNonEmpty(p.session_duration, p.sessionDuration) || ''),
    gefenNumber: String(pickFirstNonEmpty(p.gefen_number, p.gefenNumber, p.gefen) || ''),
    subtitle: String(pickFirstNonEmpty(p.catalog_subtitle, p.catalogSubtitle, p.subtitle) || ''),
    openingLine: String(pickFirstNonEmpty(p.opening_line, p.openingLine) || ''),
    shortDescription: String(pickFirstNonEmpty(p.short_description, p.shortDescription) || ''),
    coreIdea: String(pickFirstNonEmpty(p.core_idea, p.coreIdea) || ''),
    goals: String(pickFirstNonEmpty(p.goals) || ''),
    programFlow: String(pickFirstNonEmpty(p.program_flow, p.programFlow) || ''),
    studentDevelops: pickFirstNonEmpty(p.student_develops, p.studentDevelops) || '',
    schoolValue: String(pickFirstNonEmpty(p.school_value, p.schoolValue) || ''),
    syllabus: catalogSyllabus,
    stations: Array.isArray(p.stations) ? p.stations : [],
    participantsReceive: pickFirstNonEmpty(p.participants_receive, p.participantsReceive) || [],
    finalOutcome: String(pickFirstNonEmpty(p.final_outcome, p.finalOutcome) || ''),
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
    <div class="catalog-card-text">
      <h3>${escapeHtml(program.catalogCardTitle || program.catalogTitle || program.name)}</h3>
      ${program.catalogSubtitle ? `<p>${escapeHtml(program.catalogSubtitle)}</p>` : ''}
    </div>
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

function parseSkills(val, fallback = '') {
  if (Array.isArray(val)) {
    return val.map(String).map((s) => s.trim()).filter(Boolean);
  }

  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((s) => s.trim()).filter(Boolean);
      }
    } catch (_) {
      // Plain text is supported below.
    }

    return val.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  }

  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  }

  return [];
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
  const tags = String(program?.domain || '')
    .split(/[|,،]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length
    ? `<div class="catalog-domain-chips">${tags.map((tag) => `<span class="catalog-domain-chip">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
}

function renderGefenBadge(program) {
  const gefen = meaningfulText(program.gefenNumber);
  return gefen ? `<span class="catalog-gefen-badge">מס׳ גפ״ן: ${escapeHtml(gefen)}</span>` : '';
}

function renderQuickInfoCards(program) {
  const cards = [
    ['גיל יעד', meaningfulText(program.targetGrades) || meaningfulText(program.audienceLevel)],
    ['היקף', meaningfulText(program.scope)],
    ['משך מפגש', meaningfulText(program.sessionDuration)],
    ['תחום', meaningfulText(program.domain)],
    ['סוג פעילות', meaningfulText(program.productType)]
  ].filter(([, value]) => value);

  return cards.length
    ? `<section class="catalog-quick-grid">${cards.map(([label, value]) => `<div class="catalog-quick-card"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')}</section>`
    : '';
}

function renderProgramContentCard(title, value) {
  const text = meaningfulText(value);
  if (!text) return '';
  return `<section class="catalog-content-card">${renderSectionHead(title)}<p>${escapeHtml(text)}</p></section>`;
}

function renderProgramContentCardWithClass(title, value, className) {
  const text = meaningfulText(value);
  if (!text) return '';
  return `<section class="catalog-content-card ${escapeHtml(className || '')}">${renderSectionHead(title)}<p>${escapeHtml(text)}</p></section>`;
}

function renderSectionHead(title) {
  const icons = {
    'מטרת התוכנית': 'ti-target',
    'תקציר התוכנית': 'ti-book',
    'תיאור התוכנית': 'ti-align-left',
    'מה לומדים ואיך לומדים': 'ti-route',
    'מה מקבלים המשתתפים': 'ti-gift',
    'תוצר מסכם / שיא תהליך': 'ti-trophy',
    'ערך לבית הספר': 'ti-school'
  };
  return `<div class="catalog-sec-head"><i class="ti ${escapeHtml(icons[title] || 'ti-circle')}" aria-hidden="true"></i><span>${escapeHtml(title)}</span></div>`;
}

function renderProgramSteps() {
  const steps = [
    ['1', 'חוקרים'],
    ['2', 'מתכננים'],
    ['3', 'בונים'],
    ['4', 'מציגים']
  ];
  return `<div class="catalog-steps">${steps.map(([icon, label], idx) => `<div class="catalog-step"><div class="catalog-step-dot">${icon}</div><span class="catalog-step-label">${escapeHtml(label)}</span></div>${idx < steps.length - 1 ? '<span class="catalog-step-arrow">←</span>' : ''}`).join('')}</div>`;
}

function renderProgramFlowCard(program) {
  const text = meaningfulText(program.programFlow);
  if (!text) return '';
  return `<section class="catalog-content-card catalog-content-card--wide">${renderSectionHead('מה לומדים ואיך לומדים')}<p>${escapeHtml(text)}</p>${renderProgramSteps()}</section>`;
}

function renderSkillsCard(program) {
  const skills = parseSkills(program.participantsReceive, program.studentDevelops);
  if (!skills.length) return '';
  return `<section class="catalog-content-card catalog-content-card--skills">${renderSectionHead('מה מקבלים המשתתפים')}<div class="catalog-chips">${skills.map((skill) => `<span class="catalog-chip">${escapeHtml(skill)}</span>`).join('')}</div></section>`;
}

function syllabusMeetingText(item) {
  return meaningfulText(item?.meeting_label || item?.meetingLabel) || meaningfulText(item?.meeting_order || item?.meetingOrder);
}

function renderSyllabusItem(item, idx) {
  if (!item || typeof item !== 'object') return '';
  const meeting = syllabusMeetingText(item) || String(idx + 1);
  const title = meaningfulText(item.title || item.topic);
  const description = meaningfulText(item.description || item.details);
  if (!meeting && !title && !description) return '';
  return `<article class="catalog-syllabus-item">
    <div class="catalog-syllabus-badge">${escapeHtml(meeting)}</div>
    <div class="catalog-syllabus-content">
      ${title ? `<h3 class="catalog-syllabus-title">${escapeHtml(title)}</h3>` : ''}
      ${description ? `<p class="catalog-syllabus-desc">${escapeHtml(description)}</p>` : ''}
    </div>
  </article>`;
}

function renderProgramSyllabus(program) {
  const rows = Array.isArray(program.syllabus)
    ? [...program.syllabus]
      .sort((a, b) => (Number(a?.meeting_order ?? a?.meetingOrder ?? 0) || 0) - (Number(b?.meeting_order ?? b?.meetingOrder ?? 0) || 0))
      .map(renderSyllabusItem)
      .filter(Boolean)
    : [];
  const count = rows.length;
  return rows.length
    ? `<section class="catalog-syllabus-section"><div class="catalog-area-divider">סילבוס התוכנית - ${count} מפגשים</div><div class="catalog-syl-wrap">${rows.join('')}</div></section>`
    : '';
}

function renderProgramBodyCards(program) {
  const cards = [
    '<div class="catalog-area-divider catalog-area-divider--content">מה כוללת התוכנית</div>',
    renderProgramContentCard('מטרת התוכנית', program.coreIdea),
    renderProgramContentCardWithClass('תיאור התוכנית', program.goals, 'catalog-content-card--wide'),
    renderProgramContentCardWithClass('תקציר התוכנית', program.shortDescription, 'catalog-content-card--green'),
    renderProgramFlowCard(program),
    renderSkillsCard(program),
    renderProgramContentCardWithClass('תוצר מסכם / שיא תהליך', program.finalOutcome, 'catalog-content-card--outcome'),
    renderProgramContentCardWithClass('ערך לבית הספר', program.schoolValue, 'catalog-content-card--value')
  ].filter(Boolean);
  const syllabus = renderProgramSyllabus(program);
  if (syllabus) cards.push(syllabus);
  return cards.length ? `<section class="catalog-content-grid">${cards.join('')}</section>` : '';
}

function domainToneClass(program) {
  const haystack = [program.domain, program.name, program.subtitle, program.coreIdea]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (haystack.includes('ai') || haystack.includes('בינה')) return 'catalog-theme--ai';
  if (haystack.includes('חלל') || haystack.includes('space')) return 'catalog-theme--space';
  if (haystack.includes('יזמות') || haystack.includes('עסק')) return 'catalog-theme--entrepreneurship';
  if (haystack.includes('תעשייה') || haystack.includes('תעשיה') || haystack.includes('industry')) return 'catalog-theme--industry';
  if (haystack.includes('ביומימיקרי') || haystack.includes('קיימות') || haystack.includes('סביבה') || haystack.includes('טבע')) return 'catalog-theme--nature';
  if (haystack.includes('משחק') || haystack.includes('game')) return 'catalog-theme--games';
  if (haystack.includes('רוקחות') || haystack.includes('תרופות') || haystack.includes('pharma')) return 'catalog-theme--pharma';
  if (haystack.includes('העצמה') || haystack.includes('פורצות') || haystack.includes('מנהיג') || haystack.includes('leadership')) return 'catalog-theme--leadership';
  if (haystack.includes('טכנולוג')) return 'catalog-theme--ai';
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

    const filtered = data.programs.filter((p) => programMatchesAudience(p, audience) && matchesCatalogType(p, type));
    const elementaryPrograms = filtered.filter((p) => p.audienceLevel === 'יסודי' && isCatalogCourseProgram(p));
    const middlePrograms = filtered.filter((p) => p.audienceLevel === 'חטיבה' && isCatalogCourseProgram(p));
    const highSchoolPrograms = filtered.filter((p) => p.audienceLevel === 'תיכון' && isCatalogCourseProgram(p));
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
    const heroLead = meaningfulText(selected.subtitle) || openingText;
    const showOpeningCard = openingText && openingText !== heroLead;
    const bodyCardsHtml = renderProgramBodyCards(selected);
    const printTitle = [selected.name, selected.subtitle].map(meaningfulText).filter(Boolean).join(' – ');
    return `<section class="catalog-screen catalog-print-zone">
      <div class="catalog-detail-actions catalog-print-hide">
        <button class="catalog-btn" data-catalog-back>חזרה לקטלוג</button>
      </div>
      <div class="catalog-print-bar catalog-print-hide">
        <span class="catalog-print-bar-name">${escapeHtml(printTitle)}</span>
        <button class="catalog-print-btn" data-catalog-print>הדפסה / PDF</button>
      </div>
      <div class="catalog-a4-wrap catalog-print-zone"><article class="catalog-a4 catalog-print-page ${a4ToneClass} ${a4ThemeClass}" data-catalog-page="1">
        <header class="catalog-a4-header">
          <div class="catalog-hero-top"><div class="catalog-domain-icon" aria-hidden="true">${escapeHtml((selected.domain || selected.name || 'ת').trim().slice(0, 1))}</div><div class="catalog-hero-main">${renderGefenBadge(selected)}<h1>${escapeHtml(selected.name)}</h1>${heroLead ? `<p class="catalog-subtitle">${escapeHtml(heroLead)}</p>` : ''}${renderQualityTags(selected)}</div>${renderQuickInfoCards(selected)}</div>
        </header>
        ${showOpeningCard ? `<p class="catalog-opening-line">${escapeHtml(openingText)}</p>` : ''}
        ${bodyCardsHtml}
        <footer class="catalog-footer"><span>עמותת תעשיידע — חינוך טכנולוגי, חדשנות ויזמות</span><span>קטלוג תוכניות תשפ״ז</span></footer>
      </article></div>
    </section>`;
  },

  bind: ({ root, data, rerender }) => {
    catalogRootState.set(root, { data, rerender });
    if (catalogBoundRoots.has(root)) return;
    catalogBoundRoots.add(root);

    root.addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-catalog-filter]');
      if (!sel) return;
      const binding = catalogRootState.get(root);
      if (!binding) return;
      const key = sel.dataset.catalogFilter;
      if (key === 'audience') binding.data.audience = sel.value;
      if (key === 'type') binding.data.type = sel.value;
      binding.rerender();
    });

    root.addEventListener('click', (ev) => {
      const binding = catalogRootState.get(root);
      if (!binding) return;
      const { data, rerender } = binding;
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
      if (ev.target.closest('[data-catalog-print]')) printCatalogOnce();
    });
  }
};
