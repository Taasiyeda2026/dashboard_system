import{B as y,q as I,j as x,a6 as B,a3 as F,ac as q,i as a,x as G,z as O}from"./index-CH0LFGSL.js";function k(t){return t==="pending"?"ממתין":t==="approved"?"אושר":t==="rejected"?"נדחה":t==="conflict"?"קונפליקט":t||"—"}function C(t){return t==="approved"?"success":t==="rejected"||t==="conflict"?"danger":t==="pending"?"warning":"neutral"}function u(t){const r=String(t||"").trim();if(!r)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(r)){const[s,n,d]=r.split("-");return`${d}/${n}/${s}`}const e=Date.parse(r);if(!Number.isNaN(e)){const s=new Date(e),n=String(s.getDate()).padStart(2,"0"),d=String(s.getMonth()+1).padStart(2,"0"),c=s.getFullYear();return`${n}/${d}/${c}`}return r}function V(t){const r=String(t||"").trim();if(!r)return"שדה";if(r==="status")return"סטטוס פעילות";const e=/^date_(\d+)$/.exec(r);return e?`מפגש ${Number(e[1])}`:O(r)}function h(t,r){const e=String(r??"").trim();if(!e)return"";const s=String(t||"");if(s==="start_date"||s==="end_date"||/^date_\d+$/.test(s))return u(e)||e;if(s==="activity_type"){const n=q(e);return n&&n!=="לא מסווג"?n:e}return e}function z(t,r,e){const s=String(r??"").trim(),n=String(e??"").trim(),d=s?h(t,s):"",c=n?h(t,n):"";return{oldHtml:d?a(d):'<span class="ds-muted">לא הוגדר</span>',newHtml:c?a(c):'<span class="ds-muted">נמחק / ריק</span>'}}function v(t){if(!t)return"—";const r=String(t.instructor_name||"").trim(),e=String(t.instructor_name_2||"").trim(),s=String(t.emp_id||"").trim(),n=String(t.emp_id_2||"").trim(),d=[];return(r||s)&&d.push(r?s?`${r} (${s})`:r:s),(e||n)&&d.push(e?n?`${e} (${n})`:e:n),d.length?d.join(" · "):"—"}function S(t){return String(t||"")==="create_activity"?"בקשה להוספת פעילות":"בקשת עריכה"}function M(t,r){var p,_,f,$;const e=t.activity||null,s=String(t.request_type||"")==="create_activity",n=!!e,d=String(t.activity_name||(e==null?void 0:e.activity_name)||"").trim()||"פעילות ללא שם",c=String(t.source_row_id||"").trim(),i=String((s?(p=t==null?void 0:t.requested_payload)==null?void 0:p.activity_type:e==null?void 0:e.activity_type)||"").trim(),o=i?(()=>{const l=q(i);return l&&l!=="לא מסווג"?l:i})():"—",m=String(t.authority||(e==null?void 0:e.authority)||"").trim()||"—",w=String(t.school||(e==null?void 0:e.school)||"").trim()||"—",b=String((s?(_=t==null?void 0:t.requested_payload)==null?void 0:_.activity_manager:e==null?void 0:e.activity_manager)||"").trim()||"—",j=u(String((s?(f=t==null?void 0:t.requested_payload)==null?void 0:f.start_date:e==null?void 0:e.start_date)||"").trim()),A=u(String((s?($=t==null?void 0:t.requested_payload)==null?void 0:$.end_date:e==null?void 0:e.end_date)||"").trim()),H=[j,A].filter(Boolean).join(" — ")||"—",E=!n&&!s?'<div class="ds-er-warn" role="alert">לא נמצאו פרטי פעילות מלאים לבדיקה — לא ניתן לאשר עד שנטענת הפעילות מהמערכת.</div>':"",R=(t.fields||[]).map(l=>{const{oldHtml:L,newHtml:N}=z(l.field_name,l.old_value,l.new_value);return`
    <tr>
      <td class="ds-er-field-name">${a(V(l.field_name))}</td>
      <td class="ds-er-old">${L}</td>
      <td class="ds-er-arrow">→</td>
      <td class="ds-er-new">${N}</td>
    </tr>`}).join(""),D=r&&t.status==="pending"&&t.can_approve!==!1?`
    <div class="ds-er-actions">
      <button type="button" class="ds-btn ds-btn--success ds-btn--sm" data-action="approve" data-request-id="${a(t.request_id)}">אישור</button>
      <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-action="reject" data-request-id="${a(t.request_id)}">דחייה</button>
    </div>
  `:"",T=t.review_note?`
    <p class="ds-er-reviewer-note"><span class="ds-muted">הערת סוקר:</span> ${a(t.review_note)}</p>
  `:"";return`
    <article class="ds-er-group" data-status="${a(t.status||"")}" data-request-id="${a(t.request_id)}">
      <header class="ds-er-card-head">
        <h3 class="ds-er-card-title">${a(S(t.request_type))}: ${a(d)}</h3>
        <div>${G(k(t.status),C(t.status))}</div>
      </header>
      <div class="ds-er-meta-grid" dir="rtl">
        <p><span class="ds-muted">מזהה:</span> <strong>${a(c||(s?"ייווצר באישור":"—"))}</strong></p>
        <p><span class="ds-muted">סוג בקשה:</span> ${a(S(t.request_type))}</p>
        <p><span class="ds-muted">סוג פעילות:</span> ${a(o)}</p>
        <p><span class="ds-muted">רשות:</span> ${a(m)}</p>
        <p><span class="ds-muted">בית ספר:</span> ${a(w)}</p>
        <p><span class="ds-muted">מנהל פעילות:</span> ${a(b)}</p>
        <p><span class="ds-muted">מדריך:</span> ${a(v(s?t.requested_payload||{}:e))}</p>
        <p><span class="ds-muted">תאריכי התחלה–סיום:</span> ${a(H)}</p>
      </div>
      <p class="ds-er-requester-line" dir="rtl">
        <span class="ds-muted">נשלח על ידי:</span>
        ${a(t.requested_by_name||t.requested_by_user_id||"—")}
        <span class="ds-muted"> · בתאריך </span>
        ${a(u(t.requested_at)||String(t.requested_at||"—"))}
      </p>
      ${E}
      <h4 class="ds-er-section-title">${s?"פרטי הפעילות המבוקשת":"מה השתנה?"}</h4>
      <div class="ds-table-wrap ds-er-fields-wrap">
        <table class="ds-table ds-er-fields-table">
          <thead>
            <tr>
              <th>שדה</th>
              <th>${s?"פרט":"ערך נוכחי"}</th>
              <th></th>
              <th>${s?"ערך":"ערך מבוקש"}</th>
            </tr>
          </thead>
          <tbody>${R}</tbody>
        </table>
      </div>
      ${T}
      ${D}
    </article>
  `}const P=new Set(["approved","rejected"]);function U(t){return!P.has(String((t==null?void 0:t.status)||"").trim())}const K={load:({api:t})=>t.editRequests(),render(t){const e=(Array.isArray(t==null?void 0:t.groups)?t.groups:[]).filter(i=>String((i==null?void 0:i.request_type)||"")==="create_activity"||Array.isArray(i==null?void 0:i.fields)&&i.fields.length>0),s=!!(t!=null&&t.canReview),n=e.filter(U),d=n.length===0?I("אין בקשות פתוחות כרגע"):n.map(i=>M(i,s)).join("");return x(`
      ${B("בקשות פעילות",s?"בקשות פעילות הממתינות לאישורך":"בקשות פעילות שהגשת")}
      ${F({title:`בקשות פתוחות (${n.length})`,padded:!1,body:`<div class="ds-er-list" data-er-list>${d}</div>`})}
    `)},bind({root:t,api:r,rerender:e,clearScreenDataCache:s}){t&&t.querySelectorAll("[data-action]").forEach(n=>{n.addEventListener("click",async()=>{const d=n.dataset.action,c=n.dataset.requestId;if(!c||!d)return;const i=d==="approve"?"approved":"rejected";n.disabled=!0;try{await r.reviewEditRequest(c,i);const o=n.closest(".ds-er-group");o==null||o.remove(),s==null||s();try{document.dispatchEvent(new CustomEvent("app:edit-requests-updated"))}catch{}y(i==="approved"?"הבקשה אושרה והשינוי נשמר בפעילויות":"הבקשה נדחתה","success"),e==null||e()}catch(o){n.disabled=!1,y(o.message||"שגיאה בעיבוד הבקשה","error")}})})}};export{K as editRequestsScreen};
