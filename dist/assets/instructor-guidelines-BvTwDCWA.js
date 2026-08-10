import{i as r,j as a,a6 as l}from"./index-DpctzQJl.js";const d="נהלי עבודה חשובים – קיץ 2026",c=["לוודא שעות ומיקום","לוודא איש קשר","לוודא אישור צילום","לוודא ציוד תקין","להגיע 15 דקות לפני","להתארגן לפני התחלה","להנחות בצורה ברורה","להתנהל בכבוד ובסבלנות","להחתים ולהעלות אישור ביצוע"],o=[{id:"before-day",number:1,title:"לפני יום הפעילות",icon:"📋",items:["יש לוודא קיום פעילות מול איש הקשר עד 48 שעות מראש.","יש לוודא מול איש הקשר שעה, מיקום ומספר משתתפים צפוי.","יש להוריד מראש את אישור הביצוע ממערכת הדשבורד.","יש לוודא שהציוד הנדרש שלם, תקין ומוכן לשימוש.","יש להכין מראש מצגת, סרטון, דף פעילות או דוגמה.","בכל חוסר, תקלה או שינוי יש לעדכן את מנהל הפעילות."]},{id:"arrival",number:2,title:"הגעה, התארגנות ואיחורים",icon:"🚗",items:["יש להגיע למקום 15 דקות לפחות לפני ההתחלה.","יש להקפיד להגיע בזמן ואין לאחר לפעילות.","עם ההגעה יש לאתר את איש הקשר במקום.","יש לוודא שולחנות, כיסאות, חשמל ואינטרנט.","יש לוודא שהמרחב בטוח ומסודר לפעילות.","אין להתחיל לפני שהילדים בהשגחת צוות הקייטנה.","בכל עיכוב או איחור יש לעדכן מיידית.","במקרה של היעדרות יש לעדכן ולקבל אישור מראש.","אין לבטל הגעה לפעילות ללא אישור מנהל הפעילות."]},{id:"during",number:3,title:"במהלך הפעילות",icon:"🎯",items:["יש לשמור על יחס מכבד, סבלני ומקצועי.","יש להתאים את ההסבר לגיל הילדים בקבוצה.","יש להקפיד על כללי בטיחות לאורך הפעילות.","אין להשאיר ילדים ללא השגחת צוות הקייטנה.","אין לבטל, לקצר או לשנות פעילות ללא אישור.","בשינוי משמעותי במספר הילדים יש לעדכן בהקדם."]},{id:"incidents",number:4,title:"אירועים חריגים ואישורים",icon:"⚠️",items:["בכל אירוע חריג יש לעדכן את מנהל הפעילות.","במקרה של פציעה יש לעדכן מיידית את מנהל הפעילות.","במקרה של נזק או חוסר בציוד יש לעדכן בהקדם.","בקשה חריגה מצד הקייטנה מחייבת אישור מראש.","בכל מצב של אי־בהירות יש להתייעץ לפני החלטה.","צילום ילדים מותר רק באישור צילום ובהתאם להנחיות."]},{id:"equipment",number:5,title:"ציוד ותוצרים",icon:"🧰",items:["יש לנהוג באחריות ולשמור על הציוד והתוצרים.","יש להשתמש בציוד בצורה מסודרת וזהירה.","אין למסור יותר מתוצר אחד לילד ללא אישור.","תוצרים שנותרו יש לשמור בצורה מסודרת.","בסיום יש לאסוף, לספור ולהחזיר את הציוד.","אין להשאיר ציוד או תוצרים ללא תיאום ואישור.","ציוד שנשבר, אבד או נפגם יש לדווח בהקדם."]},{id:"approval",number:6,title:"אישור ביצוע פעילות",icon:"✍️",items:["יש להשתמש באישור שהורד מראש ממערכת הדשבורד.","בסיום הפעילות יש להחתים את איש הקשר במקום.","יש לוודא שהפרטים תואמים לפעילות שבוצעה.","יש להעלות צילום ברור של האישור החתום לדשבורד."],showApprovalLink:!0},{id:"report",number:7,title:"דיווח בסיום יום",icon:"📝",items:["יש לדווח כיצד התנהלו הסדנאות באותו יום.","יש לציין אם עלו קשיים במהלך הפעילות.","יש לציין אם היה חוסר בציוד או בתוצרים.","יש לדווח על אירועים חריגים אם התרחשו.","יש לציין אם נדרשת השלמת ציוד להמשך.","יש להוסיף המלצות ודגשים לפעילות הבאה."]},{id:"conduct",number:8,title:"התנהלות מקצועית",icon:"🤝",items:["יש לשמור על שיתוף פעולה עם צוות הקייטנה.","יש להקפיד על שפה מכבדת, סבלנית וחיובית.","יש להגיע בלבוש מסודר ומתאים לפעילות.","אין לעזוב לפני איסוף הציוד וסגירה במקום.","בכל מצב של ספק יש לשאול ולעדכן בזמן אמת."]}];function u(t){return o.find(e=>e.id===t)||o[0]}function p(t){return`<ul class="instr-guidelines__list">${t.items.map(n=>`<li>${r(n)}</li>`).join("")}</ul>`}function m(t){return`${t.showApprovalLink?'<button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-guidelines-go-approvals>מעבר לאישורי ביצוע</button>':""}<button type="button" class="ds-btn ds-btn--xs ds-btn--secondary" data-ui-close-modal>סגור</button>`}function b(t){return`${t.number}. ${t.icon} ${t.title}`}function g(t){return`<button type="button" class="instr-guidelines__card" data-guideline-id="${r(t.id)}" aria-haspopup="dialog">
    <span class="instr-guidelines__card-num" aria-hidden="true">${t.number}</span>
    <span class="instr-guidelines__card-center">
      <span class="instr-guidelines__card-icon" aria-hidden="true">${t.icon}</span>
      <span class="instr-guidelines__card-body">
        <strong class="instr-guidelines__card-title">${r(t.title)}</strong>
      </span>
    </span>
    <span class="instr-guidelines__card-open">פתח</span>
  </button>`}function _(t){var e;(e=document.querySelector("[data-guidelines-go-approvals]"))==null||e.addEventListener("click",()=>{var n,i;(n=t==null?void 0:t.closeModal)==null||n.call(t),(i=document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]'))==null||i.click()},{once:!0})}const f={load:async()=>({}),render(){const t=c.map(e=>{const n=r(e);return e==="לוודא אישור צילום"?`<div class="procedures-intro-item procedures-intro-item--photo">
          <span class="procedures-intro-item__text">${n}</span>
          <a
            href="./forms/photo-consent-form.pdf"
            download
            class="instr-guidelines__pdf-download"
            aria-label="הורדת אישור צילום ופרסום"
            title="הורדת אישור צילום ופרסום"
          >
            <svg class="instr-guidelines__pdf-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M7 3.75h6.1L17.25 7.9v12.35H7V3.75Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M13 3.75V8h4.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M12 10.5v5.2m0 0 2.15-2.15M12 15.7l-2.15-2.15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
        </div>`:`<div class="procedures-intro-item">${n}</div>`}).join("");return a(`
      <section class="instructor-area instructor-guidelines">
        ${l(d)}
        <div class="instr-guidelines__strip" aria-label="תזכורת לפני פעילות">
          <p class="instr-guidelines__strip-title">לפני כל פעילות</p>
          <div class="procedures-intro-grid" role="list">${t}</div>
        </div>
        <div class="instr-guidelines__grid" role="list" aria-label="נושאי נהלים">${o.map(g).join("")}</div>
      </section>
    `)},bind({root:t,ui:e}){if(!e)return;function n(i){const s=u(i);s&&(e.openModal({title:b(s),content:p(s),actions:m(s),modalClass:"ds-modal--guidelines"}),_(e))}t.querySelectorAll("[data-guideline-id]").forEach(i=>{i.addEventListener("click",()=>{n(i.getAttribute("data-guideline-id"))})})}};export{f as instructorGuidelinesScreen};
