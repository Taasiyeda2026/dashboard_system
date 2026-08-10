import{a2 as f,i as c,n as x,q as D,j as E,a3 as M,h as y,a4 as C}from"./index-CH0LFGSL.js";const T=new Set(["course","after_school"]);function I(t){const e=C((t==null?void 0:t.activity_type)||(t==null?void 0:t.item_type)||(t==null?void 0:t.type));return T.has(e)}function _(t){const e=String(t||"").trim().slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(e)?e:""}function L(t){const[e,a]=t.split("-").map(s=>Number(s));return new Date(Date.UTC(e,a-1,1)).toLocaleDateString("he-IL",{month:"long",year:"numeric",timeZone:"UTC"})}function j(t){const e=Array.isArray(t==null?void 0:t.meeting_dates)?t.meeting_dates.map(n=>_(n)).filter(Boolean):[];if(e.length)return{dates:e,source:"meetings"};const a=Array.isArray(t==null?void 0:t.date_cols)?t.date_cols.map(n=>_(n)).filter(Boolean):[];return a.length?{dates:a,source:"cols"}:{dates:[],source:"none"}}function B(t){const e=String(t||"").trim().toLowerCase();return e==="סגור"||e==="closed"||e==="inactive"}function $(){const t=new Date,e=t.getFullYear(),a=String(t.getMonth()+1).padStart(2,"0"),n=String(t.getDate()).padStart(2,"0");return`${e}-${a}-${n}`}function S(t,e=""){const a=String(e||"").trim(),n=$();return t.map(s=>{if(!I(s))return null;const r=_(s==null?void 0:s.end_date)||_(s==null?void 0:s.date_end);if(!r||B(s==null?void 0:s.status)||r<n||a&&String((s==null?void 0:s.activity_manager)||"").trim()!==a)return null;const{dates:d,source:l}=j(s);return{...s,end_date:r,_dates:d,_dateSource:l}}).filter(Boolean).sort((s,r)=>{if(s.end_date!==r.end_date)return s.end_date.localeCompare(r.end_date);const d=String(s.school||"").localeCompare(String(r.school||""),"he");return d!==0?d:String(s.activity_name||"").localeCompare(String(r.activity_name||""),"he")})}function b(t){const e=new Map;return t.forEach(a=>{const n=a.end_date.slice(0,7);e.has(n)||e.set(n,{key:n,label:L(`${n}-01`),rows:[]}),e.get(n).rows.push(a)}),[...e.values()].sort((a,n)=>a.key.localeCompare(n.key))}function F(t,e){const a=t.rows.map((n,s)=>{const r=`ed-${e}-${s}`,d=n._dates||[],l=d.length?d.map(u=>`<span class="ds-end-dates__date-pill">${c(y(u))}</span>`).join(""):'<span class="ds-end-dates__muted">לא נמצאו תאריכי מפגש.</span>';return`<tr class="ds-end-row" data-end-row="${c(r)}">
        <td class="ds-end-td ds-end-td--name">${c(String(n.activity_name||"—"))}</td>
        <td class="ds-end-td">${c(String(n.school||"—"))}</td>
        <td class="ds-end-td">${c(String(n.authority||"—"))}</td>
        <td class="ds-end-td ds-end-td--date"><time>${c(y(n.end_date))}</time></td>
        <td class="ds-end-td ds-end-td--actions">
          <button type="button" class="ds-end-export-btn" data-end-export="${c(r)}" title="ייצוא שורה זו לאקסל" aria-label="ייצוא לאקסל">⬇</button>
        </td>
      </tr>
      <tr class="ds-end-expand-row" id="ds-end-expand-${c(r)}" hidden>
        <td colspan="5" class="ds-end-expand-td">
          <div class="ds-end-dates__dates-list">${l}</div>
          <div class="ds-end-expand-meta">
            <span><strong>מנהל פעילויות:</strong> ${c(x(n.activity_manager))}</span>
            <span><strong>מדריך:</strong> ${c(String(n.instructor_name||"").trim()||"ללא")}${String(n.instructor_name_2||"").trim()?` · ${c(String(n.instructor_name_2).trim())}`:""}</span>
          </div>
        </td>
      </tr>`}).join("");return`<section class="ds-end-dates__month-group" dir="rtl">
    <h3 class="ds-end-dates__month-title">
      ${c(t.label)}
      <span class="ds-end-dates__month-count">${t.rows.length}</span>
    </h3>
    <table class="ds-end-table ds-end-table--compact" dir="rtl">
      <colgroup>
        <col class="ds-end-col--name">
        <col class="ds-end-col--school">
        <col class="ds-end-col--authority">
        <col class="ds-end-col--date">
        <col class="ds-end-col--actions">
      </colgroup>
      <thead><tr>
        <th class="ds-end-th ds-end-th--name">שם פעילות</th>
        <th class="ds-end-th ds-end-th--school">בית ספר</th>
        <th class="ds-end-th ds-end-th--auth">רשות</th>
        <th class="ds-end-th ds-end-th--date">תאריך סיום</th>
        <th class="ds-end-th ds-end-th--actions"></th>
      </tr></thead>
      <tbody>${a}</tbody>
    </table>
  </section>`}function v(t){const e=t.reduce((d,l)=>Math.max(d,Array.isArray(l==null?void 0:l._dates)?l._dates.length:0),0),n=["שם פעילות","בית ספר","רשות","תאריך סיום",...Array.from({length:e},(d,l)=>`תאריך ${l+1}`)],s=t.map(d=>{const l=Array.from({length:e},(u,i)=>{var h;const o=(h=d==null?void 0:d._dates)==null?void 0:h[i];return`<td>${c(o?y(o):"")}</td>`}).join("");return`<tr>
      <td>${c(String(d.activity_name||""))}</td>
      <td>${c(String(d.school||""))}</td>
      <td>${c(String(d.authority||""))}</td>
      <td>${c(y(d.end_date))}</td>
      ${l}
    </tr>`}).join(""),r=`<!doctype html><html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"></head><body>
    <table border="1"><thead><tr>${n.map(d=>`<th>${c(d)}</th>`).join("")}</tr></thead>
    <tbody>${s}</tbody></table></body></html>`;return new Blob(["\uFEFF"+r],{type:"application/vnd.ms-excel;charset=utf-8"})}const R={load:({api:t})=>t.endDates(),render(t,{state:e}){const a=Array.isArray(t==null?void 0:t.rows)?t.rows:[],n=String((e==null?void 0:e.endDatesManager)||(t==null?void 0:t.selectedManager)||""),s=S(a,n),r=Array.from(new Set(a.map(i=>String((i==null?void 0:i.activity_manager)||"").trim()).filter(Boolean))).sort((i,o)=>i.localeCompare(o,"he")),d=b(s),l=`<div class="ds-end-dates__head-tools">
      <label class="ds-end-dates__manager-filter"><span>מנהל פעילויות</span><select class="ds-input ds-input--sm" data-end-manager>
        <option value="">כל מנהלי הפעילויות</option>
        ${r.map(i=>`<option value="${c(i)}"${n===i?" selected":""}>${c(x(i))}</option>`).join("")}
      </select></label>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-end-dates-export title="ייצוא כל הפעילויות לאקסל" aria-label="ייצוא הכל לאקסל">↓ ייצוא הכל</button>
    </div>`,u=d.length?`<div class="ds-end-dates__months">${d.map((i,o)=>F(i,o)).join("")}</div>`:D("אין פעילויות פעילות להצגה");return E(`
      <section class="ds-end-dates-screen" dir="rtl">
        <h1 class="ds-end-dates-page-title">תאריכי סיום פעילויות</h1>
        ${M({body:`${l}${u}`,padded:!0})}
      </section>`)},bind({root:t,data:e,state:a,rerender:n}){var u,i;const s=String((a==null?void 0:a.endDatesManager)||(e==null?void 0:e.selectedManager)||""),r=S(Array.isArray(e==null?void 0:e.rows)?e.rows:[],s),d=b(r),l=new Map;d.forEach((o,h)=>{o.rows.forEach((p,m)=>l.set(`ed-${h}-${m}`,p))}),(u=t.querySelector("[data-end-dates-export]"))==null||u.addEventListener("click",()=>{const o=$();f(v(r),`תאריכי_סיום_${o}.xls`)}),t.querySelectorAll("[data-end-row]").forEach(o=>{o.addEventListener("click",h=>{if(h.target.closest("[data-end-export]"))return;const p=o.dataset.endRow,m=document.getElementById(`ds-end-expand-${p}`);if(!m)return;const g=!m.hidden;m.hidden=g,o.classList.toggle("is-expanded",!g)})}),t.querySelectorAll("[data-end-export]").forEach(o=>{o.addEventListener("click",h=>{h.stopPropagation();const p=o.dataset.endExport,m=l.get(p);if(!m)return;const g=String(m.activity_name||"פעילות").replace(/[/\\?%*:|"<>]/g,"_").slice(0,40),A=$();f(v([m]),`${g}_${A}.xls`)})}),(i=t.querySelector("[data-end-manager]"))==null||i.addEventListener("change",o=>{e.selectedManager=o.target.value||"",a.endDatesManager=e.selectedManager,n()})}};export{R as endDatesScreen};
