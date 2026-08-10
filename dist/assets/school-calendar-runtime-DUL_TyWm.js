import{h as f,B as b}from"./index-CH0LFGSL.js";import{l as g,g as V}from"./school-calendar-data-BXp6OOCd.js";const H=/^\d{4}-\d{2}-\d{2}$/;function u(e){const a=String(e||"").slice(0,10);return H.test(a)?a:""}function v(e){const a=u(e);return a?new Date(`${a}T12:00:00`).getTime():Number.NaN}function T(e){const a=/^(\d{1,2}):(\d{2})/.exec(String(e||"").trim());if(!a)return null;const t=Number(a[1]),n=Number(a[2]);return!Number.isInteger(t)||!Number.isInteger(n)||t<0||t>23||n<0||n>59?null:t*60+n}function _(e,a){const t=u(e);if(!t)return"";const n=new Date(`${t}T12:00:00`);return Number.isNaN(n.getTime())?"":(n.setDate(n.getDate()+Number(a)),n.toISOString().slice(0,10))}function k(e){return String(e||"").trim().toLowerCase().startsWith("summer_")}function R(e={}){const a=u(e.start_date),t=u(e.end_date)||a;return{...e,external_key:String(e.external_key||"").trim(),title:String(e.title||"").trim(),start_date:a,end_date:t,resume_date:u(e.resume_date),day_status:String(e.day_status||"").trim(),school_day_end_time:String(e.school_day_end_time||"").trim(),blocks_scheduling:e.blocks_scheduling===!0,enforce_end_time:e.enforce_end_time===!0,show_on_main_calendar:e.show_on_main_calendar!==!1,is_active:e.is_active!==!1}}function y(e=[],a,{visibleOnly:t=!0}={}){const n=v(a);return Number.isFinite(n)?(Array.isArray(e)?e:[]).map(R).filter(r=>{if(!r.is_active||!r.start_date||t&&!r.show_on_main_calendar)return!1;const i=v(r.start_date),o=v(r.end_date||r.start_date);return Number.isFinite(i)&&Number.isFinite(o)&&n>=i&&n<=o}).sort((r,i)=>r.blocks_scheduling!==i.blocks_scheduling?r.blocks_scheduling?-1:1:r.enforce_end_time!==i.enforce_end_time?r.enforce_end_time?-1:1:r.title.localeCompare(i.title,"he")):[]}function p(e=[],a){return y(e,a).find(t=>t.blocks_scheduling)||null}function j(e=[],a,t){const n=T(t);return n==null?null:y(e,a).find(r=>{if(!r.enforce_end_time||!r.school_day_end_time)return!1;const i=T(r.school_day_end_time);return i!=null&&n>i})||null}function W(e=[],a,{maxSkips:t=20}={}){let n=u(a);if(!n)return"";let r=0;for(;p(e,n)&&r<t;)n=_(n,7),r+=1;return n}function B(e=[],{maxTitles:a=2}={}){const t=Array.isArray(e)?e:[],n=[];if(t.forEach(o=>{const s=R(o);if(!s.title)return;const c=s.enforce_end_time&&s.school_day_end_time?` עד ${s.school_day_end_time.slice(0,5)}`:"",l=`${s.title}${c}`;n.includes(l)||n.push(l)}),!n.length)return"";const r=n.slice(0,Math.max(1,a)),i=n.length-r.length;return i>0?`${r.join(" · ")} +${i}`:r.join(" · ")}const G=new Map([["ינואר",1],["פברואר",2],["מרץ",3],["אפריל",4],["מאי",5],["יוני",6],["יולי",7],["אוגוסט",8],["ספטמבר",9],["אוקטובר",10],["נובמבר",11],["דצמבר",12]]);let w=null;function O(){if(document.getElementById("school-calendar-style"))return;const e=document.createElement("style");e.id="school-calendar-style",e.textContent=`
    #app .ds-interactive-card--day-cell.is-school-calendar-day {
      border-color: rgba(99, 102, 241, .45);
      min-width: 0;
    }
    #app .ds-interactive-card--day-cell.is-school-holiday {
      background: rgba(124, 58, 237, .07);
    }
    #app .ds-interactive-card--day-cell .ds-interactive-card__subtitle[data-school-calendar-label] {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
      white-space: normal !important;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.16;
      font-size: .56rem;
      padding: 1px 3px;
      border-radius: 6px;
    }
    #app .ds-interactive-card--day-cell.is-school-calendar-day .ds-interactive-card__meta {
      max-width: 100%;
      min-width: 0;
      font-size: .58rem;
      line-height: 1.16;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #app .ds-week-col__head {
      min-width: 0;
      overflow: hidden;
    }
    #app .ds-week-col__holiday[data-school-calendar-label] {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      margin-top: 4px;
      padding: 1px 3px;
      border-radius: 6px;
      line-height: 1.16;
      font-size: .58rem;
      white-space: normal !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #app .ds-week-col__holiday.is-school-holiday {
      font-weight: 700;
    }
    #app .ds-week-col .ds-interactive-card--session,
    #app .ds-month-day-cards .ds-interactive-card--session {
      min-width: 0;
      overflow: hidden;
      gap: 2px;
      padding: 4px 6px;
    }
    #app .ds-week-col .ds-interactive-card--session .ds-interactive-card__title,
    #app .ds-month-day-cards .ds-interactive-card--session .ds-interactive-card__title {
      max-width: 100%;
      min-width: 0;
      font-size: .66rem;
      line-height: 1.18;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #app .ds-week-col .ds-interactive-card--session .ds-interactive-card__subtitle,
    #app .ds-week-col .ds-interactive-card--session .ds-interactive-card__meta,
    #app .ds-month-day-cards .ds-interactive-card--session .ds-interactive-card__subtitle,
    #app .ds-month-day-cards .ds-interactive-card--session .ds-interactive-card__meta {
      max-width: 100%;
      min-width: 0;
      font-size: .58rem;
      line-height: 1.18;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `,document.head.appendChild(e)}function U(){return!!(document.querySelector('#app nav[aria-label="ניווט חודשי"] .ds-cal-nav__label')||document.querySelector("#app .ds-week-col[aria-label]"))}function P(){const e=document.querySelector('#app nav[aria-label="ניווט חודשי"] .ds-cal-nav__label'),a=String((e==null?void 0:e.textContent)||"").replace(/\s+/g," ").trim();for(const[t,n]of G.entries()){const r=new RegExp(`${t}\\s+(\\d{4})`).exec(a);if(r)return{year:Number(r[1]),month:n}}return null}function X(e,a){let t=e.querySelector(".ds-interactive-card__subtitle");if(!t){t=document.createElement("p"),t.className="ds-interactive-card__subtitle";const n=e.querySelector(".ds-interactive-card__meta");n?e.insertBefore(t,n):e.appendChild(t)}t.dataset.schoolCalendarLabel="true",t.textContent!==a&&(t.textContent=a)}function J(e){const a=P();a&&document.querySelectorAll("#app .ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)").forEach(t=>{var s;const n=t.querySelector(".ds-interactive-card--day-cell"),r=Number(((s=n==null?void 0:n.querySelector(".ds-interactive-card__title"))==null?void 0:s.textContent)||"");if(!n||!Number.isInteger(r)||r<1||r>31)return;const i=`${a.year}-${String(a.month).padStart(2,"0")}-${String(r).padStart(2,"0")}`,o=y(e,i);o.length&&(X(n,B(o,{maxTitles:1})),n.classList.add("is-school-calendar-day"),n.classList.toggle("is-school-holiday",o.some(c=>c.blocks_scheduling)),n.title=o.map(c=>{const l=c.resume_date?` · חזרה ${f(c.resume_date)||c.resume_date}`:"";return`${c.title}${l}`}).join(`
`))})}function K(e){document.querySelectorAll("#app .ds-week-col[aria-label]").forEach(a=>{const t=String(a.getAttribute("aria-label")||"").slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(t))return;const n=y(e,t);if(!n.length)return;const r=a.querySelector(".ds-week-col__head");if(!r)return;let i=r.querySelector(".ds-week-col__holiday");i||(i=document.createElement("span"),i.className="ds-week-col__holiday",r.appendChild(i));const o=B(n,{maxTitles:2});i.dataset.schoolCalendarLabel="true",i.textContent!==o&&(i.textContent=o),i.classList.toggle("is-school-holiday",n.some(s=>s.blocks_scheduling)),i.title=n.map(s=>s.title).join(`
`)})}async function Q(){if(O(),!U())return;const e=await g();J(e),K(e)}function A(){clearTimeout(w),w=setTimeout(()=>{w=null,Q()},40)}function Y(){if(globalThis.__SCHOOL_CALENDAR_UI_STARTED__)return;globalThis.__SCHOOL_CALENDAR_UI_STARTED__=!0,O(),A();const e=document.getElementById("app");e&&new MutationObserver(a=>{a.some(n=>Array.from(n.addedNodes).some(r=>{var i,o;return r.nodeType===1&&(((i=r.matches)==null?void 0:i.call(r,".ds-cal-grid, .ds-week-col, .ds-cal-nav__label"))||((o=r.querySelector)==null?void 0:o.call(r,".ds-cal-grid, .ds-week-col, .ds-cal-nav__label")))}))&&A()}).observe(e,{childList:!0,subtree:!0})}const S=new WeakSet;function h(e){return Array.from(e.querySelectorAll("[data-meeting-dates-edit] input[data-meeting-idx]")).sort((a,t)=>Number(a.dataset.meetingIdx)-Number(t.dataset.meetingIdx))}function C(e){var a;return String(((a=e.querySelector('[name="activity_season"]'))==null?void 0:a.value)||e.dataset.activitySeason||"").trim()}function $(e){return!!e.querySelector('[data-chain-toggle] [data-date-mode="chain"].is-active')}function x(e){const a=h(e);a.forEach(r=>{var s;const i=(s=r.closest(".activity-drawer__date-card"))==null?void 0:s.querySelector(".activity-drawer__weekday");if(!i)return;const o=new Date(`${r.value}T12:00:00`);i.textContent=Number.isNaN(o.getTime())?"":["א","ב","ג","ד","ה","ו","ש"][o.getDay()]||""});const t=a.length?String(a[a.length-1].value||""):"",n=e.querySelector("[data-computed-end-display]");n&&(n.textContent=t?f(t)||t:"—"),e.dataset.autoEndDate=t}function Z(e){e.querySelectorAll("[data-session-deferral-note]").forEach(a=>a.remove())}function ee(e,a){if(!a)return;const t=e.closest(".activity-drawer__date-card");if(!t)return;const n=document.createElement("small");n.dataset.sessionDeferralNote="true",n.className="ds-muted activity-drawer__date-deferral",n.textContent=a===1?"נדחה בשבוע עקב חג או חופשה":`נדחה ב־${a} שבועות עקב חג או חופשה`,t.appendChild(n)}function I(e,a=[]){var l,D,N,E,q;const t=h(e),n=((l=e==null?void 0:e.dataset)==null?void 0:l.isOnce)==="yes",r=Number(((D=e.querySelector('[name="sessions"]'))==null?void 0:D.value)||((E=(N=e.querySelector("[data-session-total]"))==null?void 0:N.dataset)==null?void 0:E.sessionTotal)||t.length),i=n?1:Math.min(t.length,Math.max(1,Math.floor(r||t.length))),o=String(((q=t[0])==null?void 0:q.value)||"").trim(),s={dates:[],deferred:[],exhausted:!1};if(Z(e),!o)return t.slice(1).forEach(d=>{d.value="",d.dataset.prevValue=""}),e.dataset.autoStartDate="",x(e),s;let c=o;for(let d=0;d<i;d+=1){d>0&&(c=_(c,7));let m=0;for(;p(a,c)&&m<52;)c=_(c,7),m+=1;if(!c||p(a,c)){s.exhausted=!0;break}t[d].value=c,t[d].dataset.prevValue=c,s.dates.push(c),m&&(s.deferred.push({meeting:d+1,skippedWeeks:m}),ee(t[d],m))}return t.slice(i).forEach(d=>{d.value="",d.dataset.prevValue=""}),e.dataset.autoStartDate=s.dates[0]||"",x(e),s}async function M(e,a){if(k(C(e)))return!1;const t=await g(),n=h(e),r=n.findIndex(s=>Number(s.dataset.meetingIdx)===Number(a));if(r<0)return!1;let i=String(n[r].value||"").trim();if(!i)return!1;let o=!1;for(let s=r;s<n.length;s+=1){s>r&&(i=_(i,7));const c=W(t,i);c!==String(n[s].value||"")&&(o=!0),n[s].value=c,n[s].dataset.prevValue=c,i=c}return x(e),o}function z(e,a){var r;if(k(C(e)))return"";const t=String(((r=e.querySelector('[name="end_time"]'))==null?void 0:r.value)||"").trim(),n=h(e).map(i=>String(i.value||"").trim()).filter(Boolean);for(const i of n){const o=p(a,i);if(o)return`לא ניתן לשמור פעילות ב־${f(i)||i}: ${o.title}.`;const s=j(a,i,t);if(s){const c=String(s.school_day_end_time||"").slice(0,5);return`לא ניתן לשמור פעילות ב־${f(i)||i}: הלימודים מסתיימים בשעה ${c}.`}}return""}function F(e,a){const t=e.querySelector(".ds-activity-edit-status");t&&(t.textContent=a,t.classList.remove("is-pending","is-success","is-warning"),t.classList.add("is-error")),b(a,"error",4200)}function L(e){const a=e.getAttribute("data-action");a&&(e.removeAttribute("data-action"),queueMicrotask(()=>e.setAttribute("data-action",a)))}async function te(e,a){const t=await g(),n=z(a,t);if(n){F(a,n);return}S.add(a),e.click()}function ae(){document.addEventListener("change",e=>{const a=e.target.closest("input[data-meeting-idx]");if(!a)return;const t=a.closest("[data-drawer-form]");if(!t)return;const n=Number(a.dataset.meetingIdx);if(n===0){const r=String(a.value||"");if(!r){I(t,[]);return}t.dataset.sessionGenerationRequest=r,g().then(i=>{if(t.dataset.sessionGenerationRequest!==r||String(a.value||"")!==r)return;I(t,k(C(t))?[]:i).deferred.length&&b("רצף המפגשים עודכן ודילג על ימי חופשה","info",2600)});return}$(t)&&M(t,n).then(r=>{r&&b("רצף המפגשים עודכן ודילג על ימי חופשה","info",2600)})}),document.addEventListener("click",e=>{const a=e.target.closest('[data-action="add-meeting"]');if(!a)return;const t=a.closest("[data-drawer-form]");!t||!$(t)||setTimeout(()=>{const n=h(t),r=n[n.length-1];r&&M(t,Number(r.dataset.meetingIdx))},0)}),document.addEventListener("click",e=>{const a=e.target.closest('[data-action="save-edit"]');if(!a)return;const t=a.closest("[data-drawer-form]");if(!t)return;if(S.has(t)){S.delete(t);return}const n=V();if(!n){e.preventDefault(),L(a),te(a,t);return}const r=z(t,n);r&&(e.preventDefault(),L(a),F(t,r))},!0)}Y();ae();
