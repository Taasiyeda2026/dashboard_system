import{j as w,a6 as P,q as T,a3 as E,i as l,h as R}from"./index-CH0LFGSL.js";function I(t){return t===!0||["yes","true","1"].includes(String(t||"").trim().toLowerCase())}function A(t={}){return I(t==null?void 0:t.finance_access)||String((t==null?void 0:t.role)||(t==null?void 0:t.display_role)||"").trim()==="finance"}function v(t){if(typeof t=="number")return Number.isFinite(t)?t:0;const e=String(t??"").replace(/[₪,\s]/g,""),s=Number(e);return Number.isFinite(s)?s:0}function _(t){const e=v(t);return e?`₪${e.toLocaleString("he-IL",{maximumFractionDigits:0})}`:"—"}function $(t={}){const e=t.price??t.amount??t.activity_price;return e==null||e===""?!1:v(e)>0}function S(t={}){return v(t.price??t.amount??t.activity_price)}function k(t={}){const e=String(t.payment_collected??t.collected??"").trim().toLowerCase();return e==="yes"||e==="true"||e==="1"||e==="נגבה"}function j(t={}){return String(t.RowID||t.row_id||t.source_row_id||"").trim()}function h(t={}){return String(t.end_date||t.date_end||t.start_date||"").trim()}function x(t={}){const e=String(t.status||"").trim().toLowerCase();if(["סגור","closed","inactive","נמחק","deleted"].includes(e))return!0;const s=h(t);if(!s)return!1;const c=new Date(s);if(isNaN(c.getTime()))return!1;const n=new Date;return n.setHours(0,0,0,0),c<n}const b=[{key:"course",label:"קורסים"},{key:"workshop",label:"סדנאות"},{key:"escape_room",label:"חדרי בריחה"},{key:"after_school",label:"After School"}],F=Object.fromEntries(b.map(t=>[t.key,t.label]));function C(t){const s=String(t||"").trim().toLowerCase().replace(/[\s_\-]+/g,"");return["course","courses","קורס","קורסים"].includes(s)?"course":["workshop","workshops","סדנה","סדנאות"].includes(s)?"workshop":["escaproom","escaperoom","escape_room","חדרבריחה","חדריבריחה"].includes(s)?"escape_room":["afterschool","after_school","אפטרסקול","חוגאפטרסקול"].includes(s)?"after_school":"other"}function H(t={}){const e=[];$(t)||e.push("no_price"),String(t.funding||"").trim()||e.push("no_funding"),String(t.activity_type||"").trim()||e.push("no_activity_type"),String(t.activity_season||t.season||"").trim()||e.push("no_season"),x(t)&&!$(t)&&e.push("closed_no_price");const s=S(t);return s>0&&isNaN(s)&&e.push("invalid_price"),[...new Set(e)]}const O={no_price:"ללא מחיר",no_funding:"ללא גורם מימון",no_activity_type:"ללא סוג פעילות",no_season:"ללא עונה",closed_no_price:"סגורה ללא מחיר",invalid_price:"מחיר לא תקין"};function D(t){return O[t]||t}function L(t=[]){const e={};for(const s of t){const c=C(s.activity_type),n=String(s.funding||"").trim()||"ללא מימון",i=String(s.authority||"").trim()||"—",a=String(s.school||"").trim()||"—";let o;n==="גפ״ן"||n==="גפ'ן"||n==="גפן"?o=a:n==="רשות"?o=i:o=n,e[c]||(e[c]={}),e[c][n]||(e[c][n]={}),e[c][n][o]||(e[c][n][o]=[]),e[c][n][o].push(s)}return e}function y(t=[]){let e=0,s=0,c=0,n=0,i=0,a=0,o=0,d=0;for(const r of t){e++;const f=S(r);o+=f,x(r)?a++:i++,$(r)||n++,k(r)?(s++,d+=f):c++}return{total:e,collected:s,notCollected:c,noPrice:n,open:i,closed:a,totalPrice:o,collectedPrice:d}}function u(t,e,s=""){return`<div class="ds-fin-kpi">
    <div class="ds-fin-kpi__val">${l(String(e))}</div>
    <div class="ds-fin-kpi__label">${l(t)}</div>
    ${s?`<div class="ds-fin-kpi__sub">${l(s)}</div>`:""}
  </div>`}function B(t){return`<div class="ds-fin-kpis">
    ${u("סה״כ",t.total)}
    ${u("ללא מחיר",t.noPrice)}
    ${u("נגבו",t.collected,t.collectedPrice?_(t.collectedPrice):"")}
    ${u("יתרה לגבייה",t.notCollected)}
    ${u("פתוחות",t.open)}
    ${u("סגורות",t.closed)}
    ${u("סך מחיר","",_(t.totalPrice))}
  </div>`}function Y(t,e=!1){const s=l(j(t)),c=S(t),n=k(t),i=x(t),o=H(t).map(D).join(", "),d=l(R(h(t))||h(t)||"—"),r=n?"נגבה":"לא נגבה",f=n?"ds-fin-badge--collected":"ds-fin-badge--not-collected",p=i?"סגורה":"פתוחה",m=i?"ds-fin-badge--closed":"ds-fin-badge--open";return`<tr class="ds-fin-row" data-fin-row-id="${s}">
    <td class="ds-fin-col--name">${l(t.activity_name||"—")}</td>
    <td class="ds-fin-col--type">${l(F[C(t.activity_type)]||t.activity_type||"—")}</td>
    <td class="ds-fin-col--date" style="text-align:center">${d}</td>
    <td class="ds-fin-col--school">${l(String(t.school||"—"))}</td>
    <td class="ds-fin-col--price" style="text-align:left">${c?l(_(c)):"—"}</td>
    <td class="ds-fin-col--collect">
      <span class="ds-fin-badge ${f}">${r}</span>
      ${e?`<button type="button" class="ds-fin-toggle-btn ds-btn ds-btn--xs ds-btn--ghost" data-fin-toggle-collect="${s}">${n?"בטל גבייה":"סמן כנגבה"}</button>`:""}
    </td>
    <td class="ds-fin-col--status"><span class="ds-fin-badge ${m}">${p}</span></td>
    <td class="ds-fin-col--exc">${o?l(o):""}</td>
  </tr>`}function V(t,e,s,c,n=!1){const i=y(e),a=t,d=`<table class="ds-fin-table" dir="rtl">
    <thead><tr>
      <th class="ds-fin-col--name">שם פעילות</th>
      <th class="ds-fin-col--type">סוג</th>
      <th class="ds-fin-col--date" style="text-align:center">תאריך</th>
      <th class="ds-fin-col--school">בית ספר</th>
      <th class="ds-fin-col--price">מחיר</th>
      <th class="ds-fin-col--collect">גבייה</th>
      <th class="ds-fin-col--status">סטטוס</th>
      <th class="ds-fin-col--exc">חריגה</th>
    </tr></thead>
    <tbody>${e.slice().sort((f,p)=>String(h(f)).localeCompare(String(h(p)))).map(f=>Y(f,!0)).join("")}</tbody>
  </table>`,r=`${i.total} פעילויות · ${i.collected} נגבו · ${i.notCollected} לא נגבו · ${i.noPrice} ללא מחיר · ${_(i.totalPrice)}`;return`<details class="ds-fin-acc ds-fin-acc--cluster"${n?" open":""} data-fin-cluster="${l(s)}|${l(t)}|${l(c)}">
    <summary class="ds-fin-acc__summary">
      <span class="ds-fin-acc__title">${l(a)}</span>
      <span class="ds-fin-acc__meta">${l(r)}</span>
    </summary>
    <div class="ds-fin-acc__body">${d}</div>
  </details>`}function z(t,e,s){const c=Object.values(e).flat(),n=y(c),o=t==="גפ״ן"||t==="גפ'ן"||t==="גפן"?"בתי ספר":t==="רשות"?"רשויות":"גורם ריכוז",d=Object.keys(e).length,r=`${n.total} פעילויות · ${d} ${o} · ${_(n.totalPrice)}`,f=Object.entries(e).sort(([p],[m])=>p.localeCompare(m,"he")).map(([p,m])=>V(p,m,t,s)).join("");return`<details class="ds-fin-acc ds-fin-acc--funding" data-fin-funding="${l(t)}|${l(s)}">
    <summary class="ds-fin-acc__summary">
      <span class="ds-fin-acc__title">${l(t)}</span>
      <span class="ds-fin-acc__meta">${l(r)}</span>
    </summary>
    <div class="ds-fin-acc__body">${f}</div>
  </details>`}function G(t=[]){const e=new Map;for(const n of t){const i=String(n.activity_name||"").trim()||"ללא שם";e.has(i)||e.set(i,[]),e.get(i).push(n)}return e.size?`<details class="ds-fin-acc ds-fin-acc--programs">
    <summary class="ds-fin-acc__summary"><span class="ds-fin-acc__title">סיכום לפי שמות תוכניות</span></summary>
    <div class="ds-fin-acc__body">
      <table class="ds-fin-table" dir="rtl">
        <thead><tr>
          <th>שם פעילות / תוכנית</th>
          <th style="text-align:center">כמות</th>
          <th>סך מחיר</th>
          <th style="text-align:center">ללא מחיר</th>
          <th style="text-align:center">נגבו</th>
          <th style="text-align:center">לא נגבו</th>
          <th style="text-align:center">סטטוס</th>
        </tr></thead>
        <tbody>${[...e.entries()].sort(([,n],[,i])=>i.length-n.length).map(([n,i])=>{const a=y(i);return`<tr>
      <td>${l(n)}</td>
      <td style="text-align:center">${a.total}</td>
      <td style="text-align:left">${a.totalPrice?l(_(a.totalPrice)):"—"}</td>
      <td style="text-align:center">${a.noPrice}</td>
      <td style="text-align:center">${a.collected}</td>
      <td style="text-align:center">${a.notCollected}</td>
      <td style="text-align:center">${a.open} פתוחות / ${a.closed} סגורות</td>
    </tr>`}).join("")}</tbody>
      </table>
    </div>
  </details>`:""}function N(t,e,s,c){const n=y(c),i=Object.entries(s).sort(([o],[d])=>o.localeCompare(d,"he")).map(([o,d])=>z(o,d,t)).join(""),a=G(c);return`<details class="ds-fin-acc ds-fin-acc--type" data-fin-type="${l(t)}">
    <summary class="ds-fin-acc__summary ds-fin-acc__summary--type">
      <span class="ds-fin-acc__title ds-fin-acc__title--type">${l(e)}</span>
      <span class="ds-fin-acc__meta">${n.total} פעילויות · ${_(n.totalPrice)}</span>
    </summary>
    <div class="ds-fin-acc__body">
      ${B(n)}
      ${a}
      ${i}
    </div>
  </details>`}function q(t=[]){const e=y(t),s=t.reduce((c,n)=>c+H(n).length,0);return`<div class="ds-fin-top-kpis" dir="rtl">
    <div class="ds-fin-kpi-group">
      <div class="ds-fin-kpi-group__label">גבייה וכספים</div>
      <div class="ds-fin-kpi-group__items">
        ${u("סה״כ פעילויות",e.total)}
        ${u("נגבו",e.collected,_(e.collectedPrice))}
        ${u("יתרה לגבייה",e.notCollected)}
        ${u("סך מחיר","",_(e.totalPrice))}
        ${u("חריגות",s)}
      </div>
    </div>
    <div class="ds-fin-kpi-group">
      <div class="ds-fin-kpi-group__label">פעילות</div>
      <div class="ds-fin-kpi-group__items">
        ${u("פתוחות",e.open)}
        ${u("סגורות",e.closed)}
        ${u("טרם תומחרו",e.noPrice)}
      </div>
    </div>
  </div>`}const X={load:({api:t})=>t.allActivities(),render(t,{state:e}={}){if(!A(e==null?void 0:e.user))return w(`${P("כספים","גישה מוגבלת")} ${T("אין הרשאה לצפייה בעמוד כספים.")}`);const s=Array.isArray(t==null?void 0:t.rows)?t.rows:[],c=L(s);y(s);const n=b.map(({key:r,label:f})=>{const p=c[r];if(!p)return"";const m=Object.values(p).flatMap(g=>Object.values(g)).flat();return N(r,f,p,m)}).join(""),i=new Set(b.map(r=>r.key)),a=s.filter(r=>!i.has(C(r.activity_type))),o=a.length>0?N("other","אחר",L(a).other||{},a):"",d=`
      ${q(s)}
      <div class="ds-fin-accordions" dir="rtl">
        ${n}
        ${o}
      </div>`;return w(`
      ${P("כספים / גבייה","בקרה כספית לפי פעילויות, סוגי תוכניות וסטטוס גבייה")}
      ${E({body:d,padded:!0})}
    `)},bind({root:t,data:e,state:s,api:c,rerender:n}){if(!A(s==null?void 0:s.user))return;const i=Array.isArray(e==null?void 0:e.rows)?e.rows:[],a=new Map(i.map(o=>[j(o),o]));t.addEventListener("click",async o=>{const d=o.target.closest("[data-fin-toggle-collect]");if(!d)return;const r=String(d.dataset.finToggleCollect||""),f=a.get(r);if(!f)return;d.disabled=!0;const m=!k(f)?"yes":"no";try{await c.saveActivity({source_row_id:r,source_sheet:"activities",changes:{payment_collected:m}}),f.payment_collected=m,n==null||n()}catch(g){console.error("[finance] toggle collect failed",g)}finally{d.disabled=!1}})}};export{X as financeScreen};
