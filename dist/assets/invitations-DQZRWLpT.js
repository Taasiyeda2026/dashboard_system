const N="taasiyeda_invitation_builder_state_v4",M="./assets/invitations/",w={mohe:`${M}logos/education-logo.png`,taas:`${M}logos/taasiyeda-logo.png`},A=[{type:"solid",label:"לבן",value:"#ffffff"},...[1,2,3,4,5,6,7,8].map(h=>({type:"image",label:`רקע ${h}`,value:`${M}backgrounds/background-${h}.png`}))],At=[{t:"גב׳",n:"יעל אביב",r:"מנהלת תחום חינוך ופדגוגיה, תעשיידע"},{t:"גב׳",n:"הילה רוזן",r:"אחראית הדרכה ומנחת הקבוצה, תעשיידע"}],C={"ביומימיקרי – המצאות בהשראת הטבע":{b1:"לאורך התהליך יצאו התלמידים למסע חקר בעקבות הטבע: הם התבוננו בבעלי חיים, בצמחים ובתופעות טבע וגילו כיצד הטבע יכול לעורר השראה לפיתוח פתרונות טכנולוגיים חדשניים.",b2:"התלמידים יציגו את הרעיונות המקוריים שפיתחו וישתפו בדרך שבה סקרנות, יצירתיות, מדע וטכנולוגיה התחברו לחוויית למידה משמעותית בהשראת הטבע."},"רוקחים עולם":{b1:"לאורך התהליך נחשפו התלמידים לעולם הפארמצבטיקה והרוקחות: הם הכירו כיצד ידע מדעי, חומרים, דיוק ואחריות מתחברים לפיתוח פתרונות המשפיעים על בריאות ואיכות חיים.",b2:"התלמידים יציגו את התובנות והתוצרים שפיתחו, וישתפו בדרך שבה חקר, חשיבה מדעית, יצירתיות וטכנולוגיה התחברו לחוויית למידה משמעותית בתחום הפארמצבטיקה."},"בינה מלאכותית – חשיבה ביקורתית במציאות טכנולוגית":{b1:"לאורך התהליך נחשפו התלמידים לעולם הבינה המלאכותית: הם הכירו כיצד נתונים, אלגוריתמים, חשיבה ביקורתית וכלים טכנולוגיים יכולים לסייע בפתרון בעיות, ביצירת רעיונות ובפיתוח תהליכי למידה חדשניים.",b2:"התלמידים יציגו את התוצרים והרעיונות שפיתחו, וישתפו בדרך שבה סקרנות, חשיבה יצירתית, טכנולוגיה ובינה מלאכותית התחברו לחוויית למידה משמעותית ועדכנית."},"יזמות פרימיום – אסם":{b1:"לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה, תוך דגש על איכות, בטיחות ואחריות בהשראת עולמות התוכן של אסם.",b2:"התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו להבנה עמוקה של איכות ובטיחות כחלק מחוויית למידה משמעותית."},"יזמות פרימיום – מארוול":{b1:"לאורך התהליך השתתפו התלמידים במסע יזמי לפיתוח רעיון למוצר: הם זיהו צורך, חקרו קהל יעד, גיבשו פתרון מקורי וחיברו בין יצירתיות, חשיבה עסקית וטכנולוגיה בהשראת עולמות התוכן של מארוול.",b2:"התלמידים יציגו את הרעיונות והמוצרים שפיתחו, וישתפו בדרך שבה חשיבה יזמית, עבודת צוות, חדשנות ותהליך פיתוח מוצר התחברו לחוויית למידה משמעותית."},default:{b1:"לאורך התהליך השתתפו התלמידים במסע למידה חווייתי, שבו חקרו רעיונות, התנסו בכלים מעשיים וגילו כיצד ידע, יצירתיות וטכנולוגיה מתחברים ללמידה משמעותית.",b2:"התלמידים יציגו את התוצרים והרעיונות שפיתחו, וישתפו בדרך שבה סקרנות, חשיבה יצירתית ועבודת צוות התחברו לחוויית למידה פעילה ומשמעותית."}};function Ct(){if(document.getElementById("invitation-generator-styles"))return;const h=document.createElement("style");h.id="invitation-generator-styles",h.textContent=`
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
.invitation-screen-root .c-logo-item{width:32mm;height:14mm;display:flex;align-items:center;justify-content:center;gap:4px;font-size:10px;font-weight:800;color:#1a3a5c;line-height:1.2}
.invitation-screen-root .c-logo-sep{width:1px;height:26px;background:rgba(26,58,92,.2);flex-shrink:0}
.invitation-screen-root .c-logo-item img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.invitation-screen-root .c-main{padding:1.5mm 6mm 2mm;flex:1;display:flex;flex-direction:column;align-items:center;text-align:center}
.invitation-screen-root .c-title{font-weight:900;line-height:1;margin-bottom:0;font-size:14mm}
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
.invitation-screen-root #card.fit-a5-compact .c-title{font-size:9.5mm}
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
`,document.head.appendChild(h)}function nt(){return JSON.parse(JSON.stringify(At))}function _t(){return`
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
</section>`}const Ht={load:async()=>({}),render(){return Ct(),_t()},bind({root:h}){const x=h.querySelector("[data-inv-root]");if(!x)return;const n=t=>x.querySelector(`#${t}`),j=t=>Array.from(x.querySelectorAll(t));let k=!1,b=0,p=["mohe","taas","school"],g={},S=null,_=!1,H=!1,d=nt(),$={};function r(t){return String(t||"").replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e])}function I(){const t=n("course-sel").value;return t==="__c"?n("course-custom").value||"":t}function B(){return C[I()]||C.default}function rt(t){const e=(t||"").trim();return e?Object.values(C).some(o=>Object.values(o).some(i=>(i||"").trim()===e)):!0}function at(){const t=B();["b1","b2"].forEach(e=>{const o=n(e);!o||!t[e]||rt(o.value)&&(o.value=t[e])})}function R(){at(),a()}function U(t){const e=B(),o=n(t);!o||!e[t]||(o.value=e[t],a())}function st(){const t=d.some(o=>/מנהלת בית הספר|מנהל בית הספר/.test(o.r||"")),e=d.some(o=>(o.n||"").trim()==="יעל אביב");t||d.unshift({t:"גב׳",n:"",r:"מנהלת בית הספר"}),e||d.splice(t?0:1,0,{t:"גב׳",n:"יעל אביב",r:"מנהלת תחום חינוך ופדגוגיה, תעשיידע"}),y(),a()}function P(){const t=n("bg-row");t.innerHTML="",A.forEach((e,o)=>{const i=document.createElement("div");i.className=`bg-th${o===b?" sel":""}`,i.title=e.label,e.type==="solid"?(i.style.backgroundColor=e.value,i.style.backgroundImage="none"):i.style.backgroundImage=`url(${e.value})`,i.onclick=()=>{b=o,P(),a()},t.appendChild(i)})}function y(){const t=n("parts");t.innerHTML="",d.forEach((e,o)=>{const i=document.createElement("div");i.className="part-row",i.draggable=!0,i.dataset.index=String(o),i.innerHTML=`
          <div class="drag-handle" title="גרירה לסידור">⋮⋮</div>
          <select>
            <option ${e.t==="גב׳"?"selected":""}>גב׳</option>
            <option ${e.t==="מר"?"selected":""}>מר</option>
          </select>
          <input type="text" placeholder="שם" value="${r(e.n)}">
          <input type="text" placeholder="תפקיד" value="${r(e.r)}">
          <button class="del-btn" type="button">×</button>`;const m=i.querySelector("select"),l=i.querySelectorAll("input");m.onchange=()=>{d[o].t=m.value,a()},l[0].oninput=()=>{d[o].n=l[0].value,a()},l[1].oninput=()=>{d[o].r=l[1].value,a()},i.querySelector("button").onclick=()=>{d.splice(o,1),y(),a()},i.ondragstart=c=>{c.dataTransfer.setData("partIndex",String(o)),i.classList.add("dragging")},i.ondragend=()=>i.classList.remove("dragging"),i.ondragover=c=>c.preventDefault(),i.ondrop=c=>{c.preventDefault();const s=Number(c.dataTransfer.getData("partIndex")),v=Number(i.dataset.index);if(!Number.isNaN(s)&&!Number.isNaN(v)&&s!==v){const f=d.splice(s,1)[0];d.splice(v,0,f),y(),a()}},t.appendChild(i)})}function ct(){d.push({t:"גב׳",n:"",r:""}),y(),a()}function lt(){return["ev-type","course-sel","course-custom","c1","c2","c3","school","grade","year","ev-date","ev-time","ev-loc","b1","b2","closing1","lec-name","lec-topic","lec-org","tour-place","tour-org"]}function dt(){const t={};return lt().forEach(e=>{const o=n(e);o&&(t[e]=o.value)}),t}function D(t={}){Object.entries(t).forEach(([e,o])=>{const i=n(e);i&&(i.value=o)})}function pt(){if(!k)try{localStorage.setItem(N,JSON.stringify({fields:dt(),parts:d,selBg:b,logoOrder:p,customLogos:g}))}catch(t){console.warn("Could not save invitation builder state",t)}}function gt(){const t=localStorage.getItem(N);if(t)try{k=!0;const e=JSON.parse(t);$=e.fields||{},D($),Array.isArray(e.parts)&&(d=e.parts),typeof e.selBg=="number"&&(b=Math.min(Math.max(e.selBg,0),A.length-1)),Array.isArray(e.logoOrder)&&(p=e.logoOrder),e.customLogos&&typeof e.customLogos=="object"&&(g=e.customLogos),k=!1}catch(e){console.warn("Could not restore invitation builder state",e),k=!1}}function ut(){Object.entries(g).forEach(([e,o])=>{if(e==="school"||x.querySelector(`[data-id="${e}"]`))return;const i=document.createElement("div");i.className="lchip",i.draggable=!0,i.dataset.id=e,i.innerHTML=`<img src="${o}" style="height:14px"> <button style="background:none;border:none;cursor:pointer;font-size:12px;color:#999;padding:0">×</button>`,i.querySelector("button").onclick=m=>{m.stopPropagation(),p=p.filter(l=>l!==e),delete g[e],i.remove(),a()},n("logo-add").before(i)});const t=n("school-chip-img");g.school&&t&&(t.src=g.school,t.style.display="inline-block")}function mt(t){if(!t)return null;const e=new Date(`${t}T12:00:00`);return{day:`יום ${["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][e.getDay()]}`,date:`${String(e.getDate()).padStart(2,"0")}.${String(e.getMonth()+1).padStart(2,"0")}.${e.getFullYear()}`}}function ft(t){const o=(t||"").replace(/ +- +/g," – ").split(" – ");return{name:(o[0]||t||"").replace(/^קורס +/,"").trim(),subtitle:o.slice(1).join(" – ").trim()}}function G(t){if(t==="יזמות פרימיום – אסם")return'<span class="course-main">של קורס יזמות פרימיום</span><span class="course-company">בליווי חברה מאמצת: אסם</span>';if(t==="יזמות פרימיום – מארוול")return'<span class="course-main">של קורס יזמות פרימיום</span><span class="course-company">בליווי חברה מאמצת: מארוול</span>';const e=ft(t);return`<span class="course-main">של קורס ${r(e.name)}</span>${e.subtitle?`<span class="course-sub">${r(e.subtitle)}</span>`:""}`}function vt(t,e){return t==="end"?"למפגש הסיום":e}function ht(t){return t==="יזמות פרימיום – אסם"||t==="יזמות פרימיום – מארוול"?"יזמות פרימיום":t}function Y(t){return t==="ביומימיקרי – המצאות בהשראת הטבע"?"ביומימיקרי":t==="יזמות פרימיום – אסם"?"יזמות פרימיום אסם":t==="יזמות פרימיום – מארוול"?"יזמות פרימיום מארוול":(t||"קורס").replace(/קורס\s*/g,"").trim()||"קורס"}function bt(t){return t==="end"?"מפגש סיום":t==="lecture"?"הרצאת אורח":t==="tour"?"סיור לימודי":"אירוע"}function xt(){return`הזמנה - ${bt(n("ev-type").value)} ${Y(I())}`}function q(){const t=n("ev-type").value,e=n("extra");e.innerHTML="",t==="lecture"?e.innerHTML=`
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">שם המרצה</span><input type="text" id="lec-name"></div>
            <div><span class="lbl">נושא</span><input type="text" id="lec-topic"></div>
          </div>
          <div style="margin-top:4px"><span class="lbl">חברה / מוסד</span><input type="text" id="lec-org"></div>`:t==="tour"&&(e.innerHTML=`
          <div class="field-row" style="margin-top:4px">
            <div><span class="lbl">מקום הסיור</span><input type="text" id="tour-place"></div>
            <div><span class="lbl">חברה מארחת</span><input type="text" id="tour-org"></div>
          </div>`),e.querySelectorAll("input").forEach(o=>{o.oninput=a}),D($),a()}function yt(t,e,o,i){return t==="school"?g.school?`<div class="${i}"><img src="${g.school}"></div>`:`<div class="${i}" style="border:1px dashed rgba(26,58,92,.35);border-radius:6px;color:rgba(26,58,92,.55);font-size:${o}px">לוגו בית הספר</div>`:t==="mohe"?H?`<div class="${i}"><img src="${w.mohe}"></div>`:`<div class="${i}"><span style="font-size:${e+4}px">🏛️</span><span style="font-size:${o}px">משרד<br>החינוך</span></div>`:t==="taas"?_?`<div class="${i}"><img src="${w.taas}"></div>`:`<div class="${i}"><span style="font-size:${e+4}px">⚡</span><span style="font-size:${o}px">תעשיידע</span></div>`:g[t]?`<div class="${i}"><img src="${g[t]}"></div>`:""}function J(t=!1){if(t)return`
          <div class="c-footer">
            <div class="c-footer-sentence">
              <span style="color:#1e262e">תעשיידע – </span>
              <span class="bright-word" style="color:#fdf58c">מובילים </span>
              <span class="bright-word" style="color:#73e4ff">דור אחד קדימה, </span>
              <span style="color:#fb1881">בחדשנות, </span>
              <span style="color:#4ddfc2">סקרנות </span>
              <span class="bright-word" style="color:#fcaf3e">ויזמות טכנולוגית</span>
            </div>
          </div>`;let e="";return p.forEach((o,i)=>{i>0&&(e+='<div class="c-logo-sep"></div>'),e+=yt(o,56,10,"c-logo-item")}),`<div class="c-logos">${e}</div>`}function F(){const t=n("c1").value,e=n("c2").value,o=n("c3").value;return{c1:t,c2:e,c3:o,style:`--main-color:${t};--accent-color:${e};--course-color:${o};`}}function V(){var Q,Z,tt,et,ot;const{c1:t,c2:e,c3:o}=F(),i=n("ev-type").value,m=n("school").value,l=n("grade").value,c=n("year").value,s=mt(n("ev-date").value),v=n("ev-time").value,f=n("ev-loc").value,T=n("b1").value,K=n("b2").value,X=I(),Et=n("closing1").value||"נשמח לראותכם!",O=i==="end"?"למפגש הסיום":i==="lecture"?"להרצאת אורח":"לסיור לימודי";let E="";if(i==="end")E=`<div class="c-opening">אנו שמחים להזמינכם למפגש הסיום של קורס <strong>${r(ht(X))}</strong>, שהתקיים בבית הספר במסגרת התוכניות החינוכיות של תעשיידע.</div>`;else if(i==="lecture"){const u=((Q=n("lec-name"))==null?void 0:Q.value)||"",z=((Z=n("lec-topic"))==null?void 0:Z.value)||"",it=((tt=n("lec-org"))==null?void 0:tt.value)||"";E=`<div class="c-opening">אנו שמחים להזמינכם <strong>${O}</strong>${u?` עם <strong>${r(u)}</strong>`:""}${z?` | <strong>${r(z)}</strong>`:""}${it?` — ${r(it)}`:""}</div>`}else{const u=((et=n("tour-place"))==null?void 0:et.value)||"",z=((ot=n("tour-org"))==null?void 0:ot.value)||"";E=`<div class="c-opening">אנו שמחים להזמינכם <strong>${O}</strong>${u?` ב<strong>${r(u)}</strong>`:""}${z?` | <strong>${r(z)}</strong>`:""}</div>`}let W=`<div class="c-part-title" style="color:${e}">בהשתתפות:</div>`;return d.filter(u=>u.n||u.r).forEach(u=>{W+=`
          <div class="c-part-line">
            ${u.t?`${r(u.t)} `:""}
            <strong>${r(u.n)}</strong>
            ${u.r?`<span style="font-weight:400">, ${r(u.r)}</span>`:""}
          </div>`}),`
        ${J(!1)}
        <div class="c-main">
          <div class="c-title" style="color:${t}">הזמנה</div>
          <div class="c-sub-event" style="color:${t}">${vt(i,O)}</div>
          <div class="c-course" style="color:${o}">${G(X)}</div>
          ${m||l?`<div class="c-school">כיתה <strong>${r(l||"____")}</strong> | בית ספר <strong>${r(m||"______")}</strong> | <strong>${r(c)}</strong></div>`:`<div class="c-year">${r(c)}</div>`}
          <div class="c-divider"></div>
          ${E}
          <div class="c-box c-details-box">
            <div class="c-details-top">
              ${s?`<div class="c-info-row">🗓️ <strong>${s.day}</strong></div>`:""}
              ${s?`<div class="c-info-row">📅 <strong>${s.date}</strong></div>`:""}
              ${v?`<div class="c-info-row">⏰ <strong>${r(v)}</strong></div>`:""}
            </div>
            ${f?`<div class="c-info-row c-details-location">📍 ${r(f)}</div>`:""}
          </div>
          ${T?`<div class="c-para">${r(T)}</div>`:""}
          ${K?`<div class="c-section-title">מה מצפה לנו:</div><div class="c-para">${r(K)}</div>`:""}
          <div class="c-box c-participants-box">${W}</div>
          <div class="c-closing" style="color:${o}">${r(Et)}</div>
        </div>
        ${J(!0)}`}function a(){const t=n("course-custom");if(!t)return;t.style.display=n("course-sel").value==="__c"?"block":"none";const e=F();n("card").setAttribute("style",e.style);const o=A[b],i=n("cbg");o.type==="solid"?(i.style.backgroundImage="none",i.style.backgroundColor=o.value):(i.style.backgroundColor="transparent",i.style.backgroundImage=`url(${o.value})`),n("cwrap").innerHTML=V(),requestAnimationFrame(()=>wt(n("card"))),pt()}function wt(t){if(!t)return Promise.resolve();const e=t.querySelector(".cwrap");if(!e)return Promise.resolve();t.classList.remove("fit-a5-compact","fit-a5-tight");const o=()=>e.scrollHeight>t.clientHeight;return o()?(t.classList.add("fit-a5-compact"),new Promise(i=>{requestAnimationFrame(()=>{if(!o()){i();return}t.classList.add("fit-a5-tight"),requestAnimationFrame(()=>{o()&&console.warn("[invitations] A5 content still overflows after tight fit",{cardHeight:t.clientHeight,contentHeight:e.scrollHeight}),i()})})})):Promise.resolve()}function $t(t){var i;const e=t.type==="solid"?`background-color:${t.value};background-image:none`:`background-image:url(${t.value})`;return`${(((i=document.getElementById("invitation-generator-styles"))==null?void 0:i.textContent)||"").replace(".invitation-screen-root .preview #card{zoom:.50}","")}
body{font-family:'Assistant',sans-serif;background:#ccc;display:flex;flex-direction:column;align-items:center;padding:20px;direction:rtl}
@page{size:A5 portrait;margin:0}
@media print{html,body{width:148mm;height:210mm;margin:0;padding:0;overflow:hidden}body{background:none;display:flex;align-items:flex-start;justify-content:center}.np{display:none}#card{width:148mm;height:210mm;min-height:210mm;max-height:210mm;overflow:hidden;box-shadow:none!important;position:relative;margin:0 auto;transform:none}}
.np{margin-bottom:14px}
.np button{background:#1a8c6e;color:#fff;border:none;padding:9px 22px;border-radius:7px;font-family:'Assistant',sans-serif;font-size:14px;font-weight:700;cursor:pointer}
.cbg{${e}}`}function zt(){const t=V(),e=F(),o=xt(),i=window.open("","_blank","width=680,height=980");i&&(i.document.write(`
<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="UTF-8">
<title>${r(o)}</title>
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${$t(A[b])}</style>
</head>
<body>
<div class="np"><button onclick="window.print()">PDF</button></div>
<div class="invitation-screen-root">
  <div id="card" style="${e.style}">
    <div class="cbg"></div>
    <div class="cframe"></div>
    <div class="cwrap">${t}</div>
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
<\/script>
</body>
</html>`),i.document.close(),i.document.title=o)}function kt(){localStorage.removeItem(N),["school","grade","ev-loc","b1","b2","course-custom"].forEach(e=>{const o=n(e);o&&(o.value="")}),n("ev-date").value="",n("ev-time").value="",n("ev-type").value="end",n("course-sel").selectedIndex=0,n("c1").value="#1a3a5c",n("c2").value="#1a8c6e",n("c3").value="#1a8c6e",n("closing1").value="נשמח לראותכם!",d=nt(),b=0,p=["mohe","taas","school"],g={},$={};const t=n("school-chip-img");t&&(t.src="",t.style.display="none"),j("#logo-zone .lchip[data-id]").forEach(e=>{["mohe","taas","school"].includes(e.dataset.id)||e.remove()}),q(),P(),y(),L(),a()}function L(){j("#logo-zone .lchip[draggable=true]").forEach(t=>{t.ondragstart=e=>{e.dataTransfer.setData("lid",t.dataset.id),t.classList.add("ghost")},t.ondragend=()=>t.classList.remove("ghost"),t.ondragover=e=>e.preventDefault(),t.ondrop=e=>{e.preventDefault();const o=e.dataTransfer.getData("lid"),i=t.dataset.id;if(!o||o===i)return;const m=p.indexOf(o),l=p.indexOf(i);m>-1&&l>-1&&(p.splice(m,1),p.splice(l,0,o));const c=x.querySelector(`[data-id="${o}"]`),s=x.querySelector(`[data-id="${i}"]`);c&&s&&c.parentNode===s.parentNode&&(m<l?s.after(c):s.before(c)),a()}})}function St(){["course-custom","c1","c2","c3","school","grade","year","ev-date","ev-time","ev-loc","b1","b2","closing1"].forEach(t=>{const e=n(t);e&&(e.tagName==="SELECT"?e.onchange=a:e.oninput=a)}),n("course-sel").onchange=R,n("ev-type").onchange=q,n("suggest-b1").onclick=()=>U("b1"),n("suggest-b2").onclick=()=>U("b2"),n("suggest-parts").onclick=st,n("add-part").onclick=ct,n("print-btn").onclick=zt,n("reset-btn").onclick=kt,n("school-logo-chip").onclick=()=>{S="school",n("logo-file").click()},n("logo-add").onclick=()=>{S=null,n("logo-file").click()},n("logo-file").onchange=function(){var i;const e=(i=this.files)==null?void 0:i[0];if(!e)return;const o=new FileReader;o.onload=m=>{var v;const l=((v=m.target)==null?void 0:v.result)||"";if(S==="school"){g.school=l,p.includes("school")||p.push("school");const f=n("school-chip-img");f&&(f.src=l,f.style.display="inline-block"),S=null,L(),a();return}const c=`cu_${Date.now()}`;g[c]=l,p.push(c);const s=document.createElement("div");s.className="lchip",s.draggable=!0,s.dataset.id=c,s.innerHTML=`<img src="${l}" style="height:14px"> <button style="background:none;border:none;cursor:pointer;font-size:12px;color:#999;padding:0">×</button>`,s.querySelector("button").onclick=f=>{f.stopPropagation(),p=p.filter(T=>T!==c),delete g[c],s.remove(),a()},n("logo-add").before(s),L(),a()},o.readAsDataURL(e),this.value=""}}function Lt(){console.assert(typeof R=="function","onCourseChange exists"),console.assert(Y("יזמות פרימיום – אסם").includes("אסם"),"PDF filename keeps company"),console.assert(C["רוקחים עולם"].b1.includes("פארמצבטיקה"),"pharmacy suggestion exists"),console.assert(G("יזמות פרימיום – מארוול").includes("בליווי חברה מאמצת: מארוול"),"Marvel company line exists")}function Tt(){St(),gt(),ut(),P(),y(),q(),D($),L(),a(),Lt();const t=new Image;t.onload=()=>{_=!0;const o=n("taas-chip-img");o&&(o.src=w.taas,o.style.display="inline-block"),a()},t.onerror=()=>{_=!1},t.src=w.taas;const e=new Image;e.onload=()=>{H=!0;const o=n("mohe-chip-img");o&&(o.src=w.mohe,o.style.display="inline-block"),a()},e.onerror=()=>{H=!1},e.src=w.mohe}Tt()}};export{Ht as invitationsScreen};
