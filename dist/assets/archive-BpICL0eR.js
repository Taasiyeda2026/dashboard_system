import{a4 as ce,ah as fe,p as V,e as $,a1 as Y,i as u,j as _e,a3 as be,ai as H,G as j,d as ge,aj as me,q as Se,X as De,m as se,ak as ve,n as Q,h as ae}from"./index-CH0LFGSL.js";const b="archive",Ae=280,he=2,C=200,U=[{label:"קורסים",keys:["course","קורס","קורסים"],color:"blue"},{label:"סדנאות",keys:["workshop","סדנה","סדנאות"],color:"purple"},{label:"חדרי בריחה",keys:["escape_room","חדר בריחה","חדרי בריחה"],color:"red"},{label:"סיורים",keys:["tour","סיור","סיורים"],color:"green"},{label:"אפטרסקול",keys:["after_school","after school","afterschool","חוג אפטרסקול","אפטרסקול"],color:"orange"}];function pe(e,i=[]){const t=String((e==null?void 0:e.activity_type)||"").trim();if(!t)return!1;if(i.includes(t))return!0;const r=ce(t);return r?i.some(s=>ce(s)===r):!1}function Ce(e=[]){const i=Array.isArray(e)?e:[];return U.map(({label:t,keys:r})=>({label:t,count:i.filter(s=>pe(s,r)).length}))}function re(e,i=""){const t=new Map(Ce(e).map(({label:s,count:h})=>[s,h]));return`<div class="ds-archive-kpi-row" dir="rtl">${U.map(({label:s,color:h})=>{const p=t.get(s)||0;return`<button type="button" class="ds-archive-kpi ds-archive-kpi--${h}${i===s?" is-active":""}" data-archive-kpi="${u(s)}">
      <span class="ds-archive-kpi__value">${p}</span>
      <span class="ds-archive-kpi__label">${u(s)}</span>
    </button>`}).join("")}</div>`}const $e=[{key:"activity_manager",label:"מנהל פעילות",getValues:e=>[Q(e==null?void 0:e.activity_manager)]},{key:"activity_type",label:"סוג הפעילות",getOptionLabel:e=>ve(e)},{key:"authority",label:"רשות"}],N=["RowID","row_id","source_row_id","activity_no","activity_number","activity_name","activity_type","activity_family","activity_manager","manager_name","instructor_name","instructor_name_2","Instructor","Instructor2","emp_id","emp_id_2","EmployeeID","EmployeeID2","authority","school","grade","class_group","group","class","funding","status","start_date","end_date","date_1","meeting_dates","date_cols","notes","description",e=>Q(e==null?void 0:e.activity_manager),e=>Array.from({length:30},(i,t)=>e==null?void 0:e[`date_${t+1}`]).filter(Boolean).join(" "),e=>Array.isArray(e==null?void 0:e.meeting_dates)?e.meeting_dates.join(" "):"",e=>Array.isArray(e==null?void 0:e.date_cols)?e.date_cols.join(" "):""],O=new Map;function oe(e){return`archiveDetail:${e.source_sheet||""}:${e.RowID||""}`}function P(e){return`archiveDates:${e.source_sheet||""}:${e.RowID||""}`}function Ee(e){const i=String((e==null?void 0:e.instructor_name)??"").trim(),t=String((e==null?void 0:e.instructor_name_2)??"").trim();return[i,t].filter(Boolean).join(" · ")||"—"}function Ie(e){return String((e==null?void 0:e.end_date)||(e==null?void 0:e.start_date)||"").trim().slice(0,4)||"—"}function Re(e){const i=String((e==null?void 0:e.status)||"").trim().toLowerCase();if(!(i==="סגור"||i==="closed"||i==="inactive"))return!1;const r=Number(e==null?void 0:e.meetings_total),s=Number(e==null?void 0:e.meetings_done);return!Number.isFinite(r)||r<=0||!Number.isFinite(s)||s<0?!1:s<r}const Te=["2026","2025"];function Fe(){return`<div class="ds-perm-edit-form" dir="rtl" data-archive-reopen-form>
    <p class="ds-muted">הפעילות תיפתח מחדש בסטטוס פתוח, ללא שינוי בתאריכים הקיימים. אם תאריך הסיום כבר חלף, היא תופיע בחריגות להמשך טיפול.</p>
    <p class="ds-muted" role="alert" data-reopen-error></p>
  </div>`}function ke(e){const i=["archive","archiveDetail:","archiveDates:","activities:","month:","week:","dashboard:"];Object.keys((e==null?void 0:e.screenDataCache)||{}).forEach(t=>{i.some(r=>t===r||t.startsWith(r))&&delete e.screenDataCache[t]})}function qe(e){const i=Object.prototype.hasOwnProperty.call(e||{},"appliedQ")?e.appliedQ:e==null?void 0:e.q,t=Y(i||"");return{...e||{},appliedQ:t.length>=he?i:""}}function K(e,i){const t=String(i.archiveYear||"").trim(),r=Array.isArray(e)?e:[];return t?r.filter(s=>Ie(s)===t):r.slice()}function le(e,i){const t=$(i,b);let r=K(e,i);const s=String(i.archiveTypeFilter||"").trim();if(s){const h=U.find(p=>p.label===s);h&&(r=r.filter(p=>pe(p,h.keys)))}return ge(r,qe(t),{filterFields:$e})}function He(e){return e.map(i=>{const t=u(i.activity_name||"—"),r=Re(i),s=u(ve(i.activity_type)),h=u(i.authority||"—"),p=u(i.school||"—"),g=u(Ee(i)),E=u(Q(i.activity_manager)),R=String((i==null?void 0:i.end_date)||(i==null?void 0:i.start_date)||"").trim(),T=R?ae(R)||R:"—",m=String((i==null?void 0:i.start_date)||"").trim(),F=m?ae(m)||m:"—";return`
      <tr class="ds-data-row ds-activities-row" data-list-item data-row-id="${u(i.RowID)}">
        <td class="ds-activities-col ds-activities-col--program">
          <div class="ds-activities-program-cell">
            <strong class="ds-activities-program-name" title="${t}">${t}</strong>
            ${r?'<span class="ds-status-pill ds-status-pill--subtle" title="פעילות בארכיון עם מפגשים לא מלאים">דורש בדיקה</span>':""}
            <span class="ds-activities-program-type">${s}</span>
          </div>
        </td>
        <td class="ds-activities-col ds-activities-col--authority">
          <span class="ds-activities-cell-ellipsis" title="${h}">${h}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--school">
          <span class="ds-activities-cell-ellipsis" title="${p}">${p}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--instructor">
          <span class="ds-activities-cell-ellipsis">${g}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--manager ds-archive-col-manager">${u(E)}</td>
        <td class="ds-archive-date-col"><time class="ds-activities-date">${u(F)}</time></td>
        <td class="ds-archive-date-col"><time class="ds-activities-date ds-archive-end-date">${u(T)}</time></td>
      </tr>`}).join("")}function de(e,i,t=e.length){const r=$(i,b),{visible:s,hasMore:h,nextCount:p}=me(e,r),g=t===0?"אין פעילויות סגורות בארכיון":"לא נמצאו פעילויות התואמות לסינון";return s.length===0?Se(g):De(`
      <table class="ds-table ds-table--interactive ds-table--activities-list ds-table--archive" dir="rtl">
        <colgroup>
          <col class="ds-activities-col--program">
          <col class="ds-activities-col--authority">
          <col class="ds-activities-col--school">
          <col class="ds-activities-col--instructor">
          <col class="ds-activities-col--manager">
          <col class="ds-activities-col--date">
          <col class="ds-activities-col--date">
        </colgroup>
        <thead>
          <tr>
            <th>תוכנית / סוג</th>
            <th>רשות</th>
            <th>בית ספר</th>
            <th>מדריך</th>
            <th class="ds-archive-col-manager">מנהל פעילות</th>
            <th>תאריך התחלה</th>
            <th>תאריך סיום</th>
          </tr>
        </thead>
        <tbody>${He(s)}</tbody>
      </table>`)+(h?`<div style="display:flex;justify-content:center;padding:12px 0">
           <button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${b}" data-next-count="${p}">הצג עוד</button>
         </div>`:"")}const xe={async load({api:e,state:i}){return e.archiveActivities({activity_period:(i==null?void 0:i.archiveActivityPeriod)||(i==null?void 0:i.activityPeriodTab),limit:C})},render(e,{state:i}){const t=Array.isArray(e==null?void 0:e.rows)?e.rows:[];V(t,N);const r=le(t,i),s=$(i,b),h=String(i.archiveYear||"").trim(),p=K(t,i),g=[`<button type="button" class="ds-chip--tab${h?"":" is-active"}" data-archive-year="">הכל</button>`,...Te.map(S=>`<button type="button" class="ds-chip--tab${h===S?" is-active":""}" data-archive-year="${u(S)}">${u(S)}</button>`)].join(""),E=`
      <div class="ds-activities-main-toolbar" dir="rtl" data-local-filters="${b}">
        <input type="search" class="ds-input ds-input--sm ds-activities-search-sm"
          data-filter-search="${b}"
          value="${u(s.q||"")}"
          placeholder="חיפוש"
          aria-label="חיפוש בארכיון" />
        <div class="ds-activities-main-toolbar__actions">
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon-only"
            data-filter-clear="${b}" aria-label="ניקוי סינון" title="ניקוי סינון">↻</button>
        </div>
      </div>`,R=`
      <div class="ds-toolbar ds-archive-year-nav" dir="rtl" data-archive-year-nav>
        ${g}
      </div>`,T=`
      <div class="ds-activities-title-row" dir="rtl">
        <h2 class="ds-activities-page-title">ארכיון פעילויות · ${r.length} פעילויות סגורות</h2>
      </div>`,m=t.length+(e!=null&&e._hasMore?1:0),F=`<div data-archive-table-section>${de(r,i,m)}</div>`;return _e(`
      <section class="ds-activities-screen ds-activities-screen--archive">
        ${T}
        ${re(p,String(i.archiveTypeFilter||"").trim())}
        ${R}
        ${E}
        ${be({body:F,padded:!1})}
      </section>`)},bind({root:e,data:i,state:t,rerender:r,ui:s,api:h}){var J,Z,w,ee,te,ie;const p=()=>Array.isArray(i==null?void 0:i.rows)?i.rows:[],g=["operation_manager","admin"].includes((J=t==null?void 0:t.user)==null?void 0:J.display_role);(Z=t==null?void 0:t.clientSettings)!=null&&Z.hide_emp_id_on_screens,(w=t==null?void 0:t.clientSettings)!=null&&w.hide_row_id_in_ui,(ee=t==null?void 0:t.clientSettings)!=null&&ee.hide_activity_no_on_screens;const E=(t==null?void 0:t.clientSettings)||{};fe(E).reduce((n,c)=>{const a=String((c==null?void 0:c.emp_id)||"").trim(),l=String((c==null?void 0:c.name)||"").trim();return a&&l&&!n[a]&&(n[a]=l),n},{}),V(p(),N);const T=()=>r(),m=e.querySelector("[data-archive-table-section]");let F,S,L=!1;const x=()=>{const n=p();V(n,N);const c=le(n,t),a=K(n,t),l=n.length+(i!=null&&i._hasMore?1:0);m&&(m.innerHTML=de(c,t,l));const o=e.querySelector(".ds-archive-kpi-row");o&&(o.outerHTML=re(a,String(t.archiveTypeFilter||"").trim()));const y=e.querySelector(".ds-activities-page-title");y&&(y.textContent=`ארכיון פעילויות · ${c.length} פעילויות סגורות`)},z=()=>{clearTimeout(F),F=setTimeout(()=>{S&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(S);const n=()=>{S=null,x()};S=typeof globalThis.requestAnimationFrame=="function"?globalThis.requestAnimationFrame(n):setTimeout(n,0)},Ae)},M=e.querySelector(`[data-filter-search="${b}"]`);M==null||M.addEventListener("input",n=>{var y;const c=$(t,b),a=((y=n.target)==null?void 0:y.value)||"",l=Y(a),o=Y(c.appliedQ||"");if(c.q=a,l.length>=he){c.appliedQ=a,c.visibleCount=C,z();return}c.appliedQ="",o&&(c.visibleCount=C,z())}),(te=e.querySelector(`[data-filter-clear="${b}"]`))==null||te.addEventListener("click",()=>{const n=$(t,b);n.q="",n.appliedQ="",n.visibleCount=C,t.archiveYear="",T()}),e.addEventListener("click",async n=>{var l;const c=n.target.closest(`[data-list-show-more="${b}"]`);if(!c)return;const a=Number(((l=c.dataset)==null?void 0:l.nextCount)||C);if($(t,b).visibleCount=a,i!=null&&i._hasMore&&!L&&typeof(h==null?void 0:h.archiveActivities)=="function"){L=!0,c.disabled=!0;try{const o=await h.archiveActivities({activity_period:(t==null?void 0:t.archiveActivityPeriod)||(t==null?void 0:t.activityPeriodTab),limit:C,offset:p().length,paged:!0}),y=Array.isArray(o==null?void 0:o.rows)?o.rows:[],f=new Set(p().map(d=>String((d==null?void 0:d.RowID)||(d==null?void 0:d.row_id)||"").trim()).filter(Boolean));i.rows=[...p(),...y.filter(d=>{const _=String((d==null?void 0:d.RowID)||(d==null?void 0:d.row_id)||"").trim();return!_||f.has(_)?!1:(f.add(_),!0)})],i._hasMore=!!(o!=null&&o._hasMore)&&y.length>0}catch{}finally{L=!1}}x()}),e.addEventListener("click",n=>{const c=n.target.closest("[data-archive-year]");if(c){t.archiveYear=String(c.dataset.archiveYear||"").trim(),$(t,b).visibleCount=C,T();return}const a=n.target.closest("[data-archive-kpi]");if(a){const l=a.dataset.archiveKpi||"";t.archiveTypeFilter=t.archiveTypeFilter===l?"":l,$(t,b).visibleCount=C,x()}});const W=["admin","operation_manager"].includes((ie=t==null?void 0:t.user)==null?void 0:ie.display_role);async function ue(n){var D,k,q,ne;if(!n||!s)return;const c=(k=(D=t==null?void 0:t.screenDataCache)==null?void 0:D[oe(n)])==null?void 0:k.data,a=(ne=(q=t==null?void 0:t.screenDataCache)==null?void 0:q[P(n)])==null?void 0:ne.data,l=W&&!H(n),o=(v,A)=>{const I=g?v.private_note||"—":null;return(l&&!H(v)?`<div style="padding:12px 16px 0;text-align:right">
               <button type="button" class="ds-btn ds-btn--sm ds-archive-reopen-btn" data-archive-reopen="${u(String(v.RowID||""))}">
                 🔓 פתח מחדש
               </button>
             </div>`:"")+se(v,{privateNote:I,canEdit:!1,canDirectEdit:!1,canRequestEdit:!1,settings:E,datesLoading:A})},y=(v,A)=>{X(v),G(v,A,l)};if(c){s.openDrawer({title:"",content:o(c,!1),onOpen:v=>y(v,c)});return}const f=!a;if(s.openDrawer({title:"",content:o(n,f),onOpen:v=>y(v,n),onClose:()=>{const v=document.querySelector(".ds-drawer > header");v&&(v.hidden=!1)}}),a&&!f){const v=document.querySelector("[data-dates-section]");v&&j(v,a)}if(f){const v=n.source_row_id||n.RowID,A=n.source_sheet||"";h.activityDates(v,A).then(I=>{t!=null&&t.screenDataCache&&(t.screenDataCache[P(n)]={data:I,t:Date.now()});const B=document.querySelector("[data-dates-section]");B&&j(B,I)}).catch(()=>{const I=document.querySelector("[data-dates-section]");I&&I.removeAttribute("data-dates-loading")})}const d=oe(n);let _=O.get(d);_||(_=h.activityDetail(n.RowID,n.source_sheet).finally(()=>O.delete(d)),O.set(d,_)),_.then(v=>{const A=(v==null?void 0:v.row)||n;t!=null&&t.screenDataCache&&(t.screenDataCache[d]={data:A,t:Date.now()}),ye(n,A)}).catch(()=>{})}function ye(n,c){var D,k,q;const a=document.querySelector(".ds-drawer__content"),l=a==null?void 0:a.querySelector("[data-drawer-form]");if(!a||!l||String(l.getAttribute("data-row-id")||"").trim()!==String((n==null?void 0:n.RowID)||"").trim())return;const o=["admin","operation_manager"].includes((D=t==null?void 0:t.user)==null?void 0:D.display_role)&&!H(c),y=g?c.private_note||"—":null,f=o?`<div style="padding:12px 16px 0;text-align:right">
             <button type="button" class="ds-btn ds-btn--sm ds-archive-reopen-btn" data-archive-reopen="${u(String(c.RowID||""))}">
               🔓 פתח מחדש
             </button>
           </div>`:"";a.innerHTML=f+se(c,{privateNote:y,canEdit:!1,canDirectEdit:!1,canRequestEdit:!1,settings:E,datesLoading:!1}),X(a),G(a,c,o);const d=(q=(k=t==null?void 0:t.screenDataCache)==null?void 0:k[P(n)])==null?void 0:q.data,_=a.querySelector("[data-dates-section]");d&&_&&j(_,d)}function X(n){var a;const c=(a=n.closest(".ds-drawer"))==null?void 0:a.querySelector(":scope > header");c&&(c.hidden=!0)}function G(n,c,a=W){if(!a||H(c))return;const l=n.querySelector("[data-archive-reopen]");l&&l.addEventListener("click",()=>{s.openModal({title:"פתיחה מחדש של פעילות",content:Fe(),actions:`
            <button type="button" class="ds-btn ds-btn--ghost" data-ui-close-modal>ביטול</button>
            <button type="button" class="ds-btn ds-btn--primary" data-archive-reopen-confirm>אישור פתיחה מחדש</button>
          `});const o=document.querySelector(".ds-modal"),y=o==null?void 0:o.querySelector("[data-reopen-error]"),f=o==null?void 0:o.querySelector("[data-archive-reopen-confirm]"),d=_=>{y&&(y.textContent=_||"")};f==null||f.addEventListener("click",async()=>{var _,D;d(""),f.disabled=!0,f.textContent="שומר…";try{await h.saveActivity({source_sheet:c.source_sheet||"activities",source_row_id:c.RowID||c.row_id,changes:{status:"פתוח"}}),(_=s.closeModal)==null||_.call(s),(D=s.closeDrawer)==null||D.call(s),ke(t),t.route="activities",r()}catch{f.disabled=!1,f.textContent="אישור פתיחה מחדש",d("שמירת הפתיחה מחדש נכשלה. נסו שוב.")}})})}e.addEventListener("click",n=>{const c=n.target.closest("[data-row-id]");if(!c)return;const a=String(c.dataset.rowId||"").trim(),l=p().find(o=>String((o==null?void 0:o.RowID)||"")===a);l&&ue(l)})}};export{U as ARCHIVE_TYPE_KPIS,pe as archiveRowMatchesTypeKpi,xe as archiveScreen,Ce as archiveTypeKpiCounts};
