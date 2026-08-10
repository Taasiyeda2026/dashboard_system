import{ad as E,B as h,ae as L,q as W,j as C,a6 as M,i as f,af as S,x as F,z as O,ag as j}from"./index-CH0LFGSL.js";const U=["admin","operation_manager","authorized_user","instructor","finance","activities_manager","domain_manager","business_development_manager","instructor_manager"];function B(s=""){const t=String(s||"").trim();return U.map(d=>{const i=d===t?" selected":"";return`<option value="${f(d)}"${i}>${f(j(d))}</option>`}).join("")}function w(s){return String((s==null?void 0:s.role)!=null&&s.role!==""?s.role:(s==null?void 0:s.display_role)||"").trim()}function T(s){const t=String((s==null?void 0:s.display_role)||"").trim(),d=w(s);return t&&(!d||t.toLowerCase()!==d.toLowerCase())?t:j(d)}function H(s,t){if(s==="admin")return'<p class="ds-perm-section-label ds-perm-section-label--sub" style="margin-top:var(--space-2,8px)">ברירת מחדל: כל ההרשאות (מנהל/ת מערכת)</p>';const d=t&&t[s]?t[s]:{},i=Object.keys(d).filter(r=>d[r]==="yes");return i.length===0?'<p class="ds-perm-section-label ds-perm-section-label--sub ds-muted" style="margin-top:var(--space-2,8px)">ברירת מחדל: ללא הרשאות</p>':`<div style="margin-top:var(--space-2,8px)">
    <p class="ds-perm-section-label ds-perm-section-label--sub">ברירת מחדל לתפקיד זה:</p>
    <div class="ds-perm-flag-grid" style="margin-top:var(--space-1,4px)">${i.map(r=>`<span class="ds-perm-flag ds-perm-flag--on" title="${f(S(r))}">${f(S(r))}</span>`).join("")}</div>
  </div>`}function R(s){const t=Object.keys(s).filter(i=>i==="user_id"||i==="role"||i==="display_role"||i==="view_finance"?!1:i==="entry_code"||i==="full_name"||i==="display_role2"||i==="default_view"||i.startsWith("view_")||i.startsWith("can_")||i==="finance_access"),d=i=>i==="entry_code"?10:i==="full_name"?20:i==="display_role2"?30:i==="default_view"?40:i.startsWith("view_")?100:i.startsWith("can_")?200:300;return t.sort((i,u)=>d(i)-d(u)||i.localeCompare(u)),t}function N(s){return`<div class="ds-perm-edit-form" dir="rtl">
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">פרטי משתמש חדש</p>
      <div class="ds-perm-field">
        <span class="ds-muted">מזהה משתמש</span>
        <input type="text" class="ds-input ds-input--sm" id="new-user-id" placeholder="user_id" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">שם מלא</span>
        <input type="text" class="ds-input ds-input--sm" id="new-full-name" placeholder="שם מלא" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">קוד כניסה</span>
        <input type="text" class="ds-input ds-input--sm" id="new-entry-code" placeholder="קוד כניסה" />
      </div>
      <div class="ds-perm-field">
        <span class="ds-muted">תפקיד</span>
        <select class="ds-input ds-input--sm" id="new-display-role">
          ${B("instructor")}
        </select>
      </div>
      <div data-role-preview>${H("instructor",s)}</div>
    </div>
    <div class="ds-perm-actions">
      <button type="button" class="ds-btn ds-btn--primary" data-add-user-submit>הוספה</button>
      <p class="ds-perm-save-status ds-muted" role="status" aria-live="polite"></p>
    </div>
  </div>`}function z(s){s={view_proposals:"no",view_israa_management:"no",...s};const t=f(s.user_id),d=R(s),i=d.filter(p=>!p.startsWith("view_")&&!p.startsWith("can_")).map(p=>{const e=f(String(s[p]??"")),c=`data-perm-field="${f(p)}" data-user-id="${t}"`;return`<div class="ds-perm-field">
        <span class="ds-muted">${f(S(p))}</span>
        <input type="text" class="ds-input ds-input--sm" ${c} value="${e}" />
      </div>`}).join(""),u=d.filter(p=>p.startsWith("view_")),r=d.filter(p=>p.startsWith("can_"));function m(p,e){if(p.length===0)return"";const c=p.map(o=>{const n=String(s[o]||"").toLowerCase()==="yes";return`<label class="ds-perm-check">
        <input type="checkbox" ${`data-perm-field="${f(o)}" data-user-id="${t}"`} ${n?"checked":""} />
        ${f(S(o))}
      </label>`}).join("");return`<div class="ds-perm-bool-group">
      <p class="ds-perm-section-label ds-perm-section-label--sub">${f(e)}</p>
      <div class="ds-perm-bool-grid">${c}</div>
    </div>`}return`<div class="ds-perm-edit-form" dir="rtl">
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">פרטי משתמש</p>
      <div class="ds-perm-field">
        <span class="ds-muted">${f(O("display_role"))}</span>
        <select data-role-select data-user-id="${t}" class="ds-input ds-input--sm">
          ${B(w(s))}
        </select>
      </div>
      <div class="ds-perm-field">
        <label class="ds-perm-check">
          <input type="checkbox" data-active-toggle data-user-id="${t}" ${String(s.active||"").toLowerCase()==="yes"?"checked":""} />
          פעיל/ה
        </label>
      </div>
      ${i}
    </div>
    <div class="ds-perm-edit-section">
      <p class="ds-perm-section-label">הרשאות גישה</p>
      ${m(u,"צפייה במסכים")}
      ${m(r,"פעולות מותרות")}
    </div>
    <div class="ds-perm-actions">
      <button type="button" class="ds-btn ds-btn--primary" data-save-permission data-user-id="${t}">שמירה</button>
      <p class="ds-perm-save-status ds-muted" role="status" aria-live="polite"></p>
    </div>
  </div>`}const P='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4h6v2"/></svg>';function G(s,t,d,i,u){const r=f(s.user_id);w(s);const m=T(s),p=String(s.active||"").toLowerCase()==="yes",e=p?"פעיל/ה":"לא פעיל/ה",c=String(s.user_id)===String(i),o=String(s.username_display||s.username||"").trim()||"לא הוגדר",n=s.user_id?f(String(s.user_id)):"—",a=t?`<button type="button" class="ds-btn ds-btn--sm" data-edit-perm data-user-id="${r}" title="עריכת הרשאות">עריכה</button>`:"",l=`<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-view-perm data-user-id="${r}" title="צפייה בהרשאות">הרשאות</button>`,y=d&&p&&!c?`<button type="button" class="ds-btn ds-btn--sm ds-btn--danger" data-deactivate-user data-user-id="${r}">השבת</button>`:"",v=d&&!p?`<button type="button" class="ds-btn ds-btn--sm ds-btn--success" data-reactivate-user data-user-id="${r}">הפעל</button>`:"",g=u===1&&w(s)==="admin",_=d&&!p?g?`<button type="button" class="ds-perm-delete-btn" disabled title="לא ניתן למחוק את מנהל המערכת האחרון" aria-label="לא ניתן למחוק">${P}</button>`:`<button type="button" class="ds-perm-delete-btn" data-delete-user data-user-id="${r}" title="מחיקת משתמש" aria-label="מחיקת משתמש">${P}</button>`:"",$=[a,l,y,v,_].filter(Boolean).join(" ");return`<tr class="ds-perm-row" data-perm-user="${r}">
    <td style="font-weight:600;">${f(s.full_name||r)}</td>
    <td>${f(o)}</td>
    <td class="ds-muted">${n}</td>
    <td>${f(m)}</td>
    <td>${f(e)}</td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${$}</div></td>
  </tr>`}function K(s){const t=R(s).filter(m=>m.startsWith("view_")||m.startsWith("can_")),d=[{label:"לוח בקרה",keys:["view_admin"]},{label:"פעילויות",keys:["view_activities","can_add_activity","can_edit_direct","can_request_edit","can_request_edit_2","can_request_create_activity","can_review_requests","can_review_requests_2"]},{label:"קטלוג",keys:["view_catalog"]},{label:"הזמנות",keys:["view_orders"]},{label:"ארכיון",keys:["view_archive"]},{label:"הצעות מחיר",keys:["view_proposals"]},{label:"אנשי קשר",keys:["view_contacts"]},{label:"אישורים",keys:["view_approvals"]},{label:"הרשאות",keys:["view_permissions"]},{label:"ניהול איסראא",keys:["view_israa_management"]},{label:"ניהול משתמשים",keys:["view_user_management"]},{label:"נתונים אישיים",keys:["view_profile"]}],i=new Set(d.flatMap(m=>m.keys)),u=t.filter(m=>!i.has(m));return u.length&&d.push({label:"הרשאות נוספות",keys:u}),`<div class="ds-perm-details" dir="rtl">${d.map(m=>{const p=m.keys.filter(e=>t.includes(e)).map(e=>{const c=String(s[e]||"").toLowerCase()==="yes";return`<div class="ds-perm-detail-item">
            <span>${f(S(e))}</span>
            ${F(c?"מאופשר":"חסום",c?"success":"neutral")}
          </div>`}).join("");return p?`<section class="ds-perm-detail-section">
        <h4 class="ds-perm-detail-title">${m.label}</h4>
        <div class="ds-perm-detail-grid">${p}</div>
      </section>`:""}).filter(Boolean).join("")||'<p class="ds-muted">לא נמצאו הרשאות להצגה.</p>'}</div>`}const J={load:({api:s})=>s.permissions(),render(s,{state:t}){var c,o,n;const d=((c=t==null?void 0:t.user)==null?void 0:c.display_role)==="admin"||((o=t==null?void 0:t.user)==null?void 0:o.display_role)==="operation_manager",i=((n=t==null?void 0:t.user)==null?void 0:n.display_role)==="admin",u=Array.isArray(s==null?void 0:s.rows)?s.rows:[],r=u.filter(a=>w(a)==="admin").length,m=u.map(a=>{var l;return G(a,d,i,(l=t==null?void 0:t.user)==null?void 0:l.user_id,r)}).join(""),p=u.length===0?W("לא נמצאו שורות הרשאה"):`<div class="ds-table-wrap ds-perm-table-wrap" dir="rtl"><table class="ds-table ds-perm-table">
            <thead><tr><th>שם</th><th>שם משתמש</th><th>קוד עובד</th><th>תפקיד</th><th>סטטוס</th><th style="text-align:start;">פעולות</th></tr></thead>
            <tbody>${m}</tbody>
          </table></div>`,e=i?`<div style="margin:8px 0 12px;display:flex;justify-content:flex-end;">
           <button type="button" class="ds-btn ds-btn--primary" data-open-add-user>+ הוסף משתמש</button>
         </div>`:"";return C(`
      <section class="ds-perm-screen">
        ${M("משתמשים והרשאות","")}
        ${e}
        ${p}
      </section>
    `)},bind({root:s,data:t,api:d,ui:i,rerender:u,clearScreenDataCache:r}){const m=Array.isArray(t==null?void 0:t.rows)?t.rows:[];s.querySelectorAll("[data-deactivate-user]").forEach(e=>{e.addEventListener("click",c=>{c.stopPropagation();const o=e.dataset.userId,n=m.find(l=>String(l.user_id)===String(o)),a=(n==null?void 0:n.full_name)||o;E(i,{title:"השבתת משתמש/ת",message:`האם להשבית את המשתמש/ת "${a}"?
המשתמש/ת לא יוכל/תוכל להתחבר למערכת לאחר מכן.`,confirmLabel:"השבת",confirmClass:"ds-btn--danger",onConfirm:async()=>{e.classList.add("is-loading"),e.disabled=!0;try{await d.deactivateUser(o),r==null||r(),typeof u=="function"&&await u(),h(`המשתמש/ת "${a}" הושבת/ה בהצלחה`,"success")}catch(l){h(L(l==null?void 0:l.message),"error"),e.classList.remove("is-loading"),e.disabled=!1}}})})}),s.querySelectorAll("[data-reactivate-user]").forEach(e=>{e.addEventListener("click",c=>{c.stopPropagation();const o=e.dataset.userId,n=m.find(l=>String(l.user_id)===String(o)),a=(n==null?void 0:n.full_name)||o;E(i,{title:"הפעלה מחדש של משתמש/ת",message:`האם להפעיל מחדש את המשתמש/ת "${a}"?`,confirmLabel:"הפעל",confirmClass:"ds-btn--success",onConfirm:async()=>{e.classList.add("is-loading"),e.disabled=!0;try{await d.reactivateUser(o),r==null||r(),typeof u=="function"&&await u(),h(`המשתמש/ת "${a}" הופעל/ה מחדש בהצלחה`,"success")}catch(l){h(L(l==null?void 0:l.message),"error"),e.classList.remove("is-loading"),e.disabled=!1}}})})}),s.querySelectorAll("[data-delete-user]").forEach(e=>{e.addEventListener("click",c=>{c.stopPropagation();const o=e.dataset.userId,n=m.find(v=>String(v.user_id)===String(o)),a=(n==null?void 0:n.full_name)||o,y=w(n)==="admin"?`

⚠️ שים לב: משתמש/ת זה/זו הוא/היא מנהל/ת המערכת!`:"";E(i,{title:"מחיקת משתמש/ת",message:`פעולה זו תמחק לצמיתות את המשתמש/ת "${a}" מגיליון ההרשאות.
לא ניתן לבטל פעולה זו. להמשיך?${y}`,confirmLabel:"מחק",confirmClass:"ds-btn--danger",onConfirm:async()=>{e.classList.add("is-loading"),e.disabled=!0;try{await d.deleteUser(o),r==null||r(),typeof u=="function"&&await u()}catch(v){h(L(v==null?void 0:v.message),"error"),e.classList.remove("is-loading"),e.disabled=!1}}})})});function p(e){if(!e||!i)return;const c=String(e.user_id),o=z(e);i.openModal({title:`עריכת הרשאות — ${e.full_name||c}`,content:o,onClose:()=>{}}),requestAnimationFrame(()=>{const n=document.querySelector(".ds-modal__content");if(!n)return;const a=n.querySelector(".ds-perm-save-status"),l=n.querySelector("[data-save-permission]");l&&l.addEventListener("click",async()=>{var _,$;const y=(_=n.querySelector(`[data-role-select][data-user-id="${c}"]`))==null?void 0:_.value,v=($=n.querySelector(`[data-active-toggle][data-user-id="${c}"]`))!=null&&$.checked?"yes":"no",g={user_id:c,role:y,active:v};n.querySelectorAll("[data-perm-field]").forEach(b=>{const x=b.getAttribute("data-perm-field");x&&(b.type==="checkbox"?g[x]=b.checked?"yes":"no":g[x]=String(b.value||"").trim())}),l.classList.add("is-loading"),a&&(a.textContent="");try{await d.savePermission(g),a&&(a.textContent="נשמר בהצלחה"),r==null||r(),typeof u=="function"&&await u()}catch(b){a&&(a.textContent=L(b==null?void 0:b.message))}finally{l.classList.remove("is-loading")}})})}s.querySelectorAll("[data-view-perm]").forEach(e=>{e.addEventListener("click",c=>{c.stopPropagation();const o=e.dataset.userId,n=m.find(a=>String(a.user_id)===String(o));!n||!i||i.openDrawer({title:`הרשאות משתמש — ${n.full_name||o}`,content:K(n)})})}),s.querySelectorAll("[data-edit-perm]").forEach(e=>{e.addEventListener("click",c=>{c.stopPropagation();const o=e.dataset.userId,n=m.find(a=>String(a.user_id)===String(o));p(n)})}),s.querySelectorAll("[data-open-add-user]").forEach(e=>{e.addEventListener("click",c=>{if(c.stopPropagation(),!i)return;const o=(t==null?void 0:t.roleDefaults)||null,n=N(o);i.openModal({title:"הוספת משתמש חדש",content:n,onClose:()=>{}}),requestAnimationFrame(()=>{const a=document.querySelector(".ds-modal__content");if(!a)return;const l=a.querySelector(".ds-perm-save-status"),y=a.querySelector("[data-add-user-submit]"),v=a.querySelector("#new-display-role"),g=a.querySelector("[data-role-preview]");v&&g&&v.addEventListener("change",()=>{g.innerHTML=H(v.value,o)}),y&&y.addEventListener("click",async()=>{var k,A,I;const _=String(((k=a.querySelector("#new-user-id"))==null?void 0:k.value)||"").trim(),$=String(((A=a.querySelector("#new-full-name"))==null?void 0:A.value)||"").trim(),b=String(((I=a.querySelector("#new-entry-code"))==null?void 0:I.value)||"").trim(),x=String((v==null?void 0:v.value)||"instructor").trim();if(!_){l&&(l.textContent="יש להזין מזהה משתמש");return}y.classList.add("is-loading"),y.disabled=!0,l&&(l.textContent="");try{await d.addUser({user_id:_,full_name:$,entry_code:b,role:x}),l&&(l.textContent="המשתמש נוסף בהצלחה"),y.disabled=!1,y.classList.remove("is-loading"),r==null||r(),typeof u=="function"&&await u(),h(`המשתמש "${$||_}" נוסף בהצלחה`,"success")}catch(q){l&&(l.textContent=L(q==null?void 0:q.message)),y.classList.remove("is-loading"),y.disabled=!1}})})})})}};export{J as permissionsScreen};
