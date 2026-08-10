import{$ as z,i as r,q as L,j as M,B as A,a0 as H,z as b,x as P}from"./index-DpctzQJl.js";const U=1,V=150,D=["display:grid","grid-template-columns:repeat(auto-fill,minmax(180px,1fr))","gap:10px","align-items:stretch"].join(";"),N=["min-height:48px !important","height:auto !important","padding:10px 14px !important","display:flex !important","align-items:center !important","justify-content:center !important","text-align:center !important"].join(";"),F=["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e","#a855f7","#0ea5e9","#10b981"];function $(t){if(t===!1||t===0)return"no";if(t===!0||t===1)return"yes";const n=String(t??"").trim().toLowerCase();return n==="no"||n==="false"||n==="0"?"no":"yes"}function v(t){const n=String(t??"").trim();return n&&n!=="—"?n:""}function Q(t){const n=String(t).trim().split(/\s+/).filter(Boolean);return n.length>=2?`${n[0][0]}${n[1][0]}`:n.length===1?n[0].slice(0,2):"??"}function W(t){const n=String(t??"");let s=0;for(let e=0;e<n.length;e++)s=s*31+n.charCodeAt(e)&2147483647;return F[s%F.length]}function x(t,n,s,{dir:e="rtl",href:i="",copyValue:l=""}={}){const a=v(s);if(!a)return"";const c=i?`<a href="${r(i)}" style="color:#1d4ed8;text-decoration:none;font-weight:650" dir="${e}">${r(a)}</a>`:`<span dir="${e}" style="color:#263449;font-weight:620">${r(a)}</span>`,u=l?`<span style="min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;direction:ltr;overflow-wrap:anywhere">${c}<button type="button" class="ds-btn ds-btn--ghost" data-copy-instructor-email="${r(l)}" aria-label="העתקת כתובת המייל" title="העתקת כתובת המייל" style="width:28px;height:28px;min-width:28px;padding:0;border-radius:8px;display:inline-grid;place-items:center;line-height:1;flex:0 0 28px"><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg></button></span>`:`<span style="min-width:0;overflow-wrap:anywhere">${c}</span>`;return`<div style="display:grid;grid-template-columns:38px 112px minmax(0,1fr);align-items:center;gap:10px;padding:11px 12px;border:1px solid #e1e8f1;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.035)">
    <span aria-hidden="true" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf5ff;font-size:18px">${t}</span>
    <span style="color:#526174;font-size:.88rem;font-weight:700">${r(n)}</span>
    ${u}
  </div>`}async function Y(t){var a,c,u;const n=v(t);if(!n)return!1;const s=((a=globalThis.navigator)==null?void 0:a.clipboard)||((u=(c=globalThis.window)==null?void 0:c.navigator)==null?void 0:u.clipboard);if(s!=null&&s.writeText)try{return await s.writeText(n),!0}catch{}const e=globalThis.document;if(!(e!=null&&e.body)||typeof e.execCommand!="function")return!1;const i=e.createElement("textarea");i.value=n,i.setAttribute("readonly",""),i.style.position="fixed",i.style.opacity="0",e.body.appendChild(i),i.select();const l=e.execCommand("copy");return i.remove(),l}function G(t,n,s){const e=v(t.full_name)||v(t.emp_id)||"מדריך",i=$(t.active)==="yes",l=W(t.emp_id||e),a=v(t.mobile||t.phone),c=v(t.email),u=v(t.direct_manager)||"ללא",f=[x("📱",b("mobile"),a,{dir:"ltr",href:a?`tel:${a.replace(/[^0-9+]/g,"")}`:""}),x("✉️",b("email"),c,{dir:"ltr",href:c?`mailto:${c}`:"",copyValue:c}),x("📍",b("address"),t.address),x("💼",b("employment_type"),v(t.employment_type)?H(t.employment_type):""),x("👤",b("direct_manager"),u),n?"":x("#️⃣",b("emp_id"),t.emp_id,{dir:"ltr"})].filter(Boolean).join(""),S=s?`<button type="button" class="ds-btn ds-btn--primary" data-edit-instructor-contact="${r(String(t.emp_id||""))}" style="min-width:120px">✎ עריכה</button>`:"";return`<div dir="rtl" style="display:grid;gap:14px">
    <section style="display:flex;align-items:center;gap:14px;padding:15px;border:1px solid #dce7f2;border-radius:16px;background:linear-gradient(135deg,#f7fbff 0%,#edf6ff 100%)">
      <span aria-hidden="true" style="width:58px;height:58px;flex:0 0 58px;border-radius:50%;display:grid;place-items:center;background:${l};color:#fff;font-size:1.08rem;font-weight:800;box-shadow:0 5px 14px rgba(15,23,42,.16)">${r(Q(e))}</span>
      <span style="display:grid;gap:7px;min-width:0">
        <strong style="font-size:1.08rem;color:#162235;overflow-wrap:anywhere">${r(e)}</strong>
        <span>${P(i?"פעיל":"לא פעיל",i?"success":"neutral")}</span>
      </span>
    </section>
    <div style="display:grid;gap:9px">${f}</div>
    ${S?`<div style="display:flex;justify-content:flex-start;padding-top:2px">${S}</div>`:""}
  </div>`}function I(t,n="",s="—"){const e=String(n||""),i=[...new Set((Array.isArray(t)?t:[]).map(a=>String(a||"").trim()).filter(Boolean))],l=e&&!i.includes(e)?[e,...i]:i;return[`<option value="">${r(s)}</option>`].concat(l.map(a=>`<option value="${r(a)}"${a===e?" selected":""}>${r(a)}</option>`)).join("")}function J(t={},n=[],s=!1){const e=["תעשיידע","מעוף","מנפוואר"],i=["ללא",...n];return`<div class="ds-perm-edit-form ds-contact-edit-form" dir="rtl">
    ${s?`<input type="hidden" name="emp_id" value="${r(String(t.emp_id||""))}">`:`<div class="ds-perm-field"><span class="ds-muted">מזהה מדריך</span><input class="ds-input ds-input--sm" name="emp_id" value="${r(String(t.emp_id||""))}" readonly></div>`}
    <div class="ds-perm-field"><span class="ds-muted">שם מלא</span><input class="ds-input ds-input--sm" name="full_name" value="${r(String(t.full_name||""))}"></div>
    <div class="ds-perm-field"><span class="ds-muted">נייד</span><input class="ds-input ds-input--sm" name="mobile" value="${r(String(t.mobile||""))}" dir="ltr"></div>
    <div class="ds-perm-field"><span class="ds-muted">אימייל</span><input class="ds-input ds-input--sm" name="email" value="${r(String(t.email||""))}" dir="ltr"></div>
    <div class="ds-perm-field"><span class="ds-muted">כתובת</span><input class="ds-input ds-input--sm" name="address" value="${r(String(t.address||""))}"></div>
    <div class="ds-perm-field"><span class="ds-muted">סוג העסקה</span><select class="ds-input ds-input--sm" name="employment_type">${I(e,String(t.employment_type||""),"בחרו סוג העסקה")}</select></div>
    <div class="ds-perm-field"><span class="ds-muted">מנהל ישיר</span><select class="ds-input ds-input--sm" name="direct_manager">${I(i,String(t.direct_manager||"ללא"),"בחרו מנהל")}</select></div>
    <div class="ds-perm-field"><span class="ds-muted">סטטוס</span><select class="ds-input ds-input--sm" name="active">
      <option value="yes" ${$(t.active)==="yes"?"selected":""}>פעיל</option>
      <option value="no" ${$(t.active)==="no"?"selected":""}>לא פעיל</option>
    </select></div>
    <p class="ds-muted" data-contact-form-status role="status"></p>
  </div>`}function C(t){return String(t||"").trim().toLowerCase().replace(/\s+/g," ")}function K(t,n){const s=C(n);return s?t.filter(e=>[e.full_name,e.name,e.emp_id,e.employee_id,e.email,e.mobile,e.phone,e.address,e.employment_type,H(e.employment_type),e.direct_manager,e.active,e.authority,e.school,e.role,e.notes].some(i=>C(i).includes(s))):t}function X(t){const n=v(t.full_name)||v(t.emp_id)||"מדריך";return`
    <button
      type="button"
      class="ic-contact-card ic-contact-card--compact${$(t.active)==="yes"?"":" ic-contact-card--inactive"}"
      style="${N}"
      data-card-action="icontact:${encodeURIComponent(t.emp_id||"")}"
      aria-label="פתיחת פרטי מדריך: ${r(n)}"
    >
      <span class="ic-contact-card__name" style="font-size:0.98rem;line-height:1.25">${r(n)}</span>
    </button>`}const tt={load:({api:t})=>t.instructorContacts(),render(t,{state:n}={}){const s=Array.isArray(t==null?void 0:t.rows)?t.rows:[],e=(n==null?void 0:n.instrContactsSearch)||"";Object.prototype.hasOwnProperty.call(n,"instrContactsAppliedSearch")||(n.instrContactsAppliedSearch=C(e).length>=U?e:"");const i=(n==null?void 0:n.instrContactsAppliedSearch)||"";Object.prototype.hasOwnProperty.call(n,"instrContactsActiveFilter")||(n.instrContactsActiveFilter="yes");const l=(n==null?void 0:n.instrContactsActiveFilter)??"yes";let a=K(s,i);l&&(a=a.filter(f=>$(f.active)===l));const c=[{val:"",label:"הכל"},{val:"yes",label:"פעיל"},{val:"no",label:"לא פעיל"}].map(f=>`<button type="button" class="ds-chip ${f.val===l?"is-active":""}" data-active-filter="${f.val}">${r(f.label)}</button>`).join(""),u=a.length===0?L("לא נמצאו אנשי קשר"):`<div class="ic-contact-grid ic-contact-grid--compact" style="${D}" dir="rtl">${a.map(X).join("")}</div>`;return M(`
      <div style="display:flex;justify-content:flex-start;margin-bottom:2px">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-route="instructors" style="font-weight:800;min-width:92px">← חזרה</button>
      </div>

      <header class="ds-page-header" style="padding-top:2px">
        <h1 class="ds-page-header__title" style="font-weight:850">אנשי קשר מדריכים</h1>
        <p class="ds-page-header__subtitle" style="font-weight:700;color:#344256">לחצו על שם מדריך להצגת פרטי הקשר והמידע הנוסף</p>
      </header>

      <div class="ds-screen-top-row" style="display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap">
        <input
          id="instr-contacts-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש..."
          value="${r(e)}"
          dir="rtl"
          style="flex:1 1 320px;max-width:520px;min-width:220px"
        />
        <div class="ds-filter-bar" role="toolbar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;padding:0;border:0;background:transparent">
          ${c}
          <span class="ds-badge" style="font-weight:800">${a.length} מדריכים</span>
        </div>
      </div>

      <section class="ds-card">
        <div class="ds-card__body${a.length===0?" ds-card__body--padded":""}">${u}</div>
      </section>
    `)},bind({root:t,data:n,state:s,ui:e,rerender:i,clearScreenDataCache:l,api:a}){var T,k,j,q;const c=Array.isArray(n==null?void 0:n.rows)?n.rows:[],u=!!((T=s==null?void 0:s.clientSettings)!=null&&T.hide_emp_id_on_screens),f=String(((k=s==null?void 0:s.user)==null?void 0:k.role)||"").trim()!=="instructor",S=z((s==null?void 0:s.clientSettings)||{});(j=t.querySelector('[data-route="instructors"]'))==null||j.addEventListener("click",o=>{o.preventDefault(),document.dispatchEvent(new CustomEvent("app:navigate",{detail:{route:"instructors"}}))});let E;(q=t.querySelector("#instr-contacts-search"))==null||q.addEventListener("input",o=>{var h;const d=o.target.value||"",y=((h=o.target)==null?void 0:h.selectionStart)??d.length;clearTimeout(E),s.instrContactsSearch=d;const g=()=>{s.instrContactsAppliedSearch=d,i();const m=t.querySelector("#instr-contacts-search");if(m){m.focus();try{m.setSelectionRange(y,y)}catch{}}};if(C(d).length===0){g();return}E=setTimeout(g,V)}),t.querySelectorAll("[data-active-filter]").forEach(o=>{o.addEventListener("click",()=>{s.instrContactsActiveFilter=o.dataset.activeFilter||"",i()})});const O=o=>{var g;if(!e||!o||!f)return;const d=String(o.emp_id||"").trim();(g=e.closeDrawer)==null||g.call(e),e.openModal({title:`עריכת איש קשר — ${o.full_name||d}`,content:J(o,S,u),actions:`<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-contact>שמירה</button>
                  <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>`});const y=document.querySelector("[data-save-instructor-contact]");y&&(y.onclick=async()=>{const h=document.querySelector(".ds-modal__content");if(!h)return;const m=h.querySelector("[data-contact-form-status]"),p=_=>{var R;return String(((R=h.querySelector(`[name="${_}"]`))==null?void 0:R.value)||"").trim()},w={emp_id:d||p("emp_id"),full_name:p("full_name"),mobile:p("mobile"),email:p("email"),address:p("address"),employment_type:p("employment_type"),direct_manager:p("direct_manager")||"ללא",active:p("active")||"yes"};if(!w.emp_id||!w.full_name){m&&(m.textContent="יש להזין שם מלא ומזהה מדריך.");return}try{y.disabled=!0,m&&(m.textContent="שומר..."),await a.saveContact({kind:"instructor",row:w}),Object.assign(o,w),l==null||l(),e.closeModal(),A("נשמר בהצלחה","success",1800),i()}catch(_){m&&(m.textContent=`שגיאה: ${String((_==null?void 0:_.message)||"")}`)}finally{y.disabled=!1}})},B=o=>{const d=c.find(g=>String(g.emp_id)===String(o));if(!d||!e)return;e.openDrawer({title:d.full_name||d.emp_id,content:G(d,u,f)});const y=globalThis.document;requestAnimationFrame(()=>{if(!y)return;const g=y.querySelector("[data-edit-instructor-contact]");g&&(g.onclick=()=>O(d));const h=y.querySelector("[data-copy-instructor-email]");h&&(h.onclick=async()=>{const m=h.dataset.copyInstructorEmail||"";try{const p=await Y(m);A(p?"המייל הועתק":"לא ניתן להעתיק את המייל",p?"success":"error",1800)}catch{A("לא ניתן להעתיק את המייל","error",2200)}})})};e==null||e.bindInteractiveCards(t,o=>{o.startsWith("icontact:")&&B(decodeURIComponent(o.slice(9)))})}};export{tt as instructorContactsScreen};
