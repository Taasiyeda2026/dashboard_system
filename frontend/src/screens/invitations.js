const STORAGE_KEY = 'taasiyeda_invitation_builder_state_v4';
const ASSET_BASE = './assets/invitations/';

const LOGOS = {
  mohe: `${ASSET_BASE}logos/education-logo.png`,
  taas: `${ASSET_BASE}logos/taasiyeda-logo.png`
};

const BG_URLS = [
  { type: 'solid', label: 'לבן', value: '#ffffff' },
  ...Array.from({ length: 14 }, (_, index) => index + 1).map((n) => ({
    type: 'image',
    label: `רקע ${n}`,
    value: `${ASSET_BASE}backgrounds/background-${n}.png`
  }))
];

const DEFAULT_INVITATION_COLORS = Object.freeze({
  c1: '#1a3a5c', // Primary heading
  c2: '#1a8c6e', // Section headings
  c3: '#1a8c6e'  // Course name and closing
});

const BREAKTHROUGH_COLORS = Object.freeze({
  c1: '#1f354d',
  c2: '#a40461',
  c3: '#5b0143'
});

const DEFAULT_PARTS = [
  { t: 'גב׳', n: 'יעל אביב', r: 'מנהלת תחום חינוך ופדגוגיה, תעשיידע' }
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
  'יזמות פרימיום': {
    b1: 'במהלך הקורס יצאו התלמידים למסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה.',
    b2: 'במפגש התלמידים יציגו את הרעיונות והמוצרים שפיתחו, ויספרו כיצד חשיבה יזמית, עבודת צוות וחדשנות הובילו אותם משלב הרעיון ועד לתוצר.'
  },
  default: {
    b1: 'לאורך התהליך השתתפו התלמידים במסע למידה חווייתי, שבו חקרו רעיונות, התנסו בכלים מעשיים וגילו כיצד ידע, יצירתיות וטכנולוגיה מתחברים ללמידה משמעותית.',
    b2: 'התלמידים יציגו את התוצרים והרעיונות שפיתחו, וישתפו בדרך שבה סקרנות, חשיבה יצירתית ועבודת צוות התחברו לחוויית למידה פעילה ומשמעותית.'
  }
};

// Keep the previous suggested text to migrate unchanged drafts safely.
const LEGACY_BREAKTHROUGH_END_B2 = "התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד. הזדמנות לחגוג את הדרך שעברו, את הכוחות שגילו בעצמן ואת האומץ לחלום בגדול ולסלול דרך משלהן.";

// Preserve the previous guest-lecture default only to refresh unchanged saved drafts.
const LEGACY_BREAKTHROUGH_LECTURE_B2 = "מפגש מעצים ומעורר השראה עם אישה פורצת דרך, שתשתף במסעה האישי, בחלומות שהפכה למציאות ובאתגרים שהתגברה עליהם. הזדמנות לתלמידות לגלות את הכוח הטמון בהן, להאמין בעצמן ולקבל השראה לחלום בגדול, לפרוץ גבולות ולהעז להגשים את שאיפותיהן.";

// Exact event-specific copy for the "פורצות דרך" course.
const BREAKTHROUGH_EVENT_TEXTS = {
  end: {
    opening: "הנכם מוזמנים למפגש הסיום של קורס \"פורצות דרך\", שהתקיים בבית הספר במסגרת התוכניות החינוכיות של תעשיידע.",
    b1: "במהלך הקורס יצאו התלמידות למסע מעצים ומעורר השראה, שבו הכירו נשים פורצות דרך מתחומים שונים, נחשפו לסיפורי הצלחה ולהתמודדות עם אתגרים וגילו כיצד אומץ, נחישות, יצירתיות ואמונה עצמית יכולים להוביל להישגים משמעותיים וליצירת שינוי.",
    b2: "התלמידות יציגו את התוצרים והתובנות שאספו לאורך הקורס, ישתפו בסיפורים שעוררו בהן השראה ויבטאו את החלומות והשאיפות שלהן לעתיד."
  },
  lecture: {
    opening: "קורס ״פורצות דרך״ משלב יזמות טכנולוגית והעצמה נשית ומעודד את התלמידות לחלום בגדול, לפתח רעיונות ולהאמין ביכולתן להוביל שינוי. דרך היכרות עם נשים שהעזו לפרוץ גבולות, הן מגלות כיצד אומץ, יצירתיות, נחישות ואמונה עצמית יכולים להפוך שאיפות להישגים משמעותיים ולפתוח דלתות לאפשרויות חדשות.",
    b1: '',
    b2: "מפגש מעצים ומעורר השראה עם אישה פורצת דרך, שתשתף במסעה האישי, בחלומות שהפכה למציאות ובאתגרים שהתגברה עליהם בדרך ותספר על ההחלטות, התובנות והרגעים המשמעותיים שעיצבו את דרכה."
  }
};

// Legacy recommendations are needed only to migrate saved browser drafts safely.
const LEGACY_PREMIUM_SUGGESTIONS = {
  'יזמות פרימיום – אסם': {
    b1: 'לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה, תוך דגש על איכות, בטיחות ואחריות בהשראת עולמות התוכן של אסם.',
    b2: 'התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו להבנה עמוקה של איכות ובטיחות כחלק מחוויית למידה משמעותית.'
  },
  'יזמות פרימיום – מארוול': {
    b1: 'לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה בהשראת עולמות התוכן של מארוול.',
    b2: 'התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו לחוויית למידה משמעותית.'
  },
};

function ensureStyles() {
  if (document.getElementById('invitation-generator-styles')) return;

  const style = document.createElement('style');
  style.id = 'invitation-generator-styles';
  style.textContent = `
.invitation-screen-root *{box-sizing:border-box;margin:0;padding:0}
.invitation-screen-root{font-family:'Assistant',sans-serif;direction:rtl;font-size:13px;background:#f0f2f4;color:#1a1a2e;height:100%;overflow:hidden}
.invitation-screen-root .app{display:grid;grid-template-columns:300px minmax(0,1fr);height:100dvh;overflow:hidden}
.invitation-screen-root .panel{background:#f7f8fa;border-left:1px solid #e0e3e8;overflow-y:scroll;max-height:100dvh;min-height:0;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.invitation-screen-root .field-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.invitation-screen-root .field-row.trio{grid-template-columns:1fr 1fr 1fr}
.invitation-screen-root select,.invitation-screen-root input[type=text],.invitation-screen-root input[type=date],.invitation-screen-root input[type=time],.invitation-screen-root textarea{width:100%;font-family:'Assistant',sans-serif;font-size:12px;direction:rtl;color:#1a1a2e;border:1px solid #d0d4dc;border-radius:5px;padding:4px 7px;background:#fff;outline:none}
.invitation-screen-root select:focus,.invitation-screen-root input:focus,.invitation-screen-root textarea:focus{border-color:#1a8c6e}
.invitation-screen-root textarea{resize:none;height:48px;font-size:11px}
.invitation-screen-root .lbl{font-size:10px;color:#888;margin-bottom:2px;display:block}
.invitation-screen-root .color-pair{display:flex;gap:6px;align-items:center}
.invitation-screen-root .color-pair label{font-size:11px;color:#666}
.invitation-screen-root .color-pair input[type=color]{width:26px;height:22px;border:1px solid #d0d4dc;border-radius:4px;padding:1px;cursor:pointer;background:none}
.invitation-screen-root .bg-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;align-items:start}
.invitation-screen-root .bg-th{width:100%;min-width:0;height:auto;border-radius:4px;border:2px solid transparent;cursor:pointer;background-size:cover;background-position:center;background-color:#dde;aspect-ratio:148/210}
.invitation-screen-root .bg-th.sel{border-color:#1a8c6e}
.invitation-screen-root .logo-row{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.invitation-screen-root .logo-row .lchip[data-id="lecturer-company"]{cursor:pointer}
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
.invitation-screen-root .btn-print{width:100%;padding:6px;border-radius:7px;font-family:'Assistant',sans-serif;font-size:12px;font-weight:700;cursor:pointer;background:#1a8c6e;color:#fff;border:none}
.invitation-screen-root .btn-print:hover{background:#157a5e}
.invitation-screen-root .btn-clr{width:100%;padding:6px;border-radius:7px;font-family:'Assistant',sans-serif;font-size:12px;cursor:pointer;background:none;border:1px solid #d0d4dc;color:#666;margin-top:4px}
.invitation-screen-root .btn-clr:hover{background:#eee}
.invitation-screen-root .action-row .btn-clr{margin-top:0}
.invitation-screen-root .suggest-btn{width:100%;margin-top:4px;padding:4px 6px;border-radius:6px;border:1px dashed #c4ccd6;background:#fff;color:#59616d;font-family:'Assistant',sans-serif;font-size:10.5px;cursor:pointer;text-align:center}
.invitation-screen-root .suggest-btn:hover{background:#eef6f3;border-color:#1a8c6e;color:#1a8c6e}
.invitation-screen-root .sep{height:1px;background:#e4e7ec}
.invitation-screen-root .preview{background:#d8dfe6;display:flex;flex-direction:column;align-items:center;padding:10px 8px;height:100dvh;min-height:0;overflow:auto}
.invitation-screen-root .preview-lbl{font-size:9px;color:#999;letter-spacing:.5px;margin-bottom:6px}
.invitation-screen-root .preview #card{zoom:.50}
.invitation-screen-root #card{width:148mm;min-height:210mm;position:relative;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.22);direction:rtl;font-family:'Assistant',sans-serif;display:flex;flex-direction:column}
.invitation-screen-root .cbg{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center}
.invitation-screen-root .cframe{position:absolute;inset:5mm;border-radius:10px;border:1.5px solid rgba(255,255,255,.55);pointer-events:none;z-index:3}
.invitation-screen-root .cwrap{position:relative;z-index:2;flex:1;display:flex;flex-direction:column}
.invitation-screen-root .c-logos{display:flex;align-items:center;justify-content:center;gap:1mm;padding:7mm 10mm 1mm;background:transparent;border-bottom:none}
.invitation-screen-root .c-logos--lecture{padding-left:5mm;padding-right:5mm}
.invitation-screen-root .c-logos--lecture .c-logo-item{width:30mm;min-width:0;flex:1 1 0}
.invitation-screen-root .c-logo-item{width:32mm;height:14mm;display:flex;align-items:center;justify-content:center;gap:4px;font-size:10px;font-weight:800;color:#1a3a5c;line-height:1.2}
.invitation-screen-root .c-logo-sep{width:1px;height:26px;background:rgba(26,58,92,.2);flex-shrink:0}
.invitation-screen-root .c-logo-item img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.invitation-screen-root .c-main{padding:1.5mm 6mm 2mm;flex:1;display:flex;flex-direction:column;align-items:center;text-align:center}
.invitation-screen-root .c-title{font-weight:900;line-height:1;margin-bottom:0;font-size:14mm}
.invitation-screen-root .c-title.guest-lecture{font-size:8.5mm;line-height:1.1;margin-bottom:1.2mm}
.invitation-screen-root .c-lecturer-identity{font-weight:700;line-height:1.2;text-align:center;white-space:nowrap;max-width:100%;margin:0 auto 1.4mm;direction:rtl}
.invitation-screen-root .c-sub-event{font-weight:700;line-height:1.05;margin-bottom:1mm;font-size:9mm}
.invitation-screen-root .c-course{font-weight:500;line-height:1.08;margin-bottom:1mm;font-size:7mm}
.invitation-screen-root .c-course .course-main{display:block;font-size:7mm;line-height:1.05;font-weight:500}
.invitation-screen-root .c-course .course-sub{display:block;font-size:6mm;line-height:1.05;font-weight:500}
.invitation-screen-root .c-course .course-company{display:block;font-size:3.8mm;line-height:1.1;font-weight:500;margin-top:.8mm}
.invitation-screen-root .c-year{font-size:4.8mm;font-weight:700;margin-bottom:2mm}
.invitation-screen-root .c-school{font-size:4mm;color:#333;margin:1.5mm 0}
.invitation-screen-root .c-school strong{font-weight:700}
.invitation-screen-root .c-divider{width:100%;height:1px;background:rgba(26,58,92,.1);margin:1.5mm 0}
.invitation-screen-root .c-opening{font-size:3.95mm;color:#333;line-height:1.35;margin:1mm auto;max-width:none;width:70%;text-align:center;align-self:center;margin-inline:auto;padding-inline:5mm;box-sizing:border-box}
.invitation-screen-root .c-opening strong{font-weight:700;color:var(--accent-color,#1a8c6e)}
.invitation-screen-root .c-para{font-size:3.95mm;color:#333;line-height:1.35;margin:.5mm auto;text-align:right;max-width:none;width:70%;align-self:center;margin-inline:auto;padding-inline:5mm;box-sizing:border-box}
.invitation-screen-root .c-section-title{font-size:3.95mm;font-weight:800;color:var(--accent-color,#1a8c6e);line-height:1.35;margin:1mm auto .4mm;max-width:none;width:70%;text-align:right;align-self:center;margin-inline:auto;padding-inline:5mm;box-sizing:border-box}
.invitation-screen-root .c-box{background:rgba(255,255,255,.5);border:1px solid rgba(26,140,110,.22);border-radius:8px;padding:1.3mm 3.5mm;margin:1mm 0;width:100%;text-align:right}
.invitation-screen-root .c-participants-box{width:60%;max-width:none;margin-left:auto;margin-right:auto;align-self:center;background:rgba(255,255,255,.38);border-color:rgba(26,140,110,.12);padding:1.2mm 5.15mm}
.invitation-screen-root .c-details-box{width:60%;max-width:none;margin-left:auto;margin-right:auto;align-self:center;display:flex;flex-direction:column;align-items:center;gap:.7mm;background:transparent;border-color:rgba(26,140,110,.18);text-align:center;padding:1.2mm 3mm}
.invitation-screen-root .c-details-top{display:flex;align-items:center;justify-content:center;gap:4mm;width:100%;flex-wrap:wrap}
.invitation-screen-root .c-details-location{justify-content:center;text-align:center;width:100%;font-size:4.4mm;line-height:1.5}
.invitation-screen-root .c-details-box .c-info-row{justify-content:center;text-align:center}
.invitation-screen-root .c-info-row{display:flex;align-items:center;gap:4px;font-size:4mm;color:#333;line-height:1.35}
.invitation-screen-root .c-info-row strong{font-weight:700}
.invitation-screen-root .c-part-title{font-size:2.9mm;font-weight:700;margin-bottom:1px;line-height:1.35}
.invitation-screen-root .c-part-line{font-size:2.9mm;color:#333;line-height:1.35;margin-bottom:.45mm}
.invitation-screen-root .c-part-line:last-child{margin-bottom:0}
.invitation-screen-root .c-part-line strong{font-size:2.9mm;font-weight:700;color:#333}
.invitation-screen-root .c-part-line span{font-size:2.9mm;font-weight:400}
.invitation-screen-root .c-closing{font-size:5.2mm;font-weight:900;margin-top:1.4mm;padding-top:.6mm;text-align:center;line-height:1.05}
.invitation-screen-root .c-footer{position:absolute;bottom:5.2mm;left:50%;transform:translateX(-50%);z-index:5;width:auto;max-width:88%;background:#fff;border:.35mm solid rgba(26,58,92,.18);border-radius:6mm;padding:.9mm 4mm;min-height:0;pointer-events:none;box-shadow:0 .6mm 2mm rgba(0,0,0,.06)}
.invitation-screen-root .c-footer-sentence{font-size:2.1mm;line-height:1.15;font-weight:600;letter-spacing:0;text-shadow:none;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:1.2mm;white-space:normal}
/* A5 guest lecture — preserve the approved content and background. */
.invitation-screen-root .preview #card.layout-breakthrough-lecture{zoom:.60}
.invitation-screen-root #card.layout-breakthrough-lecture .c-logos--lecture{padding:7mm 9mm 2mm;gap:1.4mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-logos--lecture .c-logo-item{flex:0 1 30mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-logo-item{height:13mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-logo-item img{filter:drop-shadow(0 .3mm .8mm rgba(255,255,255,.75))}
.invitation-screen-root #card.layout-breakthrough-lecture .c-logo-sep{height:9mm;background:rgba(31,53,77,.15)}
.invitation-screen-root #card.layout-breakthrough-lecture .c-main{padding:2mm 6.5mm 16mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-title.guest-lecture{font-size:8.7mm;margin-bottom:2.1mm;line-height:1.12}
.invitation-screen-root #card.layout-breakthrough-lecture .c-lecturer-identity{font-weight:800;margin-bottom:1.6mm;max-width:98%;line-height:1.25}
.invitation-screen-root #card.layout-breakthrough-lecture .c-course,.invitation-screen-root #card.layout-breakthrough-lecture .c-course .course-main{font-size:6mm;font-weight:650;line-height:1.18}
.invitation-screen-root #card.layout-breakthrough-lecture .c-school,.invitation-screen-root #card.layout-breakthrough-lecture .c-year{margin:1mm 0;font-size:4.2mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-divider{width:78%;margin:0 auto 1mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-opening{width:84%;padding-inline:2mm;text-align:center;font-size:4.3mm;line-height:1.4;margin:0 auto}
.invitation-screen-root #card.layout-breakthrough-lecture .c-details-box{width:82%;padding:2.1mm 3mm;gap:1.4mm;border-color:rgba(31,53,77,.2);background:rgba(255,255,255,.65);margin:0 auto}
.invitation-screen-root #card.layout-breakthrough-lecture .c-details-top{gap:2mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-detail-separator{color:rgba(31,53,77,.48);padding:0 .5mm;font-weight:400}
.invitation-screen-root #card.layout-breakthrough-lecture .c-info-row{font-size:4.2mm;line-height:1.4;gap:3px}
.invitation-screen-root #card.layout-breakthrough-lecture .c-details-location{font-size:4.2mm;line-height:1.35}
.invitation-screen-root #card.layout-breakthrough-lecture .c-section-title{width:84%;padding-inline:2mm;font-size:4.4mm;line-height:1.25;margin:0 auto .9mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-para{width:84%;padding-inline:2mm;font-size:4.3mm;line-height:1.4;margin:0 auto}
.invitation-screen-root #card.layout-breakthrough-lecture .c-participants-box{width:69%;padding:2mm 5.2mm;margin:0 auto;border-color:rgba(31,53,77,.14)}
.invitation-screen-root #card.layout-breakthrough-lecture .c-part-title,.invitation-screen-root #card.layout-breakthrough-lecture .c-part-line,.invitation-screen-root #card.layout-breakthrough-lecture .c-part-line strong,.invitation-screen-root #card.layout-breakthrough-lecture .c-part-line span{font-size:3.3mm;line-height:1.32}
.invitation-screen-root #card.layout-breakthrough-lecture .c-closing{font-size:5.4mm;margin:0 auto 1mm;padding-top:0}
.invitation-screen-root #card.layout-breakthrough-lecture .c-footer{bottom:4.8mm;max-width:94%;padding:1.1mm 3.6mm}
.invitation-screen-root #card.layout-breakthrough-lecture .c-footer-sentence{font-size:2.7mm;line-height:1.22;font-weight:800;gap:.8mm;text-shadow:0 .12mm .14mm rgba(0,0,0,.19)}
.invitation-screen-root #card.layout-breakthrough-lecture .c-divider{margin-top:auto}
.invitation-screen-root #card.layout-breakthrough-lecture .c-details-box,.invitation-screen-root #card.layout-breakthrough-lecture .c-section-title,.invitation-screen-root #card.layout-breakthrough-lecture .c-participants-box,.invitation-screen-root #card.layout-breakthrough-lecture .c-closing{margin-top:auto}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-main{padding:1mm 6mm 14mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-title.guest-lecture{font-size:7.5mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-opening,.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-para{width:87%;font-size:3.7mm;line-height:1.3}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-section-title{font-size:4mm;width:87%}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-details-box{width:85%;padding:1.5mm 3mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-info-row{font-size:3.85mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-compact .c-participants-box{width:75%;padding:1.5mm 4mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-main{padding:1mm 5.5mm 13mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-logos--lecture{padding-top:5mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-logo-item{height:11mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-title.guest-lecture{font-size:6.8mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-opening,.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-para{width:90%;padding-inline:1mm;font-size:3.4mm;line-height:1.24}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-section-title{width:90%;padding-inline:1mm;font-size:3.5mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-details-box{width:88%;padding:1mm 2mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-info-row{font-size:3.65mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-participants-box{width:78%;padding:1mm 3.5mm}
.invitation-screen-root #card.layout-breakthrough-lecture.fit-a5-tight .c-footer-sentence{font-size:2.4mm}

.invitation-screen-root #card.fit-a5-compact .c-title{font-size:9.5mm}
.invitation-screen-root #card.fit-a5-compact .c-title.guest-lecture{font-size:7mm}
.invitation-screen-root #card.fit-a5-compact .c-sub-event{font-size:5mm}
.invitation-screen-root #card.fit-a5-compact .c-course,.invitation-screen-root #card.fit-a5-compact .c-course .course-main{font-size:5.4mm}
.invitation-screen-root #card.fit-a5-compact .c-course .course-sub{font-size:4.7mm}
.invitation-screen-root #card.fit-a5-compact .c-course .course-company{font-size:3.5mm}
.invitation-screen-root #card.fit-a5-compact .c-opening,.invitation-screen-root #card.fit-a5-compact .c-para{font-size:3.25mm;line-height:1.18}
.invitation-screen-root #card.fit-a5-compact .c-main{padding:1mm 5.5mm 1.5mm}
.invitation-screen-root #card.fit-a5-compact .c-box{padding:1mm 3mm;margin:.7mm 0}
.invitation-screen-root #card.fit-a5-compact .c-info-row{font-size:3.75mm;line-height:1.25}
.invitation-screen-root #card.fit-a5-compact .c-part-title,.invitation-screen-root #card.fit-a5-compact .c-part-line{font-size:2.75mm;line-height:1.22}
.invitation-screen-root #card.fit-a5-compact .c-closing{font-size:4.7mm}
.invitation-screen-root #card.fit-a5-tight .c-title{font-size:8.8mm}
.invitation-screen-root #card.fit-a5-tight .c-title.guest-lecture{font-size:6.4mm}
.invitation-screen-root #card.fit-a5-tight .c-sub-event{font-size:4.6mm}
.invitation-screen-root #card.fit-a5-tight .c-course,.invitation-screen-root #card.fit-a5-tight .c-course .course-main{font-size:5mm}
.invitation-screen-root #card.fit-a5-tight .c-course .course-sub{font-size:4.4mm}
.invitation-screen-root #card.fit-a5-tight .c-course .course-company{font-size:3.2mm}
.invitation-screen-root #card.fit-a5-tight .c-opening,.invitation-screen-root #card.fit-a5-tight .c-para{font-size:3mm;line-height:1.14;width:86%}
.invitation-screen-root #card.fit-a5-tight .c-section-title{font-size:2.9mm;margin:.7mm auto .3mm}
.invitation-screen-root #card.fit-a5-tight .c-info-row{font-size:3.5mm;line-height:1.22}
.invitation-screen-root #card.fit-a5-tight .c-part-title,.invitation-screen-root #card.fit-a5-tight .c-part-line{font-size:2.65mm;line-height:1.18}
.invitation-screen-root #card.fit-a5-tight .c-closing{font-size:4.2mm;padding-top:.5mm}
.invitation-screen-root #card.fit-a5-tight .c-logos{padding:5mm 8mm .5mm}
.invitation-screen-root #card.fit-a5-tight .c-logo-item{width:28mm;height:11mm}

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
        <span class="lbl" id="logo-caption">לוגואים — גרור לסדר</span>
        <div class="logo-row" id="logo-zone">
          <div class="lchip" draggable="true" data-id="mohe"><img id="mohe-chip-img" src="" style="height:16px;display:none"> משרד החינוך</div>
          <div class="lchip" draggable="true" data-id="taas"><img id="taas-chip-img" src="" style="height:16px;display:none"> תעשיידע</div>
          <div class="lchip lchip-placeholder" draggable="true" data-id="school" id="school-logo-chip"><img id="school-chip-img" src="" style="height:16px;display:none"> לוגו בית ספר</div>
          <div class="lchip lchip-placeholder" draggable="false" data-id="lecturer-company" id="lecturer-company-logo-chip" style="display:none"><img id="lecturer-company-chip-img" src="" style="height:16px;display:none"> לוגו חברת המרצה</div>
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
            <option value="יזמות פרימיום">יזמות פרימיום</option>
            <option value="פורצות דרך">פורצות דרך</option>
            <option value="__c">אחר...</option>
          </select>
        </div>
      </div>

      <input type="text" id="course-custom" placeholder="שם קורס" style="display:none">
      <div id="premium-company-row" style="display:none">
        <span class="lbl">שם החברה המאמצת</span>
        <input type="text" id="premium-company" placeholder="לדוגמה: אסם" autocomplete="off">
      </div>

      <div class="field-row trio">
        <div class="color-pair"><input type="color" id="c1" value="#1a3a5c"><label>כותרת ראשית</label></div>
        <div class="color-pair"><input type="color" id="c2" value="#1a8c6e"><label>כותרות</label></div>
        <div class="color-pair"><input type="color" id="c3" value="#1a8c6e"><label>שם קורס / סיום</label></div>
      </div>

      <div class="sep"></div>

      <div class="field-row trio">
        <div><span class="lbl">בית ספר</span><input type="text" id="school" placeholder='ע"ש הרצל'></div>
        <div><span class="lbl">כיתה</span><input type="text" id="grade" placeholder="ז׳2"></div>
        <div><span class="lbl">שנה</span><select id="year"><option value="תשפ״ז">תשפ״ז</option></select></div>
      </div>

      <div class="field-row">
        <div><span class="lbl">📅 תאריך</span><input type="date" id="ev-date"></div>
        <div><span class="lbl">⏰ שעה</span><input type="time" id="ev-time"></div>
      </div>

      <div><span class="lbl">📍 מיקום</span><input type="text" id="ev-loc"></div>
      <div id="extra"></div>

      <div class="sep"></div>

      <div id="b1-editor">
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

    function getPremiumCompany() {
      return getCourseName() === 'יזמות פרימיום' ? ($('premium-company')?.value || '').trim() : '';
    }

    function getSuggestedSetForCurrentCourse() {
      if (getCourseName() === 'פורצות דרך') {
        return BREAKTHROUGH_EVENT_TEXTS[$('ev-type').value] || SUGGESTED_TEXTS_BY_COURSE.default;
      }
      return SUGGESTED_TEXTS_BY_COURSE[getCourseName()] || SUGGESTED_TEXTS_BY_COURSE.default;
    }

    function isKnownSuggestedText(value) {
      const clean = (value || '').trim();
      if (!clean || clean === LEGACY_BREAKTHROUGH_END_B2 || clean === LEGACY_BREAKTHROUGH_LECTURE_B2) return true;

      return [SUGGESTED_TEXTS_BY_COURSE, LEGACY_PREMIUM_SUGGESTIONS, BREAKTHROUGH_EVENT_TEXTS].some((library) =>
        Object.values(library).some((set) =>
          Object.values(set).some((text) => (text || '').trim() === clean)
        )
      );
    }

    function refreshSuggestedTextsForCourse() {
      const set = getSuggestedSetForCurrentCourse();

      ['b1', 'b2'].forEach((id) => {
        const el = $(id);
        if (!el || !Object.prototype.hasOwnProperty.call(set, id)) return;
        if (isKnownSuggestedText(el.value)) el.value = set[id];
      });
    }

    function readColors() {
      return {
        c1: $('c1').value,
        c2: $('c2').value,
        c3: $('c3').value
      };
    }

    function colorsMatch(colors, palette) {
      return ['c1', 'c2', 'c3'].every((key) => (colors[key] || '').toLowerCase() === palette[key]);
    }

    function applyColorPalette(palette) {
      ['c1', 'c2', 'c3'].forEach((id) => {
        $(id).value = palette[id];
      });
    }

    function onCourseChange() {
      const colors = readColors();
      if (getCourseName() === 'פורצות דרך') {
        applyColorPalette(BREAKTHROUGH_COLORS);
      } else if (colorsMatch(colors, BREAKTHROUGH_COLORS)) {
        // Only replace the course preset, never manually adjusted colors.
        applyColorPalette(DEFAULT_INVITATION_COLORS);
      }
      refreshSuggestedTextsForCourse();
      up();
    }

    function applySuggestedText(id) {
      const set = getSuggestedSetForCurrentCourse();
      const el = $(id);
      if (!el || !Object.prototype.hasOwnProperty.call(set, id)) return;

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
        'premium-company',
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
        'lec-role',
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
        if (el && id !== 'year') el.value = value;
      });
      $('year').value = 'תשפ״ז';
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

        savedFields = { ...(state.fields || {}) };
        const legacyCompany = {
          'יזמות פרימיום – אסם': 'אסם',
          'יזמות פרימיום – מארוול': 'מארוול'
        }[savedFields['course-sel']];
        if (legacyCompany) {
          savedFields['course-sel'] = 'יזמות פרימיום';
          savedFields['premium-company'] = savedFields['premium-company'] || legacyCompany;
          ['b1', 'b2'].forEach((id) => {
            if (isKnownSuggestedText(savedFields[id])) {
              savedFields[id] = SUGGESTED_TEXTS_BY_COURSE['יזמות פרימיום'][id];
            }
          });
        }
        savedFields.year = 'תשפ״ז';
        if (savedFields['course-sel'] === 'פורצות דרך') {
          if (savedFields.b2 === LEGACY_BREAKTHROUGH_END_B2) {
            savedFields.b2 = BREAKTHROUGH_EVENT_TEXTS.end.b2;
          }
          if (savedFields['ev-type'] === 'lecture' && savedFields.b2 === LEGACY_BREAKTHROUGH_LECTURE_B2) {
            savedFields.b2 = BREAKTHROUGH_EVENT_TEXTS.lecture.b2;
          }
          const savedColors = ['c1', 'c2', 'c3'].reduce((result, key) => {
            result[key] = savedFields[key] || DEFAULT_INVITATION_COLORS[key];
            return result;
          }, {});
          // An existing draft still using the generic defaults should receive
          // the new course defaults. Never override user-selected colors.
          if (colorsMatch(savedColors, DEFAULT_INVITATION_COLORS)) {
            Object.assign(savedFields, BREAKTHROUGH_COLORS);
          }
        }
        applyFields(savedFields);

        if (Array.isArray(state.parts)) {
          parts = state.parts.filter((participant) => (participant?.n || '').trim() !== 'הילה רוזן');
        }
        if (typeof state.selBg === 'number') selBg = Math.min(Math.max(state.selBg, 0), BG_URLS.length - 1);
        if (Array.isArray(state.logoOrder)) logoOrder = state.logoOrder.filter((id) => id !== 'lecturer-company');
        if (state.customLogos && typeof state.customLogos === 'object') customLogos = state.customLogos;

        isRestoring = false;
      } catch (error) {
        console.warn('Could not restore invitation builder state', error);
        isRestoring = false;
      }
    }

    function rebuildCustomLogoChips() {
      Object.entries(customLogos).forEach(([id, src]) => {
        if (id === 'school' || id === 'lecturer-company' || host.querySelector(`[data-id="${id}"]`)) return;

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
      const lecturerCompanyChipImg = $('lecturer-company-chip-img');
      if (customLogos['lecturer-company'] && lecturerCompanyChipImg) {
        lecturerCompanyChipImg.src = customLogos['lecturer-company'];
        lecturerCompanyChipImg.style.display = 'inline-block';
      }
    }

    function syncLogoChipsForEvent() {
      const isLecture = $('ev-type').value === 'lecture';
      const zone = $('logo-zone');
      const addButton = $('logo-add');
      const requiredLogoIds = ['mohe', 'taas', 'school'];
      const visibleLogoIds = isLecture
        ? [...requiredLogoIds, 'lecturer-company']
        : logoOrder.filter((id) => id !== 'lecturer-company');

      $('lecturer-company-logo-chip').style.display = isLecture ? '' : 'none';
      addButton.style.display = isLecture ? 'none' : '';
      $('logo-caption').textContent = isLecture
        ? 'לוגואים — משרד החינוך, תעשיידע, בית הספר וחברת המרצה'
        : 'לוגואים — גרור לסדר';

      zone.querySelectorAll('.lchip[data-id]').forEach((chip) => {
        const id = chip.dataset.id;
        if (id === 'lecturer-company') return;
        chip.style.display = isLecture && !requiredLogoIds.includes(id) ? 'none' : '';
        chip.draggable = !isLecture;
        chip.style.cursor = isLecture ? (id === 'school' ? 'pointer' : 'default') : 'grab';
      });

      visibleLogoIds.forEach((id) => {
        const chip = zone.querySelector(`[data-id="${id}"]`);
        if (chip) zone.insertBefore(chip, addButton);
      });
      // Keep the inactive fourth chip out of the normal three-logo layout.
      if (!isLecture) zone.insertBefore($('lecturer-company-logo-chip'), addButton);
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
      if (course === 'פורצות דרך') {
        if ($('ev-type').value === 'lecture') {
          return '<span class="course-main">במסגרת קורס ״פורצות דרך״</span>';
        }
        return '<span class="course-main">של קורס &quot;פורצות דרך&quot;</span>';
      }
      if (course === 'יזמות פרימיום') {
        const company = getPremiumCompany();
        return `<span class="course-main">של קורס יזמות פרימיום</span>${company ? `<span class="course-company">בליווי ${esc(company)}</span>` : ''}`;
      }

      const courseParts = getCourseParts(course);
      return `<span class="course-main">של קורס ${esc(courseParts.name)}</span>${courseParts.subtitle ? `<span class="course-sub">${esc(courseParts.subtitle)}</span>` : ''}`;
    }

    function getHeaderEventText(type, evLabel) {
      return type === 'end' ? 'למפגש הסיום' : evLabel;
    }

    function getCourseOpeningText(course) {
      return course;
    }

    function getCourseFileNameText(course) {
      if (course === 'ביומימיקרי – המצאות בהשראת הטבע') return 'ביומימיקרי';
      if (course === 'יזמות פרימיום') return ['יזמות פרימיום', getPremiumCompany()].filter(Boolean).join(' ');

      return (course || 'קורס').replace(/קורס\s*/g, '').trim() || 'קורס';
    }

    function getEventFileNameText(type) {
      if (type === 'end') return 'מפגש סיום';
      if (type === 'lecture') return getCourseName() === 'פורצות דרך' ? 'הרצאת אורחת' : 'הרצאת אורח';
      if (type === 'tour') return 'סיור לימודי';
      return 'אירוע';
    }

    function getPdfFileName() {
      return `הזמנה - ${getEventFileNameText($('ev-type').value)} ${getCourseFileNameText(getCourseName())}`;
    }

    function onTypeChange() {
      const type = $('ev-type').value;
      const extra = $('extra');

      // Preserve previously entered event details without restoring the old event type.
      extra.querySelectorAll('input').forEach((input) => {
        savedFields[input.id] = input.value;
      });
      extra.innerHTML = '';

      if (type === 'lecture') {
        extra.innerHTML = `
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">שם המרצה</span><input type="text" id="lec-name"></div>
            <div><span class="lbl">תפקיד</span><input type="text" id="lec-role"></div>
          </div>
          <div style="margin-top:4px"><span class="lbl">חברה</span><input type="text" id="lec-org"></div>`;
      } else if (type === 'tour') {
        extra.innerHTML = `
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">מקום הסיור</span><input type="text" id="tour-place"></div>
            <div><span class="lbl">חברה מארחת</span><input type="text" id="tour-org"></div>
          </div>`;
      }

      extra.querySelectorAll('input').forEach((input) => {
        if (Object.prototype.hasOwnProperty.call(savedFields, input.id)) {
          input.value = savedFields[input.id];
        }
        input.oninput = up;
      });

      if (getCourseName() === 'פורצות דרך') refreshSuggestedTextsForCourse();
      syncLogoChipsForEvent();
      setupDrag();
      up();
    }

    function logoItemHTML(id, size, textSize, className) {
      if (id === 'lecturer-company') {
        if (customLogos['lecturer-company']) {
          return `<div class="${className}"><img src="${customLogos['lecturer-company']}"></div>`;
        }
        // Empty slots remain available for upload in the editor, not on the invitation.
        return '';
      }
      if (id === 'school') {
        if (customLogos.school) return `<div class="${className}"><img src="${customLogos.school}"></div>`;

        return '';
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

      const isLecture = $('ev-type').value === 'lecture';
      const activeLogoOrder = isLecture
        ? ['mohe', 'taas', 'school', 'lecturer-company']
        : logoOrder.filter((id) => id !== 'lecturer-company');
      const items = activeLogoOrder
        .map((id) => logoItemHTML(id, 56, 10, 'c-logo-item'))
        .filter(Boolean)
        .join('<div class="c-logo-sep"></div>');

      return `<div class="c-logos${isLecture ? ' c-logos--lecture' : ''}">${items}</div>`;
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
      const premiumCompany = getPremiumCompany();
      const closing = $('closing1').value || 'נשמח לראותכם!';
      const evLabel = type === 'end' ? 'למפגש הסיום' : type === 'lecture' ? 'להרצאת אורח' : 'לסיור לימודי';
      const breakthroughCopy = course === 'פורצות דרך' ? BREAKTHROUGH_EVENT_TEXTS[type] : null;
      const breakthroughLecture = course === 'פורצות דרך' && type === 'lecture';
      const isLecture = type === 'lecture';
      const lecturerName = ($('lec-name')?.value || '').trim();
      const lecturerRole = ($('lec-role')?.value || '').trim();
      const lecturerCompany = ($('lec-org')?.value || '').trim();
      const lecturerIdentity = [
        [lecturerName, lecturerRole].filter(Boolean).join(', '),
        lecturerCompany
      ].filter(Boolean).join(' - ');
      const lecturerFontSize = lecturerIdentity.length > 90 ? 3
        : lecturerIdentity.length > 65 ? 3.5
        : lecturerIdentity.length > 45 ? 4.3 : 5.2;

      let opening = '';

      if (breakthroughCopy) {
        opening = `<div class="c-opening">${esc(breakthroughCopy.opening)}</div>`;
      } else if (type === 'end') {
        opening = `<div class="c-opening">אנו שמחים להזמינכם למפגש הסיום של קורס <strong>${esc(getCourseOpeningText(course))}</strong>${premiumCompany ? ` בשיתוף <strong>${esc(premiumCompany)}</strong>` : ''}, שהתקיים בבית הספר במסגרת התוכניות החינוכיות של תעשיידע.</div>`;
      } else if (type === 'lecture') {
        opening = `<div class="c-opening">אנו שמחים להזמינכם <strong>${evLabel}</strong></div>`;
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
          <div class="c-title${isLecture ? ' guest-lecture' : ''}" style="color:${c1}">${isLecture ? (breakthroughLecture ? 'הזמנה להרצאת אורחת של:' : 'הזמנה להרצאת אורח של:') : 'הזמנה'}</div>
          ${isLecture && lecturerIdentity ? `<div class="c-lecturer-identity" style="color:${c1};font-size:${lecturerFontSize}mm">${esc(lecturerIdentity)}</div>` : ''}
          ${isLecture ? '' : `<div class="c-sub-event" style="color:${c1}">${getHeaderEventText(type, evLabel)}</div>`}
          <div class="c-course" style="color:${c3}">${getCourseDisplayHTML(course)}</div>
          ${(school || grade) ? `<div class="c-school">כיתה <strong>${esc(grade || '____')}</strong> | בית ספר <strong>${esc(school || '______')}</strong> | <strong>${esc(year)}</strong></div>` : `<div class="c-year">${esc(year)}</div>`}
          <div class="c-divider"></div>
          ${opening}
          <div class="c-box c-details-box">
            <div class="c-details-top">
              ${date ? (breakthroughLecture
                ? `<div class="c-info-row">📅 <strong>${date.day}</strong><span class="c-detail-separator">·</span><strong>${date.date}</strong></div>`
                : `<div class="c-info-row">🗓️ <strong>${date.day}</strong></div><div class="c-info-row">📅 <strong>${date.date}</strong></div>`) : ''}
              ${time ? `<div class="c-info-row">${breakthroughLecture ? 'שעה ' : '⏰ '}<strong>${esc(time)}</strong></div>` : ''}
            </div>
            ${location ? `<div class="c-info-row c-details-location">📍 ${esc(location)}</div>` : ''}
          </div>
          ${b1 && !breakthroughLecture ? `<div class="c-para">${esc(b1)}</div>` : ''}
          ${b2 ? `<div class="c-section-title">${course === 'פורצות דרך' ? 'מה מצפה לנו?' : 'מה מצפה לנו:'}</div><div class="c-para">${esc(b2)}</div>` : ''}
          <div class="c-box c-participants-box">${participantsHTML}</div>
          <div class="c-closing" style="color:${c3}">${esc(closing)}</div>
        </div>
        ${logosBarHTML(true)}`;
    }

    function up() {
      const courseCustom = $('course-custom');
      if (!courseCustom) return;

      courseCustom.style.display = $('course-sel').value === '__c' ? 'block' : 'none';
      $('b1-editor').style.display = getCourseName() === 'פורצות דרך' && $('ev-type').value === 'lecture' ? 'none' : 'block';
      $('premium-company-row').style.display = $('course-sel').value === 'יזמות פרימיום' ? 'block' : 'none';

      const colorVars = getColorVars();
      $('card').setAttribute('style', colorVars.style);
      $('card').classList.toggle('layout-breakthrough-lecture', getCourseName() === 'פורצות דרך' && $('ev-type').value === 'lecture');

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
      requestAnimationFrame(() => fitInvitationToA5($('card')));
      saveState();
    }

    function fitInvitationToA5(card) {
      if (!card) return Promise.resolve();
      const cwrap = card.querySelector('.cwrap');
      if (!cwrap) return Promise.resolve();

      card.classList.remove('fit-a5-compact', 'fit-a5-tight');

      const overflow = () => cwrap.scrollHeight > card.clientHeight;
      if (!overflow()) return Promise.resolve();

      card.classList.add('fit-a5-compact');

      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          if (!overflow()) {
            resolve();
            return;
          }

          card.classList.add('fit-a5-tight');
          requestAnimationFrame(() => {
            if (overflow()) {
              console.warn('[invitations] A5 content still overflows after tight fit', {
                cardHeight: card.clientHeight,
                contentHeight: cwrap.scrollHeight
              });
            }
            resolve();
          });
        });
      });
    }

    function getPrintCSS(bg) {
      const bgStyle = bg.type === 'solid'
        ? `background-color:${bg.value};background-image:none`
        : `background-image:url(${bg.value})`;

      const baseStyle = document.getElementById('invitation-generator-styles')?.textContent || '';

      return `${baseStyle.replace('.invitation-screen-root .preview #card{zoom:.50}', '')}
body{font-family:'Assistant',sans-serif;background:#ccc;display:flex;flex-direction:column;align-items:center;padding:20px;direction:rtl}
@page{size:A5 portrait;margin:0}
@media print{html,body{width:148mm;height:210mm;margin:0;padding:0;overflow:hidden}body{background:none;display:flex;align-items:flex-start;justify-content:center}.np{display:none}#card{width:148mm;height:210mm;min-height:210mm;max-height:210mm;overflow:hidden;box-shadow:none!important;position:relative;margin:0 auto;transform:none}}
.np{margin-bottom:14px}
.np button{background:#1a8c6e;color:#fff;border:none;padding:9px 22px;border-radius:7px;font-family:'Assistant',sans-serif;font-size:14px;font-weight:700;cursor:pointer}
.cbg{${bgStyle}}`;
    }

    function doPrint() {
      const cardInner = buildCard();
      const colorVars = getColorVars();
      const isBreakthroughLecture = getCourseName() === 'פורצות דרך' && $('ev-type').value === 'lecture';
      const pdfName = getPdfFileName();
      const printWindow = window.open('', '_blank', 'width=680,height=980');

      if (!printWindow) return;

      printWindow.document.write(`
<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>${esc(pdfName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${getPrintCSS(BG_URLS[selBg])}</style>
</head>
<body>
<div class="np"><button onclick="window.print()">PDF</button></div>
<div class="invitation-screen-root">
  <div id="card"${isBreakthroughLecture ? ' class="layout-breakthrough-lecture"' : ''} style="${colorVars.style}">
    <div class="cbg"></div>
    <div class="cframe"></div>
    <div class="cwrap">${cardInner}</div>
  </div>
</div>
<script>
function fitInvitationToA5(card){
  if(!card) return Promise.resolve();
  var cwrap=card.querySelector('.cwrap');
  if(!cwrap) return Promise.resolve();
  card.classList.remove('fit-a5-compact','fit-a5-tight');
  function overflow(){return cwrap.scrollHeight>card.clientHeight}
  if(!overflow()) return Promise.resolve();
  card.classList.add('fit-a5-compact');
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      if(!overflow()){resolve();return;}
      card.classList.add('fit-a5-tight');
      requestAnimationFrame(function(){
        if(overflow()){
          console.warn('[invitations] A5 content still overflows after tight fit',{cardHeight:card.clientHeight,contentHeight:cwrap.scrollHeight});
        }
        resolve();
      });
    });
  });
}
window.addEventListener('load',function(){
  fitInvitationToA5(document.getElementById('card')).then(function(){window.print();});
});
window.onafterprint=function(){setTimeout(function(){window.close()},250)};
</script>
</body>
</html>`);

      printWindow.document.close();
      printWindow.document.title = pdfName;
    }

    function doReset() {
      localStorage.removeItem(STORAGE_KEY);

      ['school', 'grade', 'ev-loc', 'b1', 'b2', 'course-custom', 'premium-company'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
      });

      $('ev-date').value = '';
      $('ev-time').value = '';
      $('ev-type').value = 'end';
      $('course-sel').selectedIndex = 0;
      $('year').value = 'תשפ״ז';
      applyColorPalette(DEFAULT_INVITATION_COLORS);
      $('closing1').value = 'נשמח לראותכם!';

      parts = makeDefaultParts();
      selBg = 0;
      logoOrder = ['mohe', 'taas', 'school'];
      customLogos = {};
      savedFields = {};

      for (const id of ['school-chip-img', 'lecturer-company-chip-img']) {
        const image = $(id);
        if (image) {
          image.src = '';
          image.style.display = 'none';
        }
      }

      queryAll('#logo-zone .lchip[data-id]').forEach((chip) => {
        if (!['mohe', 'taas', 'school', 'lecturer-company'].includes(chip.dataset.id)) chip.remove();
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
        'premium-company',
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

      $('lecturer-company-logo-chip').onclick = () => {
        logoUploadTarget = 'lecturer-company';
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

          if (logoUploadTarget === 'lecturer-company') {
            customLogos['lecturer-company'] = imageSrc;
            const chipImage = $('lecturer-company-chip-img');
            if (chipImage) {
              chipImage.src = imageSrc;
              chipImage.style.display = 'inline-block';
            }
            logoUploadTarget = null;
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
      console.assert($('year').options.length === 1 && $('year').value === 'תשפ״ז', 'only school year 2027 is offered');
      console.assert(!parts.some((participant) => participant.n === 'הילה רוזן'), 'Hila is not suggested by default');
      console.assert($('course-sel').querySelectorAll('option[value="יזמות פרימיום"]').length === 1, 'premium has one course choice');
      console.assert(getCourseDisplayHTML('יזמות פרימיום').includes('של קורס יזמות פרימיום'), 'premium course display exists');
      console.assert($('lecturer-company-logo-chip') !== null, 'lecturer company logo upload slot exists');
      console.assert(SUGGESTED_TEXTS_BY_COURSE['רוקחים עולם'].b1.includes('פארמצבטיקה'), 'pharmacy suggestion exists');
      console.assert($('course-sel').querySelector('option[value="פורצות דרך"]') !== null, 'breakthrough course exists');
      console.assert(colorsMatch(BREAKTHROUGH_COLORS, { c1: '#1f354d', c2: '#a40461', c3: '#5b0143' }), 'breakthrough preset colors');
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
