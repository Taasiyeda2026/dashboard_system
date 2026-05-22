const STORAGE_KEY = 'taasiyeda_invitation_builder_state_v4';
const ASSET_BASE = './assets/invitations/';

const LOGOS = {
  mohe: `${ASSET_BASE}logos/education-logo.png`,
  taas: `${ASSET_BASE}logos/taasiyeda-logo.png`
};

const BG_URLS = [
  { type: 'solid', label: 'לבן', value: '#ffffff' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    type: 'image',
    label: `רקע ${n}`,
    value: `${ASSET_BASE}backgrounds/background-${n}.png`
  }))
];

const DEFAULT_PARTS = [
  { t: 'גב׳', n: 'יעל אביב', r: 'מנהלת תחום חינוך ופדגוגיה, תעשיידע' },
  { t: 'גב׳', n: 'הילה רוזן', r: 'אחראית הדרכה ומנחת הקבוצה, תעשיידע' }
];

const SUGGESTED_TEXTS_BY_COURSE = {
  'ביומימיקרי – המצאות בהשראת הטבע': {
    b1: 'לאורך התהליך יצאו התלמידים למסע חקר בעקבות הטבע: הם התבוננו בבעלי חיים, בצמחים ובתופעות טבע וגילו כיצד הטבע יכול לעורר השראה לפיתוח פתרונות טכנולוגיים חדשניים.',
    b2: 'התלמידים יציגו את הרעיונות המקוריים שפיתחו וישתפו בדרך שבה סקרנות, יצירתיות, מדע וטכנולוגיה התחברו לחוויית למידה משמעותית בהשראת הטבע.'
  },
  'רוקחים עולם': {
    b1: 'לאורך התהליך נחשפו התלמידים לעולם הפארמצבטיקה והרוקחות: הם הכירו כיצד ידע מדעי, חומרים, דיוק ואחריות מתחברים לפיתוח פתרונות המשפיעים על בריאות ואיכות חיים.',
    b2: 'התלמידים יציגו את התובנות והתוצרים שפיתחו, וישתפו בדרך שבה חקר, חשיבה מדעית, יצירתיות וטכנולוגיה התחברו לחוויית למידה משמעותית בתחום הפארמצבטיקה.'
  },
  'בינה מלאכותית – חשיבה ביקורתית במציאות טכנולוגית': {
    b1: 'לאורך התהליך נחשפו התלמידים לעולם הבינה המלאכותית: הם הכירו כיצד נתונים, אלגוריתמים, חשיבה ביקורתית וכלים טכנולוגיים יכולים לסייע בפתרון בעיות, ביצירת רעיונות ובפיתוח תהליכי למידה חדשניים.',
    b2: 'התלמידים יציגו את התוצרים והרעיונות שפיתחו, וישתפו בדרך שבה סקרנות, חשיבה יצירתית, טכנולוגיה ובינה מלאכותית התחברו לחוויית למידה משמעותית ועדכנית.'
  },
  'יזמות פרימיום – אסם': {
    b1: 'לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה, תוך דגש על איכות, בטיחות ואחריות בהשראת עולמות התוכן של אסם.',
    b2: 'התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו להבנה עמוקה של איכות ובטיחות כחלק מחוויית למידה משמעותית.'
  },
  'יזמות פרימיום – מארוול': {
    b1: 'לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה בהשראת עולמות התוכן של מארוול.',
    b2: 'התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו לחוויית למידה משמעותית.'
  },
  default: {
    b1: 'לאורך התהליך השתתפו התלמידים במסע למידה חווייתי, שבו חקרו רעיונות, התנסו בכלים מעשיים וגילו כיצד ידע, יצירתיות וטכנולוגיה מתחברים ללמידה משמעותית.',
    b2: 'התלמידים יציגו את התוצרים והרעיונות שפיתחו, וישתפו בדרך שבה סקרנות, חשיבה יצירתית ועבודת צוות התחברו לחוויית למידה פעילה ומשמעותית.'
  }
};

function ensureStyles() {
  if (document.getElementById('invitation-generator-styles')) return;

  const style = document.createElement('style');
  style.id = 'invitation-generator-styles';
  style.textContent = `
.invitation-screen-root *{box-sizing:border-box;margin:0;padding:0}
.invitation-screen-root{font-family:'Heebo',sans-serif;direction:rtl;font-size:13px;background:#f0f2f4;color:#1a1a2e;height:100%;overflow:hidden}
.invitation-screen-root .app{display:grid;grid-template-columns:300px minmax(0,1fr);height:100dvh;overflow:hidden}
.invitation-screen-root .panel{background:#f7f8fa;border-left:1px solid #e0e3e8;overflow-y:scroll;max-height:100dvh;min-height:0;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.invitation-screen-root .field-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.invitation-screen-root .field-row.trio{grid-template-columns:1fr 1fr 1fr}
.invitation-screen-root select,.invitation-screen-root input[type=text],.invitation-screen-root input[type=date],.invitation-screen-root input[type=time],.invitation-screen-root textarea{width:100%;font-family:'Heebo',sans-serif;font-size:12px;direction:rtl;color:#1a1a2e;border:1px solid #d0d4dc;border-radius:5px;padding:4px 7px;background:#fff;outline:none}
.invitation-screen-root select:focus,.invitation-screen-root input:focus,.invitation-screen-root textarea:focus{border-color:#1a8c6e}
.invitation-screen-root textarea{resize:none;height:48px;font-size:11px}
.invitation-screen-root .lbl{font-size:10px;color:#888;margin-bottom:2px;display:block}
.invitation-screen-root .color-pair{display:flex;gap:6px;align-items:center}
.invitation-screen-root .color-pair label{font-size:11px;color:#666}
.invitation-screen-root .color-pair input[type=color]{width:26px;height:22px;border:1px solid #d0d4dc;border-radius:4px;padding:1px;cursor:pointer;background:none}
.invitation-screen-root .bg-row{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.invitation-screen-root .bg-th{height:48px;border-radius:4px;border:2px solid transparent;cursor:pointer;background-size:cover;background-position:center;background-color:#dde;aspect-ratio:148/210}
.invitation-screen-root .bg-th.sel{border-color:#1a8c6e}
.invitation-screen-root .logo-row{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.invitation-screen-root .lchip{display:flex;align-items:center;gap:4px;background:#fff;border:1px solid #d0d4dc;border-radius:12px;padding:2px 8px;font-size:11px;cursor:grab;user-select:none;white-space:nowrap}
.invitation-screen-root .lchip.ghost{opacity:.35}
.invitation-screen-root .lchip-placeholder{border-style:dashed;color:#8a6d1d;background:#fffaf0}
.invitation-screen-root .lchip-add{cursor:pointer;border-style:dashed;color:#1a6fb5}
.invitation-screen-root .part-row{display:grid;grid-template-columns:18px 46px 1fr 1fr 18px;gap:4px;margin-bottom:4px;align-items:start}
.invitation-screen-root .part-row select,.invitation-screen-root .part-row input{font-size:11px}
.invitation-screen-root .part-row.dragging{opacity:.45}
.invitation-screen-root .drag-handle{cursor:grab;color:#999;font-size:13px;line-height:1.7;text-align:center;user-select:none}
.invitation-screen-root .del-btn{background:none;border:none;cursor:pointer;color:#aaa;font-size:13px;line-height:1;padding:2px 0}
.invitation-screen-root .action-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.invitation-screen-root .btn-print{width:100%;padding:6px;border-radius:7px;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;background:#1a8c6e;color:#fff;border:none}
.invitation-screen-root .btn-print:hover{background:#157a5e}
.invitation-screen-root .btn-clr{width:100%;padding:6px;border-radius:7px;font-family:'Heebo',sans-serif;font-size:12px;cursor:pointer;background:none;border:1px solid #d0d4dc;color:#666;margin-top:4px}
.invitation-screen-root .btn-clr:hover{background:#eee}
.invitation-screen-root .action-row .btn-clr{margin-top:0}
.invitation-screen-root .suggest-btn{width:100%;margin-top:4px;padding:4px 6px;border-radius:6px;border:1px dashed #c4ccd6;background:#fff;color:#59616d;font-family:'Heebo',sans-serif;font-size:10.5px;cursor:pointer;text-align:center}
.invitation-screen-root .suggest-btn:hover{background:#eef6f3;border-color:#1a8c6e;color:#1a8c6e}
.invitation-screen-root .sep{height:1px;background:#e4e7ec}
.invitation-screen-root .preview{background:#d8dfe6;display:flex;flex-direction:column;align-items:center;padding:10px 8px;height:100dvh;min-height:0;overflow:auto}
.invitation-screen-root .preview-lbl{font-size:9px;color:#999;letter-spacing:.5px;margin-bottom:6px}
.invitation-screen-root .preview #card{zoom:.50}
.invitation-screen-root #card{width:148mm;min-height:210mm;position:relative;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.22);direction:rtl;font-family:'Heebo',sans-serif;display:flex;flex-direction:column}
.invitation-screen-root .cbg{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center}
.invitation-screen-root .cframe{position:absolute;inset:5mm;border-radius:10px;border:1.5px solid rgba(255,255,255,.55);pointer-events:none;z-index:3}
.invitation-screen-root .cwrap{position:relative;z-index:2;flex:1;display:flex;flex-direction:column}
.invitation-screen-root .c-logos{display:flex;align-items:center;justify-content:center;gap:1mm;padding:7mm 10mm 1mm;background:rgba(255,255,255,.42);border-bottom:1px solid rgba(255,255,255,.45)}
.invitation-screen-root .c-logo-item{width:36mm;height:16mm;display:flex;align-items:center;justify-content:center;gap:4px;font-size:10px;font-weight:800;color:#1a3a5c;line-height:1.2}
.invitation-screen-root .c-logo-sep{width:1px;height:26px;background:rgba(26,58,92,.2);flex-shrink:0}
.invitation-screen-root .c-logo-item img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.invitation-screen-root .c-main{padding:2mm 7mm 3mm;flex:1;display:flex;flex-direction:column;align-items:center;text-align:center}
.invitation-screen-root .c-title{font-weight:900;line-height:1.02;margin-bottom:0;font-size:15mm}
.invitation-screen-root .c-sub-event{font-weight:700;line-height:1.1;margin-bottom:1mm;font-size:7mm}
.invitation-screen-root .c-course{font-weight:500;line-height:1.12;margin-bottom:1mm;font-size:7.5mm}
.invitation-screen-root .c-course .course-main{display:block;font-size:7.5mm;line-height:1.08;font-weight:500}
.invitation-screen-root .c-course .course-sub{display:block;font-size:6.3mm;line-height:1.08;font-weight:500}
.invitation-screen-root .c-course .course-company{display:block;font-size:4.2mm;line-height:1.2;font-weight:500;margin-top:.8mm}
.invitation-screen-root .c-year{font-size:4.8mm;font-weight:700;margin-bottom:2mm}
.invitation-screen-root .c-school{font-size:4mm;color:#333;margin:1.5mm 0}
.invitation-screen-root .c-school strong{font-weight:700}
.invitation-screen-root .c-divider{width:100%;height:1px;background:rgba(26,58,92,.1);margin:1.5mm 0}
.invitation-screen-root .c-opening{font-size:4mm;color:#333;line-height:1.4;margin:1mm auto;max-width:none;width:80%;text-align:right;align-self:center;margin-inline:auto;padding-inline:4.5mm;box-sizing:border-box}
.invitation-screen-root .c-opening strong{font-weight:700;color:var(--accent-color,#1a8c6e)}
.invitation-screen-root .c-para{font-size:4mm;color:#333;line-height:1.4;margin:.5mm auto;text-align:right;max-width:none;width:80%;align-self:center;margin-inline:auto;padding-inline:4.5mm;box-sizing:border-box}
.invitation-screen-root .c-section-title{font-size:3.45mm;font-weight:800;color:var(--accent-color,#1a8c6e);line-height:1.2;margin:1.5mm auto .5mm;max-width:none;width:80%;text-align:right;align-self:center;margin-inline:auto;padding-inline:4.5mm;box-sizing:border-box}
.invitation-screen-root .c-box{background:rgba(255,255,255,.5);border:1px solid rgba(26,140,110,.22);border-radius:8px;padding:2mm 4.5mm;margin:1.5mm 0;width:100%;text-align:right}
.invitation-screen-root .c-participants-box{width:80%;max-width:none;margin-left:auto;margin-right:auto;align-self:center;background:rgba(255,255,255,.38);border-color:rgba(26,140,110,.12);padding:1.6mm 4mm}
.invitation-screen-root .c-details-box{width:75%;max-width:none;margin-left:auto;margin-right:auto;align-self:center;display:flex;flex-direction:column;align-items:center;gap:1.2mm;background:transparent;border-color:rgba(26,140,110,.18);text-align:center}
.invitation-screen-root .c-details-top{display:flex;align-items:center;justify-content:center;gap:4mm;width:100%;flex-wrap:wrap}
.invitation-screen-root .c-details-location{justify-content:center;text-align:center;width:100%;font-size:4.4mm;line-height:1.5}
.invitation-screen-root .c-details-box .c-info-row{justify-content:center;text-align:center}
.invitation-screen-root .c-info-row{display:flex;align-items:center;gap:4px;font-size:4.8mm;color:#333;line-height:1.7}
.invitation-screen-root .c-info-row strong{font-weight:700}
.invitation-screen-root .c-part-title{font-size:3.2mm;font-weight:700;margin-bottom:1px}
.invitation-screen-root .c-part-line{font-size:3.2mm;color:#333;line-height:1.45}
.invitation-screen-root .c-part-line strong{font-weight:700;color:#333}
.invitation-screen-root .c-closing{font-size:6.8mm;font-weight:900;margin-top:auto;padding-top:2mm;text-align:center}
.invitation-screen-root .c-footer{display:flex;align-items:center;justify-content:center;text-align:center;padding:1mm 7mm;background:#fff;border-top:.25mm solid #fff;margin-top:0;margin-bottom:0;backdrop-filter:none;min-height:5mm;position:relative;z-index:4;width:100%}
.invitation-screen-root .c-footer-sentence{font-size:3mm;font-weight:600;line-height:1.18;letter-spacing:.035em;text-shadow:-.3px -.3px 0 rgba(30,38,46,.25),.3px -.3px 0 rgba(30,38,46,.25),-.3px .3px 0 rgba(30,38,46,.25),.3px .3px 0 rgba(30,38,46,.25),0 1px 1.5px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.35mm}
.invitation-screen-root .c-footer-sentence span{text-shadow:inherit}
@media (max-width:1200px){.invitation-screen-root .app{grid-template-columns:300px minmax(0,1fr)}}
`;
  document.head.appendChild(style);
}

function makeDefaultParts() {
  return JSON.parse(JSON.stringify(DEFAULT_PARTS));
}

function makeScreenHtml() {
  return `
<section class="invitation-screen-root" data-inv-root>
  <div class="app">
    <div class="panel">
      <div>
        <span class="lbl">לוגואים — גרור לסדר</span>
        <div class="logo-row" id="logo-zone">
          <div class="lchip" draggable="true" data-id="mohe"><img id="mohe-chip-img" src="" style="height:16px;display:none"> משרד החינוך</div>
          <div class="lchip" draggable="true" data-id="taas"><img id="taas-chip-img" src="" style="height:16px;display:none"> תעשיידע</div>
          <div class="lchip lchip-placeholder" draggable="true" data-id="school" id="school-logo-chip"><img id="school-chip-img" src="" style="height:16px;display:none"> לוגו בית ספר</div>
          <div class="lchip lchip-add" id="logo-add">＋ לוגו נוסף</div>
        </div>
        <input type="file" id="logo-file" accept="image/*" style="display:none">
      </div>

      <div class="sep"></div>

      <div class="field-row">
        <div>
          <span class="lbl">סוג אירוע</span>
          <select id="ev-type">
            <option value="end">מפגש סיום</option>
            <option value="lecture">הרצאת אורח</option>
            <option value="tour">סיור לימודי</option>
          </select>
        </div>
        <div>
          <span class="lbl">קורס</span>
          <select id="course-sel">
            <option value="ביומימיקרי – המצאות בהשראת הטבע">קורס ביומימיקרי</option>
            <option value="רוקחים עולם">רוקחים עולם</option>
            <option value="בינה מלאכותית – חשיבה ביקורתית במציאות טכנולוגית">בינה מלאכותית</option>
            <option value="יזמות פרימיום – אסם">יזמות פרימיום - אסם</option>
            <option value="יזמות פרימיום – מארוול">יזמות פרימיום - מארוול</option>
            <option value="__c">אחר...</option>
          </select>
        </div>
      </div>

      <input type="text" id="course-custom" placeholder="שם קורס" style="display:none">

      <div class="field-row trio">
        <div class="color-pair"><input type="color" id="c1" value="#1a3a5c"><label>כותרת ראשית</label></div>
        <div class="color-pair"><input type="color" id="c2" value="#1a8c6e"><label>כותרות</label></div>
        <div class="color-pair"><input type="color" id="c3" value="#1a8c6e"><label>שם קורס / סיום</label></div>
      </div>

      <div class="sep"></div>

      <div class="field-row trio">
        <div><span class="lbl">בית ספר</span><input type="text" id="school" placeholder='ע"ש הרצל'></div>
        <div><span class="lbl">כיתה</span><input type="text" id="grade" placeholder="ז׳2"></div>
        <div><span class="lbl">שנה</span><select id="year"><option>תשפ״ו</option><option>תשפ״ז</option></select></div>
      </div>

      <div class="field-row">
        <div><span class="lbl">📅 תאריך</span><input type="date" id="ev-date"></div>
        <div><span class="lbl">⏰ שעה</span><input type="time" id="ev-time"></div>
      </div>

      <div><span class="lbl">📍 מיקום</span><input type="text" id="ev-loc"></div>
      <div id="extra"></div>

      <div class="sep"></div>

      <div>
        <span class="lbl">פסקה 1</span>
        <textarea id="b1" maxlength="240" placeholder="לאורך התהליך יצאו התלמידים למסע חקר..."></textarea>
        <button class="suggest-btn" type="button" id="suggest-b1">השתמש בניסוח מומלץ לקורס</button>
      </div>

      <div>
        <span class="lbl">מה מצפה לנו</span>
        <textarea id="b2" maxlength="240" placeholder="במפגש ניחשף לרעיונות המקוריים..."></textarea>
        <button class="suggest-btn" type="button" id="suggest-b2">השתמש בניסוח מומלץ לקורס</button>
      </div>

      <div class="sep"></div>

      <div>
        <span class="lbl">בהשתתפות — גרור לסידור</span>
        <div id="parts"></div>
        <button class="btn-clr" style="font-size:11px;padding:4px;margin-top:2px" id="add-part">+ הוסף משתתף/ת</button>
        <button class="suggest-btn" type="button" id="suggest-parts">השלם משתתפים שחובה לא לפספס</button>
      </div>

      <div class="sep"></div>

      <div>
        <span class="lbl">משפט סיום</span>
        <input type="text" id="closing1" value="נשמח לראותכם!">
      </div>

      <div class="sep"></div>

      <div><span class="lbl">רקע</span><div class="bg-row" id="bg-row"></div></div>

      <div class="sep"></div>

      <div class="action-row">
        <button class="btn-print" id="print-btn">PDF</button>
        <button class="btn-clr" id="reset-btn">איפוס</button>
      </div>
    </div>

    <div class="preview">
      <div class="preview-lbl">A5 — תצוגה מקדימה</div>
      <div id="card">
        <div class="cbg" id="cbg"></div>
        <div class="cframe"></div>
        <div class="cwrap" id="cwrap"></div>
      </div>
    </div>
  </div>
</section>`;
}

export const invitationsScreen = {
  load: async () => ({}),

  render() {
    ensureStyles();
    return makeScreenHtml();
  },

  bind({ root }) {
    const host = root.querySelector('[data-inv-root]');
    if (!host) return;

    const $ = (id) => host.querySelector(`#${id}`);
    const queryAll = (selector) => Array.from(host.querySelectorAll(selector));

    let isRestoring = false;
    let selBg = 0;
    let logoOrder = ['mohe', 'taas', 'school'];
    let customLogos = {};
    let logoUploadTarget = null;
    let taasLogoLoaded = false;
    let moheLogoLoaded = false;
    let parts = makeDefaultParts();
    let savedFields = {};

    function esc(value) {
      return String(value || '').replace(/[&<>"]/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
      }[ch]));
    }

    function getCourseName() {
      const selected = $('course-sel').value;
      return selected === '__c' ? ($('course-custom').value || '') : selected;
    }

    function getSuggestedSetForCurrentCourse() {
      return SUGGESTED_TEXTS_BY_COURSE[getCourseName()] || SUGGESTED_TEXTS_BY_COURSE.default;
    }

    function isKnownSuggestedText(value) {
      const clean = (value || '').trim();
      if (!clean) return true;

      return Object.values(SUGGESTED_TEXTS_BY_COURSE).some((set) =>
        Object.values(set).some((text) => (text || '').trim() === clean)
      );
    }

    function refreshSuggestedTextsForCourse() {
      const set = getSuggestedSetForCurrentCourse();

      ['b1', 'b2'].forEach((id) => {
        const el = $(id);
        if (!el || !set[id]) return;
        if (isKnownSuggestedText(el.value)) el.value = set[id];
      });
    }

    function onCourseChange() {
      refreshSuggestedTextsForCourse();
      up();
    }

    function applySuggestedText(id) {
      const set = getSuggestedSetForCurrentCourse();
      const el = $(id);
      if (!el || !set[id]) return;

      el.value = set[id];
      up();
    }

    function applySuggestedParticipants() {
      const hasPrincipal = parts.some((p) => /מנהלת בית הספר|מנהל בית הספר/.test(p.r || ''));
      const hasYael = parts.some((p) => (p.n || '').trim() === 'יעל אביב');

      if (!hasPrincipal) {
        parts.unshift({ t: 'גב׳', n: '', r: 'מנהלת בית הספר' });
      }

      if (!hasYael) {
        parts.splice(hasPrincipal ? 0 : 1, 0, {
          t: 'גב׳',
          n: 'יעל אביב',
          r: 'מנהלת תחום חינוך ופדגוגיה, תעשיידע'
        });
      }

      renderParts();
      up();
    }

    function initBg() {
      const row = $('bg-row');
      row.innerHTML = '';

      BG_URLS.forEach((bg, index) => {
        const item = document.createElement('div');
        item.className = `bg-th${index === selBg ? ' sel' : ''}`;
        item.title = bg.label;

        if (bg.type === 'solid') {
          item.style.backgroundColor = bg.value;
          item.style.backgroundImage = 'none';
        } else {
          item.style.backgroundImage = `url(${bg.value})`;
        }

        item.onclick = () => {
          selBg = index;
          initBg();
          up();
        };

        row.appendChild(item);
      });
    }

    function renderParts() {
      const container = $('parts');
      container.innerHTML = '';

      parts.forEach((participant, index) => {
        const row = document.createElement('div');
        row.className = 'part-row';
        row.draggable = true;
        row.dataset.index = String(index);

        row.innerHTML = `
          <div class="drag-handle" title="גרירה לסידור">⋮⋮</div>
          <select>
            <option ${participant.t === 'גב׳' ? 'selected' : ''}>גב׳</option>
            <option ${participant.t === 'מר' ? 'selected' : ''}>מר</option>
          </select>
          <input type="text" placeholder="שם" value="${esc(participant.n)}">
          <input type="text" placeholder="תפקיד" value="${esc(participant.r)}">
          <button class="del-btn" type="button">×</button>`;

        const titleSelect = row.querySelector('select');
        const inputs = row.querySelectorAll('input');

        titleSelect.onchange = () => {
          parts[index].t = titleSelect.value;
          up();
        };

        inputs[0].oninput = () => {
          parts[index].n = inputs[0].value;
          up();
        };

        inputs[1].oninput = () => {
          parts[index].r = inputs[1].value;
          up();
        };

        row.querySelector('button').onclick = () => {
          parts.splice(index, 1);
          renderParts();
          up();
        };

        row.ondragstart = (event) => {
          event.dataTransfer.setData('partIndex', String(index));
          row.classList.add('dragging');
        };

        row.ondragend = () => row.classList.remove('dragging');
        row.ondragover = (event) => event.preventDefault();

        row.ondrop = (event) => {
          event.preventDefault();
          const from = Number(event.dataTransfer.getData('partIndex'));
          const to = Number(row.dataset.index);

          if (!Number.isNaN(from) && !Number.isNaN(to) && from !== to) {
            const moved = parts.splice(from, 1)[0];
            parts.splice(to, 0, moved);
            renderParts();
            up();
          }
        };

        container.appendChild(row);
      });
    }

    function addPart() {
      parts.push({ t: 'גב׳', n: '', r: '' });
      renderParts();
      up();
    }

    function getAllFieldIds() {
      return [
        'ev-type',
        'course-sel',
        'course-custom',
        'c1',
        'c2',
        'c3',
        'school',
        'grade',
        'year',
        'ev-date',
        'ev-time',
        'ev-loc',
        'b1',
        'b2',
        'closing1',
        'lec-name',
        'lec-topic',
        'lec-org',
        'tour-place',
        'tour-org'
      ];
    }

    function collectFields() {
      const fields = {};
      getAllFieldIds().forEach((id) => {
        const el = $(id);
        if (el) fields[id] = el.value;
      });
      return fields;
    }

    function applyFields(fields = {}) {
      Object.entries(fields).forEach(([id, value]) => {
        const el = $(id);
        if (el) el.value = value;
      });
    }

    function saveState() {
      if (isRestoring) return;

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          fields: collectFields(),
          parts,
          selBg,
          logoOrder,
          customLogos
        }));
      } catch (error) {
        console.warn('Could not save invitation builder state', error);
      }
    }

    function restoreState() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      try {
        isRestoring = true;
        const state = JSON.parse(raw);

        savedFields = state.fields || {};
        applyFields(savedFields);

        if (Array.isArray(state.parts)) parts = state.parts;
        if (typeof state.selBg === 'number') selBg = Math.min(Math.max(state.selBg, 0), BG_URLS.length - 1);
        if (Array.isArray(state.logoOrder)) logoOrder = state.logoOrder;
        if (state.customLogos && typeof state.customLogos === 'object') customLogos = state.customLogos;

        isRestoring = false;
      } catch (error) {
        console.warn('Could not restore invitation builder state', error);
        isRestoring = false;
      }
    }

    function rebuildCustomLogoChips() {
      Object.entries(customLogos).forEach(([id, src]) => {
        if (id === 'school' || host.querySelector(`[data-id="${id}"]`)) return;

        const chip = document.createElement('div');
        chip.className = 'lchip';
        chip.draggable = true;
        chip.dataset.id = id;
        chip.innerHTML = `<img src="${src}" style="height:14px"> <button style="background:none;border:none;cursor:pointer;font-size:12px;color:#999;padding:0">×</button>`;

        chip.querySelector('button').onclick = (event) => {
          event.stopPropagation();
          logoOrder = logoOrder.filter((item) => item !== id);
          delete customLogos[id];
          chip.remove();
          up();
        };

        $('logo-add').before(chip);
      });

      const schoolChipImg = $('school-chip-img');
      if (customLogos.school && schoolChipImg) {
        schoolChipImg.src = customLogos.school;
        schoolChipImg.style.display = 'inline-block';
      }
    }

    function fmtDate(value) {
      if (!value) return null;

      const date = new Date(`${value}T12:00:00`);

      return {
        day: `יום ${['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][date.getDay()]}`,
        date: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
      };
    }

    function getCourseParts(course) {
      const normalized = (course || '').replace(/ +- +/g, ' – ');
      const split = normalized.split(' – ');

      return {
        name: (split[0] || course || '').replace(/^קורס +/, '').trim(),
        subtitle: split.slice(1).join(' – ').trim()
      };
    }

    function getCourseDisplayHTML(course) {
      if (course === 'יזמות פרימיום – אסם') {
        return '<span class="course-main">של קורס יזמות פרימיום</span><span class="course-company">בליווי חברה מאמצת: אסם</span>';
      }

      if (course === 'יזמות פרימיום – מארוול') {
        return '<span class="course-main">של קורס יזמות פרימיום</span><span class="course-company">בליווי חברה מאמצת: מארוול</span>';
      }

      const courseParts = getCourseParts(course);

      return `<span class="course-main">של קורס ${esc(courseParts.name)}</span>${courseParts.subtitle ? `<span class="course-sub">${esc(courseParts.subtitle)}</span>` : ''}`;
    }

    function getHeaderEventText(type, evLabel) {
      return type === 'end' ? 'למפגש הסיום' : evLabel;
    }

    function getCourseOpeningText(course) {
      return course === 'יזמות פרימיום – אסם' || course === 'יזמות פרימיום – מארוול'
        ? 'יזמות פרימיום'
        : course;
    }

    function getCourseFileNameText(course) {
      if (course === 'ביומימיקרי – המצאות בהשראת הטבע') return 'ביומימיקרי';
      if (course === 'יזמות פרימיום – אסם') return 'יזמות פרימיום אסם';
      if (course === 'יזמות פרימיום – מארוול') return 'יזמות פרימיום מארוול';

      return (course || 'קורס').replace(/קורס\s*/g, '').trim() || 'קורס';
    }

    function getEventFileNameText(type) {
      if (type === 'end') return 'מפגש סיום';
      if (type === 'lecture') return 'הרצאת אורח';
      if (type === 'tour') return 'סיור לימודי';
      return 'אירוע';
    }

    function getPdfFileName() {
      return `הזמנה - ${getEventFileNameText($('ev-type').value)} ${getCourseFileNameText(getCourseName())}`;
    }

    function onTypeChange() {
      const type = $('ev-type').value;
      const extra = $('extra');
      extra.innerHTML = '';

      if (type === 'lecture') {
        extra.innerHTML = `
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">שם המרצה</span><input type="text" id="lec-name"></div>
            <div><span class="lbl">נושא</span><input type="text" id="lec-topic"></div>
          </div>
          <div style="margin-top:4px"><span class="lbl">חברה / מוסד</span><input type="text" id="lec-org"></div>`;
      } else if (type === 'tour') {
        extra.innerHTML = `
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">מקום הסיור</span><input type="text" id="tour-place"></div>
            <div><span class="lbl">חברה מארחת</span><input type="text" id="tour-org"></div>
          </div>`;
      }

      extra.querySelectorAll('input').forEach((input) => {
        input.oninput = up;
      });

      applyFields(savedFields);
      up();
    }

    function logoItemHTML(id, size, textSize, className) {
      if (id === 'school') {
        if (customLogos.school) return `<div class="${className}"><img src="${customLogos.school}"></div>`;

        return `<div class="${className}" style="border:1px dashed rgba(26,58,92,.35);border-radius:6px;color:rgba(26,58,92,.55);font-size:${textSize}px">לוגו בית הספר</div>`;
      }

      if (id === 'mohe') {
        if (moheLogoLoaded) return `<div class="${className}"><img src="${LOGOS.mohe}"></div>`;

        return `<div class="${className}"><span style="font-size:${size + 4}px">🏛️</span><span style="font-size:${textSize}px">משרד<br>החינוך</span></div>`;
      }

      if (id === 'taas') {
        if (taasLogoLoaded) return `<div class="${className}"><img src="${LOGOS.taas}"></div>`;

        return `<div class="${className}"><span style="font-size:${size + 4}px">⚡</span><span style="font-size:${textSize}px">תעשיידע</span></div>`;
      }

      if (customLogos[id]) return `<div class="${className}"><img src="${customLogos[id]}"></div>`;

      return '';
    }

    function logosBarHTML(footer = false) {
      if (footer) {
        return `
          <div class="c-footer">
            <div class="c-footer-sentence">
              <span style="color:#1e262e">תעשיידע – </span>
              <span class="bright-word" style="color:#fdf58c">מובילים </span>
              <span class="bright-word" style="color:#73e4ff">דור אחד קדימה, </span>
              <span style="color:#fb1881">בחדשנות, </span>
              <span style="color:#4ddfc2">סקרנות </span>
              <span class="bright-word" style="color:#fcaf3e">ויזמות טכנולוגית</span>
            </div>
          </div>`;
      }

      let items = '';

      logoOrder.forEach((id, index) => {
        if (index > 0) items += '<div class="c-logo-sep"></div>';
        items += logoItemHTML(id, 56, 10, 'c-logo-item');
      });

      return `<div class="c-logos">${items}</div>`;
    }

    function getColorVars() {
      const c1 = $('c1').value;
      const c2 = $('c2').value;
      const c3 = $('c3').value;

      return {
        c1,
        c2,
        c3,
        style: `--main-color:${c1};--accent-color:${c2};--course-color:${c3};`
      };
    }

    function buildCard() {
      const { c1, c2, c3 } = getColorVars();
      const type = $('ev-type').value;
      const school = $('school').value;
      const grade = $('grade').value;
      const year = $('year').value;
      const date = fmtDate($('ev-date').value);
      const time = $('ev-time').value;
      const location = $('ev-loc').value;
      const b1 = $('b1').value;
      const b2 = $('b2').value;
      const course = getCourseName();
      const closing = $('closing1').value || 'נשמח לראותכם!';
      const evLabel = type === 'end' ? 'למפגש הסיום' : type === 'lecture' ? 'להרצאת אורח' : 'לסיור לימודי';

      let opening = '';

      if (type === 'end') {
        opening = `<div class="c-opening">אנו שמחים להזמינכם למפגש הסיום של קורס <strong>${esc(getCourseOpeningText(course))}</strong>, שהתקיים בבית הספר במסגרת התוכניות החינוכיות של עמותת תעשיידע.</div>`;
      } else if (type === 'lecture') {
        const lecturer = $('lec-name')?.value || '';
        const topic = $('lec-topic')?.value || '';
        const org = $('lec-org')?.value || '';

        opening = `<div class="c-opening">אנו שמחים להזמינכם <strong>${evLabel}</strong>${lecturer ? ` עם <strong>${esc(lecturer)}</strong>` : ''}${topic ? ` | <strong>${esc(topic)}</strong>` : ''}${org ? ` — ${esc(org)}` : ''}</div>`;
      } else {
        const place = $('tour-place')?.value || '';
        const org = $('tour-org')?.value || '';

        opening = `<div class="c-opening">אנו שמחים להזמינכם <strong>${evLabel}</strong>${place ? ` ב<strong>${esc(place)}</strong>` : ''}${org ? ` | <strong>${esc(org)}</strong>` : ''}</div>`;
      }

      let participantsHTML = `<div class="c-part-title" style="color:${c2}">בהשתתפות:</div>`;

      parts.filter((participant) => participant.n || participant.r).forEach((participant) => {
        participantsHTML += `
          <div class="c-part-line">
            ${participant.t ? `${esc(participant.t)} ` : ''}
            <strong>${esc(participant.n)}</strong>
            ${participant.r ? `<span style="font-weight:400">, ${esc(participant.r)}</span>` : ''}
          </div>`;
      });

      return `
        ${logosBarHTML(false)}
        <div class="c-main">
          <div class="c-title" style="color:${c1}">הזמנה</div>
          <div class="c-sub-event" style="color:${c1}">${getHeaderEventText(type, evLabel)}</div>
          <div class="c-course" style="color:${c3}">${getCourseDisplayHTML(course)}</div>
          ${(school || grade) ? `<div class="c-school">כיתה <strong>${esc(grade || '____')}</strong> | בית ספר <strong>${esc(school || '______')}</strong> | <strong>${esc(year)}</strong></div>` : `<div class="c-year">${esc(year)}</div>`}
          <div class="c-divider"></div>
          ${opening}
          <div class="c-box c-details-box">
            <div class="c-details-top">
              ${date ? `<div class="c-info-row">⚙️ <strong>${date.day}</strong></div>` : ''}
              ${date ? `<div class="c-info-row">📅 <strong>${date.date}</strong></div>` : ''}
              ${time ? `<div class="c-info-row">⏰ <strong>${esc(time)}</strong></div>` : ''}
            </div>
            ${location ? `<div class="c-info-row c-details-location">📍 ${esc(location)}</div>` : ''}
          </div>
          ${b1 ? `<div class="c-para">${esc(b1)}</div>` : ''}
          ${b2 ? `<div class="c-section-title">מה מצפה לנו:</div><div class="c-para">${esc(b2)}</div>` : ''}
          <div class="c-box c-participants-box">${participantsHTML}</div>
          <div class="c-closing" style="color:${c3}">${esc(closing)}</div>
        </div>
        ${logosBarHTML(true)}`;
    }

    function up() {
      const courseCustom = $('course-custom');
      if (!courseCustom) return;

      courseCustom.style.display = $('course-sel').value === '__c' ? 'block' : 'none';

      const colorVars = getColorVars();
      $('card').setAttribute('style', colorVars.style);

      const bg = BG_URLS[selBg];
      const cardBg = $('cbg');

      if (bg.type === 'solid') {
        cardBg.style.backgroundImage = 'none';
        cardBg.style.backgroundColor = bg.value;
      } else {
        cardBg.style.backgroundColor = 'transparent';
        cardBg.style.backgroundImage = `url(${bg.value})`;
      }

      $('cwrap').innerHTML = buildCard();
      saveState();
    }

    function getPrintCSS(bg) {
      const bgStyle = bg.type === 'solid'
        ? `background-color:${bg.value};background-image:none`
        : `background-image:url(${bg.value})`;

      const baseStyle = document.getElementById('invitation-generator-styles')?.textContent || '';

      return `${baseStyle.replace('.invitation-screen-root .preview #card{zoom:.50}', '')}
body{font-family:'Heebo',sans-serif;background:#ccc;display:flex;flex-direction:column;align-items:center;padding:20px;direction:rtl}
@page{size:A5 portrait;margin:0}
@media print{html,body{width:148mm;height:210mm;margin:0;padding:0;overflow:hidden}body{background:none;display:flex;align-items:flex-start;justify-content:center}.np{display:none}#card{width:148mm;height:210mm;min-height:210mm;max-height:210mm;box-shadow:none!important;position:relative;left:50%;transform:translateX(-50%) scale(.99);transform-origin:top center;margin:0 auto}}
.np{margin-bottom:14px}
.np button{background:#1a8c6e;color:#fff;border:none;padding:9px 22px;border-radius:7px;font-family:'Heebo',sans-serif;font-size:14px;font-weight:700;cursor:pointer}
.cbg{${bgStyle}}`;
    }

    function doPrint() {
      const cardInner = buildCard();
      const colorVars = getColorVars();
      const pdfName = getPdfFileName();
      const printWindow = window.open('', '_blank', 'width=680,height=980');

      if (!printWindow) return;

      printWindow.document.write(`
<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>${esc(pdfName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${getPrintCSS(BG_URLS[selBg])}</style>
</head>
<body>
<div class="np"><button onclick="window.print()">PDF</button></div>
<div class="invitation-screen-root">
  <div id="card" style="${colorVars.style}">
    <div class="cbg"></div>
    <div class="cframe"></div>
    <div class="cwrap">${cardInner}</div>
  </div>
</div>
<script>window.onafterprint=function(){setTimeout(function(){window.close()},250)};</script>
</body>
</html>`);

      printWindow.document.close();
      printWindow.document.title = pdfName;
    }

    function doReset() {
      localStorage.removeItem(STORAGE_KEY);

      ['school', 'grade', 'ev-loc', 'b1', 'b2', 'course-custom'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
      });

      $('ev-date').value = '';
      $('ev-time').value = '';
      $('ev-type').value = 'end';
      $('course-sel').selectedIndex = 0;
      $('c1').value = '#1a3a5c';
      $('c2').value = '#1a8c6e';
      $('c3').value = '#1a8c6e';
      $('closing1').value = 'נשמח לראותכם!';

      parts = makeDefaultParts();
      selBg = 0;
      logoOrder = ['mohe', 'taas', 'school'];
      customLogos = {};
      savedFields = {};

      const schoolChip = $('school-chip-img');
      if (schoolChip) {
        schoolChip.src = '';
        schoolChip.style.display = 'none';
      }

      queryAll('#logo-zone .lchip[data-id]').forEach((chip) => {
        if (!['mohe', 'taas', 'school'].includes(chip.dataset.id)) chip.remove();
      });

      onTypeChange();
      initBg();
      renderParts();
      setupDrag();
      up();
    }

    function setupDrag() {
      queryAll('#logo-zone .lchip[draggable=true]').forEach((chip) => {
        chip.ondragstart = (event) => {
          event.dataTransfer.setData('lid', chip.dataset.id);
          chip.classList.add('ghost');
        };

        chip.ondragend = () => chip.classList.remove('ghost');
        chip.ondragover = (event) => event.preventDefault();

        chip.ondrop = (event) => {
          event.preventDefault();

          const from = event.dataTransfer.getData('lid');
          const to = chip.dataset.id;

          if (!from || from === to) return;

          const fromIndex = logoOrder.indexOf(from);
          const toIndex = logoOrder.indexOf(to);

          if (fromIndex > -1 && toIndex > -1) {
            logoOrder.splice(fromIndex, 1);
            logoOrder.splice(toIndex, 0, from);
          }

          const fromElement = host.querySelector(`[data-id="${from}"]`);
          const toElement = host.querySelector(`[data-id="${to}"]`);

          if (fromElement && toElement && fromElement.parentNode === toElement.parentNode) {
            if (fromIndex < toIndex) toElement.after(fromElement);
            else toElement.before(fromElement);
          }

          up();
        };
      });
    }

    function setupEvents() {
      [
        'course-custom',
        'c1',
        'c2',
        'c3',
        'school',
        'grade',
        'year',
        'ev-date',
        'ev-time',
        'ev-loc',
        'b1',
        'b2',
        'closing1'
      ].forEach((id) => {
        const el = $(id);
        if (!el) return;

        if (el.tagName === 'SELECT') el.onchange = up;
        else el.oninput = up;
      });

      $('course-sel').onchange = onCourseChange;
      $('ev-type').onchange = onTypeChange;
      $('suggest-b1').onclick = () => applySuggestedText('b1');
      $('suggest-b2').onclick = () => applySuggestedText('b2');
      $('suggest-parts').onclick = applySuggestedParticipants;
      $('add-part').onclick = addPart;
      $('print-btn').onclick = doPrint;
      $('reset-btn').onclick = doReset;

      $('school-logo-chip').onclick = () => {
        logoUploadTarget = 'school';
        $('logo-file').click();
      };

      $('logo-add').onclick = () => {
        logoUploadTarget = null;
        $('logo-file').click();
      };

      $('logo-file').onchange = function handleLogoUpload() {
        const file = this.files?.[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (event) => {
          const imageSrc = event.target?.result || '';

          if (logoUploadTarget === 'school') {
            customLogos.school = imageSrc;
            if (!logoOrder.includes('school')) logoOrder.push('school');

            const chipImage = $('school-chip-img');
            if (chipImage) {
              chipImage.src = imageSrc;
              chipImage.style.display = 'inline-block';
            }

            logoUploadTarget = null;
            setupDrag();
            up();
            return;
          }

          const id = `cu_${Date.now()}`;
          customLogos[id] = imageSrc;
          logoOrder.push(id);

          const chip = document.createElement('div');
          chip.className = 'lchip';
          chip.draggable = true;
          chip.dataset.id = id;
          chip.innerHTML = `<img src="${imageSrc}" style="height:14px"> <button style="background:none;border:none;cursor:pointer;font-size:12px;color:#999;padding:0">×</button>`;

          chip.querySelector('button').onclick = (eventClick) => {
            eventClick.stopPropagation();
            logoOrder = logoOrder.filter((item) => item !== id);
            delete customLogos[id];
            chip.remove();
            up();
          };

          $('logo-add').before(chip);
          setupDrag();
          up();
        };

        reader.readAsDataURL(file);
        this.value = '';
      };
    }

    function runTests() {
      console.assert(typeof onCourseChange === 'function', 'onCourseChange exists');
      console.assert(getCourseFileNameText('יזמות פרימיום – אסם').includes('אסם'), 'PDF filename keeps company');
      console.assert(SUGGESTED_TEXTS_BY_COURSE['רוקחים עולם'].b1.includes('פארמצבטיקה'), 'pharmacy suggestion exists');
      console.assert(getCourseDisplayHTML('יזמות פרימיום – מארוול').includes('בליווי חברה מאמצת: מארוול'), 'Marvel company line exists');
    }

    function boot() {
      setupEvents();
      restoreState();
      rebuildCustomLogoChips();
      initBg();
      renderParts();
      onTypeChange();
      applyFields(savedFields);
      setupDrag();
      up();
      runTests();

      const taasiyedaLogo = new Image();
      taasiyedaLogo.onload = () => {
        taasLogoLoaded = true;

        const chip = $('taas-chip-img');
        if (chip) {
          chip.src = LOGOS.taas;
          chip.style.display = 'inline-block';
        }

        up();
      };
      taasiyedaLogo.onerror = () => {
        taasLogoLoaded = false;
      };
      taasiyedaLogo.src = LOGOS.taas;

      const educationLogo = new Image();
      educationLogo.onload = () => {
        moheLogoLoaded = true;

        const chip = $('mohe-chip-img');
        if (chip) {
          chip.src = LOGOS.mohe;
          chip.style.display = 'inline-block';
        }

        up();
      };
      educationLogo.onerror = () => {
        moheLogoLoaded = false;
      };
      educationLogo.src = LOGOS.mohe;
    }

    boot();
  }
};
