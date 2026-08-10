import{j as sa,a6 as ia,q as oa,i as l,C as S,al as Oa,am as ja,x as At,D as Fa}from"./index-DpctzQJl.js";function $t(t){return t===!0||["yes","true","1"].includes(String(t||"").trim().toLowerCase())}function He(t={}){return(t==null?void 0:t.profile_is_active)===!1?!1:$t(t==null?void 0:t.can_access_personal_reports)}function ne(t){return String(t||"").trim().toLowerCase()==="admin"}function la(t={}){return ne((t==null?void 0:t.display_role)||(t==null?void 0:t.role))?!0:$t(t==null?void 0:t.personal_reports_manager)}function _t(t={}){return(t==null?void 0:t.can_manage_personal_reports)===!0||ne(t==null?void 0:t.role)?!0:$t(t==null?void 0:t.personal_reports_manager)}function Ba(){return sa(`${ia("דוחות אישיים","גישה מוגבלת")} ${oa("אין הרשאה לצפייה בדוחות אישיים.")}`)}function ze(t){return!!(t!=null&&t.token&&(t==null?void 0:t.permissionsReady)===!1)}function Ha(){return sa(`${ia("דוחות אישיים","טוען הרשאות…")} <div class="pr-loading-placeholder">טוען…</div>`)}const za=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"],Tt={draft:"פתוח לדיווח",submitted:"הוגש לבדיקה",reviewed:"הוגש לבדיקה",needs_correction:"הוחזר לתיקון",approved:"אושר",paid:"הועבר לתשלום"},Me={draft:"neutral",submitted:"warning",reviewed:"neutral",approved:"success",needs_correction:"danger",paid:"success"},Ua={not_started:{label:"פתוח לדיווח",kind:"neutral"},in_progress:{label:"פתוח לדיווח",kind:"warning"},submitted:{label:"הוגש לבדיקה",kind:"warning"},needs_correction:{label:"הוחזר לתיקון",kind:"danger"},approved:{label:"אושר",kind:"success"},paid:{label:"הועבר לתשלום",kind:"success"}},Pe=Object.fromEntries(Object.entries(Tt).map(([t,e])=>[t,{label:e,kind:Me[t]||"neutral"}])),j={MY_REPORTS:"my-reports",MANAGEMENT:"employee-reports-management",REVIEWS:"annual-reviews"};let $=null,q=null,F=null,nt=j.MY_REPORTS,ut=!1,H=null,Z=null,St=!1,Ee=0;const dt=new Set,Ft=new Map,Bt=new Map,ft=new Map,It=new Map,ht=new Map,Dt=new Map;let Et=null,st={month:"",status:""},A=null,yt="";const Ht={month:1,year:2026},_e=new WeakSet;function Va(){try{if(typeof window<"u"&&new URLSearchParams(window.location.search).get("pr_debug")==="1")return!0}catch{}return!1}function tt(t,e=""){if(Va())try{console.info("[personal-reports]",t,e||"")}catch{}}function Ne({employeeId:t="",month:e="",status:a="",reportId:r=""}={}){return`${String(t||"").trim()}|${String(e||"").trim()}|${String(a||"").trim()}|${String(r||"").trim()}`}function Wa(t=st){return`admin-reports|${Ne({month:t.month,status:t.status})}`}function Re(t){return`report-row|${String(t||"").trim()}`}function Ue(t){return`profile|${String(t||"").trim()}`}function Ct(t,e=!1){return`open-report|${String(t||"").trim()}|${e?"admin":"employee"}`}function Ya(t,e,a){return`current-report|${String(t||"").trim()}|${a}-${String(e).padStart(2,"0")}`}function Ka(){Ee+=1}function Mt({reportId:t="",allReports:e=!1}={}){if(e){Et=null,Dt.clear();for(const a of[...dt])(a.startsWith("admin-reports|")||a.startsWith("current-report|"))&&dt.delete(a)}if(t){const a=String(t||"").trim(),r=new Set([Ne({reportId:a}),Re(a),Ct(a,!0),Ct(a,!1)]);for(const n of[...Ft.keys(),...dt,...Bt.keys()])(r.has(n)||n.endsWith(`|${a}`))&&(Ft.delete(n),dt.delete(n),Bt.delete(n));ft.delete(a),ht.delete(Ct(a,!0)),ht.delete(Ct(a,!1))}}function ca(t){var e,a,r,n,s,i;(e=t.__prAdminAbort)==null||e.abort(),(a=t.__prAdminViewAbort)==null||a.abort(),(r=t.__prEmployeeAbort)==null||r.abort(),(n=t.__prDetailAbort)==null||n.abort(),(s=t.__prSelectorAbort)==null||s.abort(),(i=t.__prLoginAbort)==null||i.abort()}async function Yt(t,e,{force:a=!1}={}){if(!t)throw new Error("missing_personal_reports_request_key");const r=Ft.get(t);if(!a&&r)return tt("load skipped duplicate",t),r.promise;if(!a&&dt.has(t))return tt("load skipped duplicate",t),null;const n=Ee;tt("personalReports load start",t);const s=(async()=>{try{const i=await e();return n!==Ee?(tt("load finished (stale ignored)",t),i):(dt.add(t),tt("tables loaded",t),tt("load finished",t),i)}finally{Ft.delete(t)}})();return Ft.set(t,{promise:s,generation:n}),s}function vt(){return Pt()}function se(t){return ce(t)}function Ut(t){return de(t)}function Ot(t){var a;const e=t.querySelector("#pr-filter-month");return{month:(e==null?void 0:e.value)||vt(),status:((a=t.querySelector("#pr-filter-status"))==null?void 0:a.value)||""}}function Ga(t,e=st){return t.month!==e.month||t.status!==e.status}function Ja(t){const{month:e,year:a}=se(t||vt()),r=e>=12?1:e+1,n=e>=12?a+1:a;return Ut(qt(r,n))}function Xa(t=[]){return(t||[]).reduce((e,a)=>{var s,i;const r=String(a.reportId||((s=a.report)==null?void 0:s.id)||"").trim();return r&&(String(a.reportStatus||((i=a.report)==null?void 0:i.status)||"").trim()==="approved"?e.approvedIds.push(r):e.notApprovedCount+=1),e},{approvedIds:[],notApprovedCount:0})}function Qa(t,e={}){if(!t)return!1;const a=Number(e.travel||0),r=Number(e.expenses||0),n=Number(t.work_days_in_month||0),s=Number(t.vacation_days||0)+Number(t.sick_days||0)+Number(t.declaration_day||0);return a>0||r>0||n>0||s>0||!!String(t.report_notes||"").trim()}function da(t,e={}){return t?t.status==="needs_correction"?"needs_correction":t.status==="paid"?"paid":t.status==="approved"?"approved":t.status==="submitted"||t.status==="reviewed"?"submitted":t.status==="draft"&&Qa(t,e)?"in_progress":"not_started":"not_started"}function Za(t){return(t==null?void 0:t.status)||"draft"}function tr(t=""){return Object.entries(Pe).map(([e,a])=>`<option value="${l(e)}" ${e===t?"selected":""}>${l(a.label)}</option>`).join("")}function er(t){const e=Pe[t]||{label:t,kind:"neutral"};return At(e.label,e.kind)}function ar(t){const e=Ua[t]||{label:t,kind:"neutral"};return At(e.label,e.kind)}function ie(t,e){return{on(a,r,n={}){t.addEventListener(a,r,{signal:e,...n})}}}function P(t){return Number(t||0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2})}function M(t){const e=Number(t||0);return e===Math.floor(e)?e.toString():e.toFixed(2)}function U(t){if(!t)return"";try{const[e,a,r]=t.split("-");return`${r}.${a}.${String(e).slice(2)}`}catch{return t}}function Ve(t){if(!t)return"";try{const[e,a,r]=t.split("-");return`${r}.${a}.${e}`}catch{return t}}function We(t,e,a){return`${String(t).padStart(4,"0")}-${String(e).padStart(2,"0")}-${String(a).padStart(2,"0")}`}function oe(t,e){const a=new Date(e,t-2,25),r=new Date(e,t-1,25),n=We(a.getFullYear(),a.getMonth()+1,a.getDate()),s=We(r.getFullYear(),r.getMonth()+1,r.getDate());return{start:n,end:s,label:`${Ve(n)}–${Ve(s)}`}}function rr(t){const e=t.getDay();return e>=0&&e<=4}function ae(t,e){if(!t||!e)return 0;const a=new Date(`${t}T00:00:00`),r=new Date(`${e}T00:00:00`);if(Number.isNaN(a.getTime())||Number.isNaN(r.getTime())||a>r)return 0;let n=0;for(const s=new Date(a);s<=r;s.setDate(s.getDate()+1))rr(s)&&(n+=1);return n}const nr={vacation:"חופש",sick:"מחלה",declaration:"הצהרה"};function Le(t){return nr[t]||t||"—"}function mt(t,e,a){return(t||[]).find(r=>String((r==null?void 0:r[e])||"")===String(a||""))||null}function Ie(t,e){return e?{label:"צורפה",missing:!1}:Ce(t)?{label:"הצהרת מהימנות",missing:!1}:{label:"חסרה",missing:!0}}function De(t,e){return e?{label:"צורף אישור",missing:!1}:(t==null?void 0:t.absence_type)==="sick"?{label:"חסר אישור מחלה",missing:!0}:{label:"לא נדרש",missing:!1}}function pa(t){return String((t==null?void 0:t.correction_note)||(t==null?void 0:t.finance_notes)||"").trim()}function le(t){return ae(t==null?void 0:t.start_date,t==null?void 0:t.end_date)}function X(t,e){return(t||[]).filter(a=>a.absence_type===e).reduce((a,r)=>a+le(r),0)}function Ce(t){return $t((t==null?void 0:t.reliability_declaration)||(t==null?void 0:t.integrity_declaration)||(t==null?void 0:t.no_receipt_declaration))}function sr(t,e){return(t||[]).filter(a=>Number(a.amount||0)>0&&!mt(e,"expense_entry_id",a.id)&&!Ce(a))}function ua(t=[]){const e=X(t,"vacation"),a=X(t,"sick"),r=X(t,"declaration"),n=[e>0?`חופש: ${M(e)} ימים`:"",a>0?`מחלה: ${M(a)} ימים`:"",r>0?`הצהרה: ${M(r)} ימים`:""].filter(Boolean);return n.length?n.join(", "):"חודש עבודה מלא"}function ir(t,e){return(t||[]).filter(a=>(a==null?void 0:a.absence_type)==="sick"&&!mt(e,"absence_entry_id",a.id))}async function Oe(t){const[e,a,r]=await Promise.all([va(t),wa(t),ga(t)]),n=sr(e,r);if(n.length)throw new Error(`missing_expense_receipts:${n.length}`);const s=ir(a,r);if(s.length)throw new Error(`missing_sick_attachments:${s.length}`)}function Vt(){const t=new Date;return{month:t.getMonth()+1,year:t.getFullYear()}}function qt(t,e){return`${String(e).padStart(4,"0")}-${String(t).padStart(2,"0")}`}function Pt(){const{month:t,year:e}=Vt();return qt(t,e)}function ce(t){const e=String(t||"").trim();if(!e)return Vt();const[a,r]=e.split("-").map(Number);return!a||!r?Vt():{month:r,year:a}}function de(t){const{month:e,year:a}=ce(t),r=qt(e,a),n=qt(Ht.month,Ht.year),s=Pt();return r<n?n:r>s?s:r}function Zt(t=""){const e=String(t||yt||(A==null?void 0:A.selectedMonth)||"").trim();return e?de(e):Pt()}function or(t,e){const a=Vt();return t===a.month&&e===a.year}function ma(t){const e=Vt(),a=[];let r=e.year,n=e.month;for(;r>Ht.year||r===Ht.year&&n>=Ht.month;){const s=qt(n,r),i=s===t?" selected":"";a.push(`<option value="${l(s)}"${i}>${l(lt(n,r))}</option>`),n-=1,n<1&&(n=12,r-=1)}return a.join("")}function lt(t,e){return`${za[t-1]} ${e}`}function ba(t){return!t||t.status==="draft"||t.status==="needs_correction"}function fa(t){return/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(t||"").trim())}function lr(...t){return t.map(e=>String(e||"").trim()).find(fa)||""}function je(){return H||null}function ha(t){return t==null?"":String(t).trim()}function Ye(t){const e=String(t||"").trim();return e.includes("@")?e:`${e}@think.org.il`}function ye(t){return/^\d+$/.test(String(t||"").trim())}function cr(t){const e=String(t||"").trim();return e.includes("@")?e.split("@")[0].trim():""}function dr(t){const e=String((t==null?void 0:t.username)||"").trim(),a=String((t==null?void 0:t.user_id)||"").trim();if(e&&e.toLowerCase()!==a.toLowerCase()||e&&!ye(e))return e;for(const n of[t==null?void 0:t.email,t==null?void 0:t.work_email,t==null?void 0:t.auth_email]){const s=cr(n);if(s&&!ye(s))return s}const r=String((t==null?void 0:t.emp_id)||(t==null?void 0:t.employee_id)||"").trim();return r&&r.toLowerCase()!==a.toLowerCase()&&!ye(r)?r:e||""}function pr(t){return String((t==null?void 0:t.auth_user_id)||(t==null?void 0:t.personal_reports_user_id)||(t==null?void 0:t.supabase_user_id)||"").trim()}function ur(t,e){if(!t||!e)return!1;const a=String(t.auth_user_id||"").trim(),r=pr(e);if(a&&r&&a===r)return!0;const n=String(t.username||"").trim().toLowerCase(),s=String(e.username||"").trim().toLowerCase();if(n&&s&&n===s)return!0;const i=[e.username,e.email,e.work_email,e.emp_id,e.employee_id].map(d=>String(d||"").trim().toLowerCase()).filter(Boolean),o=[t.username,t.email,t.emp_id].map(d=>String(d||"").trim().toLowerCase()).filter(Boolean);return!i.length||!o.length?!1:i.some(d=>o.includes(d))}function _a(t){const e=String((t==null?void 0:t.message)||(t==null?void 0:t.code)||t||"").trim();return/missing_employee_uuid/i.test(e)?"לא נמצא מזהה עובד תקין במערכת. יש לצאת ולהיכנס מחדש לדשבורד, ואז לנסות שוב.":O(t,"שם משתמש או סיסמה שגויים")}function mr(t){var e;return!!((e=t==null?void 0:t.querySelector)!=null&&e.call(t,".pr-loading-placeholder"))}async function Ke(t,{forceReload:e=!1}={}){var r;if(!ut||!((r=$==null?void 0:$.user)!=null&&r.id)){A={kind:"login"},K(t,gt()),wt(t);return}const a=A;if((a==null?void 0:a.kind)==="admin-report"&&a.reportId){await Q(t,a.reportId,!0,{isSimulation:a.isSimulation,initialTab:a.initialTab||"status",forceReload:e});return}if((a==null?void 0:a.kind)==="employee-report"&&a.reportId){await Q(t,a.reportId,!1,{isSimulation:a.isSimulation,initialTab:a.initialTab||"status",forceReload:e});return}await V(t,H,{forceReload:e})}function O(t,e="אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת."){const a=String((t==null?void 0:t.message)||(t==null?void 0:t.code)||t||"").trim();return/invalid input syntax for type uuid|uuid/i.test(a)?"פרטי ההתחברות אינם תקינים. יש לבדוק את קוד העובד ולנסות שוב.":/invalid_credentials|entry_code_mismatch/i.test(a)?"שם משתמש או סיסמה שגויים":/auth_ok_user_row_not_found/i.test(a)?"לא נמצא פרופיל משתמש במערכת. יש לפנות למנהל המערכת.":/auth_ok_user_row_permission_denied/i.test(a)?"ההתחברות הצליחה, אך אין הרשאת קריאה לפרופיל המשתמש. יש לפנות למנהל המערכת.":/auth_ok_user_row_query_error/i.test(a)?"ההתחברות הצליחה, אך בדיקת פרופיל המשתמש נכשלה. נסו שוב או פנו למנהל המערכת.":/auth_ok_user_row_multiple_matches/i.test(a)?"ההתחברות הצליחה, אך נמצאו כמה פרופילים תואמים. יש לפנות למנהל המערכת.":/user_not_found|not_found/i.test(a)?"שם משתמש או סיסמה שגויים":/missing_employee_uuid/i.test(a)?"לא נמצא מזהה עובד תקין במערכת. יש לצאת ולהיכנס מחדש לדשבורד, ואז לנסות שוב.":/missing_expense_receipts/i.test(a)?"קיימת הוצאה כספית ללא קבלה וללא הצהרת מהימנות.":/missing_sick_attachments/i.test(a)?"קיים יום מחלה ללא אישור מחלה.":/correction_note_required/i.test(a)?"חובה להזין הודעה לעובד בעת החזרה לתיקון.":/report_paid_not_returnable/i.test(a)?"דוח שהועבר לתשלום לא ניתן להחזיר לתיקון.":/report_status_not_returnable/i.test(a)?"ניתן להחזיר לתיקון רק דוח שהוגש לבדיקה או אושר.":/missing_travel_rate|missing travel rate/i.test(a)?"לא הוגדר תעריף החזר נסיעות לעובד. יש לפנות למנהל המערכת.":/report_not_editable/i.test(a)?"הדוח אינו ניתן לעריכה (אינו בסטטוס טיוטה). יש לפנות למנהל המערכת.":/permission denied|row-level security|rls|unauthorized|forbidden/i.test(a)?"אין הרשאה לצפייה בדוחות אלה.":a?`${e} (${a})`:e}function br(t){if(!t||typeof t!="object")return null;const e=lr(t.personal_reports_user_id,t.supabase_user_id,t.auth_user_id,t.id),a=String(t.display_role||t.role||"").trim(),r=ne(a)?"admin":"employee",n=la(t);return{id:e,email:String(t.email||t.work_email||"").trim(),full_name:String(t.full_name||t.name||t.user_id||"משתמש מחובר").trim(),role:r,display_role:a,emp_id:String(t.emp_id||t.employee_id||"").trim(),personal_reports_manager:$t(t==null?void 0:t.personal_reports_manager)?"yes":"no",can_manage_personal_reports:n}}function ve(t){const e=br(t==null?void 0:t.user);return e?{user:{id:e.id},profile:e,needsInternalAuth:!e.id}:null}function pt(){$=null,q=null,F=null,nt=j.MY_REPORTS,ut=!1,St=!1,Ka(),Mt({allReports:!0}),ft.clear(),It.clear(),ht.clear(),st={employee:"",month:"",status:""},yt="",A=null}function gt(t=""){return`
    <style>
      .pr-lock-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 40px 16px;
        background: #f1f5f9;
        direction: rtl;
        box-sizing: border-box;
      }
      .pr-lock-card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border: 1px solid #ddd6e7;
        border-radius: 16px;
        box-shadow: 0 8px 22px rgba(15,23,42,0.06);
        padding: 22px 24px;
        box-sizing: border-box;
        text-align: right;
      }
      .pr-lock-icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        background: #eff6ff;
        border-radius: 14px;
        margin: 0 auto 14px;
        color: #1a3358;
      }
      .pr-lock-title {
        margin: 0 0 8px;
        font-size: 1.18rem;
        font-weight: 700;
        color: #0f172a;
        text-align: center;
        line-height: 1.4;
      }
      .pr-lock-subtitle {
        margin: 0 0 16px;
        font-size: 0.875rem;
        color: #64748b;
        text-align: center;
        line-height: 1.6;
      }
      .pr-lock-error {
        margin: 0 0 18px;
        padding: 10px 14px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        font-size: 0.875rem;
        text-align: right;
      }
      .pr-lock-form-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        margin: 0 auto;
      }
      .pr-lock-field {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
      }
      .pr-lock-label {
        font-size: 0.82rem;
        font-weight: 600;
        color: #374151;
        text-align: center;
      }
      .pr-lock-input {
        all: unset;
        box-sizing: border-box;
        display: block;
        width: 260px;
        max-width: 100%;
        padding: 10px 12px;
        font-size: 1rem;
        font-family: inherit;
        color: #0f172a;
        background: #f8fafc;
        border: 1.5px solid #cbd5e1;
        border-radius: 10px;
        transition: border-color 0.15s, box-shadow 0.15s;
        direction: ltr;
        text-align: center;
        letter-spacing: 0.12em;
      }
      .pr-lock-input::placeholder {
        color: #94a3b8;
        letter-spacing: 0;
        direction: rtl;
        font-size: 0.82rem;
      }
      .pr-lock-input:focus {
        border-color: #1a3358;
        box-shadow: 0 0 0 3px rgba(26,51,88,0.12);
        background: #ffffff;
        outline: none;
      }
      .pr-lock-btn {
        all: unset;
        box-sizing: border-box;
        display: block;
        width: 150px;
        flex-shrink: 0;
        min-height: 38px;
        padding: 0 16px;
        font-size: 0.92rem;
        font-family: inherit;
        font-weight: 600;
        color: #ffffff;
        background: #1a3358;
        border-radius: 10px;
        cursor: pointer;
        text-align: center;
        transition: opacity 0.15s, transform 0.1s;
        -webkit-user-select: none;
        user-select: none;
      }
      .pr-lock-btn:hover { opacity: 0.87; }
      .pr-lock-btn:active { transform: scale(0.98); opacity: 0.9; }
      @media (max-width: 480px) {
        .pr-lock-card { width: min(92vw, 420px); padding: 20px; border-radius: 14px; }
        .pr-lock-wrap { padding: 20px 12px; align-items: flex-start; padding-top: 40px; }
        .pr-lock-input { width: min(260px, 100%); }
      }
    </style>
    <div class="pr-lock-wrap" dir="rtl">
      <div class="pr-lock-card" role="main" aria-labelledby="pr-lock-title">
        <div class="pr-lock-icon-wrap" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 class="pr-lock-title" id="pr-lock-title">דוחות אישיים</h2>
        <p class="pr-lock-subtitle">אימות נוסף לדוחות אישיים — אזור זה כולל מידע רגיש. הזינו קוד התחברות להצגת הדוחות שלי</p>
        ${t?`<div class="pr-lock-error" role="alert">${l(t)}</div>`:""}
        <form id="pr-internal-login-form" autocomplete="off">
          <div class="pr-lock-form-inner">
            <div class="pr-lock-field">
              <label class="pr-lock-label" for="pr-internal-access-code">קוד התחברות</label>
              <input class="pr-lock-input" id="pr-internal-access-code" name="access_code" type="password" autocomplete="off" placeholder="••••" required />
            </div>
            <button class="pr-lock-btn" type="submit">כניסה</button>
          </div>
        </form>
      </div>
    </div>
  `}async function fr(t,e){var p;const a=t||je(),r=dr(a),n=ha(e);if(!r||!n)throw new Error("invalid_credentials");const{data:s,error:i}=await S.auth.signInWithPassword({email:Ye(r),password:n});if(i||!((p=s==null?void 0:s.user)!=null&&p.id))throw new Error("invalid_credentials");Oa();const o=s.user.id,d=Ye(r).trim().toLowerCase(),c=r.toLowerCase(),{userRow:m}=await ja({supabase:S,columns:"user_id,username,email,name,role,emp_id,is_active,auth_user_id",authEmail:d,username:c,authUserId:o,loginMode:!0,requireAuthUserMatch:!0});if(!m||!ur(m,a))throw m?new Error("invalid_credentials"):(console.warn("[login-diagnostic]",{code:"auth_ok_user_row_not_found",auth_user_id:o,auth_email:d,username:c}),new Error("auth_ok_user_row_not_found"));const y={id:o,email:String(m.email||s.user.email||"").trim(),full_name:String(m.name||m.email||r).trim(),role:ne(m.role)?"admin":"employee",display_role:String(m.role||"").trim(),emp_id:String(m.emp_id||m.user_id||r).trim(),personal_reports_manager:$t(a==null?void 0:a.personal_reports_manager)?"yes":"no",can_manage_personal_reports:la(a)};return{user:{id:o},profile:y,needsInternalAuth:!1}}function ya(t){if(!fa(t))throw new Error("missing_employee_uuid")}async function Te(t,e,a){ya(t);const{data:r,error:n}=await S.from("personal_reports").select("*").eq("employee_id",t).eq("report_month",e).eq("report_year",a).maybeSingle();if(n)throw n;return r||null}async function hr(t,e,a){let r=await Te(t,e,a);if(r)return r;try{return await _r(t,e,a)}catch(n){if(String((n==null?void 0:n.code)||(n==null?void 0:n.message)||"").includes("23505")&&(r=await Te(t,e,a),r))return r;throw n}}async function _r(t,e,a){ya(t);const{data:r,error:n}=await S.from("personal_reports").insert({employee_id:t,report_month:e,report_year:a,status:"draft"}).select().single();if(n)throw console.error("[personal-reports] createReport failed",{employeeId:t,month:e,year:a,code:n.code,message:n.message,details:n.details}),n;return r}async function yr(t){const{data:e,error:a}=await S.from("personal_reports").select("*").eq("id",t).single();if(a)throw a;return e}async function pe(t,{force:e=!1}={}){const a=String(t||"").trim();if(!a)throw new Error("missing_report_id");if(!e&&ft.has(a))return tt("load skipped duplicate",Re(a)),ft.get(a);const r=Re(a),n=e||dt.has(r)&&!ft.has(a),i=await Yt(r,()=>yr(a),{force:n})||ft.get(a);if(!i)throw new Error("personal_report_row_unavailable");return ft.set(a,i),i}async function Fe(t,{force:e=!1}={}){const a=String(t||"").trim();if(!a)return null;if(!e&&It.has(a))return tt("load skipped duplicate",Ue(a)),It.get(a);const n=await Yt(Ue(a),async()=>{const{data:s,error:i}=await S.from("profiles").select("full_name, email").eq("id",a).maybeSingle();if(i)throw i;return s||null},{force:e})??It.get(a)??null;return n&&It.set(a,n),n}async function vr(t,e,a,{force:r=!1}={}){const n=`${String(t||"").trim()}|${a}-${String(e).padStart(2,"0")}`,s=Ya(t,e,a);if(!r&&Dt.has(n))return tt("load skipped duplicate",s),Dt.get(n);const o=await Yt(s,()=>Te(t,e,a),{force:r}).catch(()=>null)??Dt.get(n)??null;return Dt.set(n,o),o}async function gr(t,e){const{error:a}=await S.from("personal_reports").update(e).eq("id",t);if(a)throw a}async function wr(t,e){await Oe(t);const{error:a}=await S.from("personal_reports").update({status:"submitted",submitted_at:new Date().toISOString(),correction_note:null,signature_full_name:e||null,signature_confirmed_at:new Date().toISOString()}).eq("id",t);if(a)throw a}async function ge(t,e){const{error:a}=await S.from("personal_reports").update(e).eq("id",t);if(a)throw a}async function $r(t){const e=(t||[]).map(n=>String(n||"").trim()).filter(Boolean);if(!e.length)return;const a=new Date().toISOString(),{error:r}=await S.from("personal_reports").update({status:"paid",paid_at:a,updated_at:a}).in("id",e).eq("status","approved");if(r)throw r}async function xr(t,e){var i;const a=String(e||"").trim();if(!a)throw new Error("correction_note_required");const{error:r}=await S.rpc("return_personal_report_for_correction",{p_report_id:t,p_correction_note:a});if(!r)return;if(!/function .*return_personal_report_for_correction|schema cache|PGRST202/i.test(String(r.message||r.code||"")))throw r;const n=await pe(t,{force:!0});if((n==null?void 0:n.status)==="paid")throw new Error("report_paid_not_returnable");if(!["submitted","approved"].includes(n==null?void 0:n.status))throw new Error("report_status_not_returnable");const{error:s}=await S.from("personal_reports").update({status:"needs_correction",correction_note:a,correction_requested_at:new Date().toISOString(),correction_requested_by:((i=$==null?void 0:$.user)==null?void 0:i.id)||null,finance_notes:a}).eq("id",t);if(s)throw s}async function kr(t){const[{data:e,error:a},{data:r,error:n}]=await Promise.all([S.from("declared_travel_entries").select("*").eq("report_id",t).order("travel_date"),S.from("public_transport_entries").select("*").eq("report_id",t).order("travel_date")]);if(a)throw a;if(n)throw n;return[...(e||[]).map(s=>({...s,travel_type:"km",entry_table:"declared_travel_entries"})),...(r||[]).map(s=>({...s,travel_type:"public_transport",roundtrip_km:0,entry_table:"public_transport_entries"}))].sort((s,i)=>String(s.travel_date||"").localeCompare(String(i.travel_date||"")))}async function va(t){const{data:e,error:a}=await S.from("expense_entries").select("*").eq("report_id",t).order("expense_date");if(a)throw a;return e||[]}async function ga(t){const{data:e,error:a}=await S.from("report_attachments").select("*").eq("report_id",t).order("uploaded_at");if(a)throw a;return e||[]}async function wa(t){const{data:e,error:a}=await S.from("absence_entries").select("*").eq("report_id",t).order("start_date");if(a)throw a;return e||[]}async function ue(t,{force:e=!1}={}){const a=Ne({reportId:t});if(e)Mt({reportId:t});else{const s=Bt.get(a);if(s)return tt("load skipped duplicate",a),s}const n=await Yt(a,async()=>{const[s,i,o]=await Promise.all([kr(t),va(t),wa(t)]);let d=[];try{d=await ga(t)}catch(c){console.error("[personal-reports] loadReportBundle: fetchAttachments failed, report_id=%s",t,c)}return{travel:s,expenses:i,absences:o,attachments:d}},{force:e})||Bt.get(a);if(!n)throw new Error("personal_reports_bundle_unavailable");return Bt.set(a,n),n}async function Sr(t){const e={...t,calculated_days:ae(t.start_date,t.end_date)};if(e.id){const{data:n,error:s}=await S.from("absence_entries").update(e).eq("id",e.id).select().single();if(s)throw s;return n}const{data:a,error:r}=await S.from("absence_entries").insert(e).select().single();if(r)throw r;return a}async function Er(t){const{travel_type:e="km",id:a,...r}=t;if(!(e==="public_transport")){const c={p_report_id:r.report_id,p_travel_date:r.travel_date||null,p_origin:r.origin||"",p_destination:r.destination||"",p_description:r.description||"",p_roundtrip_km:Number(r.roundtrip_km)||0,p_notes:r.notes||"",p_entry_id:a||null};console.error("[declared_travel] payload before upsert:",JSON.stringify(c));const{data:m,error:y}=await S.rpc("upsert_declared_travel_entry",c);if(y)throw console.error("[declared_travel] upsert error:",y.message,y.code,y.details,"payload:",JSON.stringify(c)),y;return{...Array.isArray(m)?m[0]:m,travel_type:"km",entry_table:"declared_travel_entries"}}const s="public_transport_entries",i=Object.fromEntries(Object.entries(r).filter(([c])=>c!=="roundtrip_km"));if(a){const{data:c,error:m}=await S.from(s).update(i).eq("id",a).select().single();if(m)throw m;return{...c,travel_type:e,entry_table:s}}const{data:o,error:d}=await S.from(s).insert(i).select().single();if(d)throw d;return{...o,travel_type:e,entry_table:s}}async function Rr(t){if(t.id){const{data:r,error:n}=await S.from("expense_entries").update(t).eq("id",t.id).select().single();if(n)throw n;return r}const{data:e,error:a}=await S.from("expense_entries").insert(t).select().single();if(a)throw a;return e}async function Ge(t,e){const{error:a}=await S.from(t).delete().eq("id",e);if(a)throw a}async function we(t,e,a,r){const n=r.name.split(".").pop(),s=`${e}/${t}/${Date.now()}_${Math.random().toString(36).slice(2)}.${n}`,{error:i}=await S.storage.from("personal-report-attachments").upload(s,r,{upsert:!1});if(i)throw i;const o={report_id:t,employee_id:e,storage_path:s,file_name:r.name,file_type:r.type,file_size:r.size};a!=null&&a.expenseEntryId&&(o.expense_entry_id=a.expenseEntryId),a!=null&&a.absenceEntryId&&(o.absence_entry_id=a.absenceEntryId);const{error:d}=await S.from("report_attachments").insert(o);if(d)throw d}async function $a(t){const{data:e,error:a}=await S.storage.from("personal-report-attachments").createSignedUrl(t,60);if(a)throw a;return e.signedUrl}async function Tr(t){await S.storage.from("personal-report-attachments").remove([t.storage_path]),await S.from("report_attachments").delete().eq("id",t.id)}async function qr(){var r;const t=await Fa();if(!((r=t==null?void 0:t.user)!=null&&r.id))throw new Error("unauthorized");const{data:e,error:a}=await S.from("profiles").select("id, full_name, email, role, is_active, can_access_personal_reports").order("full_name");if(a)throw a;return(e||[]).filter(n=>n.is_active!==!1&&$t(n.can_access_personal_reports))}async function Ar(t,e){const{data:a,error:r}=await S.from("personal_reports").select("*, profiles!personal_reports_employee_id_fkey(full_name, email)").eq("report_month",t).eq("report_year",e);if(r)throw r;return a||[]}async function Mr(t,e){const[a,r]=await Promise.all([qr(),Ar(t,e)]),n=await Nr(r),s=new Map(n.map(i=>[i.employee_id,i]));return a.map(i=>{const o=s.get(i.id)||null;return{employee:i,report:o,reportId:(o==null?void 0:o.id)||"",reportStatus:(o==null?void 0:o.status)||"",manageStatus:Za(o),month:t,year:e,totals:(o==null?void 0:o.totals)||{travel:0,expenses:0,all:0},workDays:(o==null?void 0:o.work_days_in_month)??null}})}async function xa(t=st,{force:e=!1}={}){const a={month:Ut(t.month||vt()),status:t.status||""},r=Wa(a);if(!e&&Et&&dt.has(r))return tt("load skipped duplicate",r),Et;e&&Mt({allReports:!0});const{month:n,year:s}=se(a.month),o=await Yt(r,()=>Mr(n,s),{force:e})||Et;if(!o)throw new Error("personal_reports_admin_list_unavailable");return Et=o,st={...a},o}async function Pr(t,e,a,{force:r=!1}={}){const n=await vr(t,e,a,{force:r});let s={travel:0,expenses:0,all:0},i={vacation:0,sick:0,declaration:0};if(n!=null&&n.id){const o=await ue(n.id,{force:r}),d=((o==null?void 0:o.travel)||[]).reduce((m,y)=>m+Number(y.amount||0),0),c=((o==null?void 0:o.expenses)||[]).reduce((m,y)=>m+Number(y.amount||0),0);s={travel:d,expenses:c,all:d+c},i={vacation:X((o==null?void 0:o.absences)||[],"vacation"),sick:X((o==null?void 0:o.absences)||[],"sick"),declaration:X((o==null?void 0:o.absences)||[],"declaration")}}return{report:n,totals:s,absences:i,workDays:(n==null?void 0:n.work_days_in_month)??null,myStatus:da(n,s)}}async function Nr(t){const e=t.map(i=>i.id).filter(Boolean);if(!e.length)return t;const[a,r,n]=await Promise.all([S.from("declared_travel_entries").select("report_id, amount").in("report_id",e),S.from("public_transport_entries").select("report_id, amount").in("report_id",e),S.from("expense_entries").select("report_id, amount").in("report_id",e)]);if(a.error)throw a.error;if(r.error)throw r.error;if(n.error)throw n.error;const s=new Map(e.map(i=>[i,{travel:0,expenses:0}]));for(const i of a.data||[])s.get(i.report_id).travel+=Number(i.amount||0);for(const i of r.data||[])s.get(i.report_id).travel+=Number(i.amount||0);for(const i of n.data||[])s.get(i.report_id).expenses+=Number(i.amount||0);return t.map(i=>{const o=s.get(i.id)||{travel:0,expenses:0};return{...i,totals:{...o,all:o.travel+o.expenses}}})}function w(t,e="info"){const a=document.getElementById("pr-toast");a&&(a.textContent=t,a.className=`pr-toast pr-toast--${e} pr-toast--visible`,clearTimeout(a._t),a._t=setTimeout(()=>a.classList.remove("pr-toast--visible"),3500))}function Je(t){const e=String(t??"");return/[",\n\r]/.test(e)?`"${e.replace(/"/g,'""')}"`:e}function Lr(t){var e;return((e=Pe[t])==null?void 0:e.label)||t||"—"}function Ir(t=""){return t?"הורדת טבלה":"הורדת כל העובדים לחודש זה"}function Xe(t=st){const e=Et||[],a=String(t.status||"").trim();return a?e.filter(r=>r.manageStatus===a):e}function Dr(t,e){const r=[["שם עובד","חודש דיווח","סטטוס","נסיעות","הוצאות","ימי עבודה","תאריך שליחה","תאריך אישור","הערות / החזרה לתיקון"].map(Je).join(",")];for(const o of t){const d=o.employee||{},c=o.report||null,m=o.totals||{travel:0,expenses:0},y=o.workDays===null||o.workDays===void 0||o.workDays===""?"":M(o.workDays);r.push([d.full_name||"—",lt(o.month,o.year),Lr(o.manageStatus),P(m.travel),P(m.expenses),y,c!=null&&c.submitted_at?U(String(c.submitted_at).slice(0,10)):"",c!=null&&c.approved_at?U(String(c.approved_at).slice(0,10)):"",(c==null?void 0:c.finance_notes)||""].map(Je).join(","))}const n=new Blob([`\uFEFF${r.join(`
`)}`],{type:"text/csv;charset=utf-8"}),s=URL.createObjectURL(n),i=document.createElement("a");i.href=s,i.download=`personal-reports-${e}.csv`,i.click(),URL.revokeObjectURL(s)}function Rt(t,e,a,r="",n=""){const s=r?` class="${l(r)}"`:"",i=`<thead><tr>${t.map(d=>`<th>${l(d)}</th>`).join("")}</tr></thead>`,o=e.length?e.join(""):`<tr><td colspan="${a}" class="empty">אין רשומות</td></tr>`;return`<table${s}>${n}${i}<tbody>${o}</tbody></table>`}function rt(t){if(t==null)return!1;if(typeof t=="number")return Number.isFinite(t)&&t!==0;const e=String(t).trim();if(!e)return!1;const a=e.replace(/[₪,%\s,]/g,"");return a&&!Number.isNaN(Number(a))?Number(a)!==0:!0}function ot(t,e,{total:a=!1}={}){return`<div class="box${a?" box--total":""}"><span class="label">${l(t)}</span><span class="value">${l(e)}</span></div>`}const Cr='<colgroup><col class="print-col-date"><col class="print-col-place"><col class="print-col-place"><col class="print-col-detail"><col class="print-col-km"><col class="print-col-money"></colgroup>',Or='<colgroup><col class="print-col-date"><col class="print-col-place"><col class="print-col-place"><col class="print-col-detail"><col class="print-col-money"></colgroup>',jr=new Set(["approved","paid"]);function Qe(t={}){return jr.has(String((t==null?void 0:t.status)||"").trim())}function Ze(t){if(!t)return"—";const e=new Date(t);return Number.isNaN(e.getTime())?U(String(t).slice(0,10)):e.toLocaleString("he-IL")}function ka(){return`
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,'Assistant',sans-serif;margin:24px;color:#0f172a;direction:rtl;background:#fff;font-size:12px;line-height:1.35}h1{font-size:22px;margin:0 0 12px}h2{font-size:15px;margin:16px 0 8px}h3{font-size:13px;margin:12px 0 6px;color:#1e293b}.meta,.summary{display:grid;grid-template-columns:repeat(2,minmax(140px,1fr));gap:6px;max-width:100%}.box{border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc;min-height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow-wrap:anywhere}.box--total{background:#ecfeff;border-color:#67e8f9}.label{display:block;font-size:10px;color:#64748b}.value{font-weight:700;line-height:1.3}.employee-page{break-before:page;page-break-before:always;padding-bottom:8mm}.employee-page:first-of-type{break-before:auto;page-break-before:auto}.section-card{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-top:10px;break-inside:auto;page-break-inside:auto;overflow:visible}.section-card h2:first-child{display:block;margin:-10px -12px 8px;padding:8px 12px 7px;line-height:1.35;text-align:right;direction:rtl;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#1e293b}.print-actions{margin-bottom:14px}.print-total{font-weight:700;background:#f8fafc}.financial-summary{border:2px solid #0f766e;background:#f0fdfa}.financial-summary h2{color:#0f766e;background:#dcfce7;border-bottom-color:#6ee7b7}.summary-note{font-size:11px;color:#475569;margin:6px 0 0}.cover-page{break-after:page;page-break-after:always}.cover-note{border:1px solid #bae6fd;background:#f0f9ff;border-radius:10px;padding:10px;margin:8px 0 12px}.print-totals-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0}.print-summary-table th,.print-summary-table td,.print-workdays-table th,.print-workdays-table td{text-align:center;vertical-align:middle}.print-summary-table .print-col-employee{width:21%}.print-summary-table .print-col-status{width:11%}.print-summary-table .print-col-km-total{width:10%}.print-summary-table .print-col-money{width:14.5%}.print-workdays-table .print-col-employee{width:32%}.print-workdays-table .print-col-work-status{width:68%}.signature-box{border:1px solid #94a3b8;border-radius:10px;padding:10px;background:#fff}.signature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.signature-block{border:1px solid #cbd5e1;border-radius:8px;padding:8px;break-inside:avoid;page-break-inside:avoid}.signature-text{font-weight:700;margin:0 0 6px}.notes-box{white-space:pre-wrap}.attachment-table .print-col-detail{width:34%}table{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;table-layout:fixed}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:right;vertical-align:top;overflow-wrap:anywhere;word-break:normal;max-width:0}th{background:#e2e8f0}.print-col-date{width:14%}.print-col-place{width:18%}.print-col-detail{width:30%}.print-col-km{width:10%}.print-col-money{width:10%}.print-table--public .print-col-detail{width:32%}.print-table--public .print-col-money{width:18%}.print-table--travel td:nth-child(1),.print-table--travel th:nth-child(1),.print-table--travel td:nth-child(5),.print-table--travel th:nth-child(5),.print-table--travel td:nth-child(6),.print-table--travel th:nth-child(6),.print-table--public td:nth-child(1),.print-table--public th:nth-child(1),.print-table--public td:nth-child(5),.print-table--public th:nth-child(5){white-space:nowrap;overflow-wrap:normal}.print-table--travel td:nth-child(4),.print-table--public td:nth-child(4){white-space:normal;overflow-wrap:anywhere}.empty{text-align:center;color:#64748b}.num{text-align:center;direction:ltr;white-space:nowrap}.muted{color:#64748b}@media print{.print-actions{display:none}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}table{page-break-inside:auto}tr{page-break-inside:avoid;break-inside:avoid}.section-card h2{break-after:avoid;page-break-after:avoid}.box,.signature-box{break-inside:avoid;page-break-inside:avoid}}.print-date{text-align:center}.print-attach{text-align:center}.print-table--travel th:nth-child(1),.print-table--travel th:nth-child(5),.print-table--travel th:nth-child(6){text-align:center}.print-table--public th:nth-child(1),.print-table--public th:nth-child(5){text-align:center}.print-table--expenses th:nth-child(1),.print-table--expenses th:nth-child(4),.print-table--expenses th:nth-child(5){text-align:center}.print-table--absences th:nth-child(2),.print-table--absences th:nth-child(3),.print-table--absences th:nth-child(4){text-align:center}
  `}function Sa({report:t,profile:e,travel:a=[],expenses:r=[],absences:n=[],attachments:s=[],forcedStatus:i=""}={}){const o=(e==null?void 0:e.full_name)||(e==null?void 0:e.email)||"—",{kmTravel:d,publicTransport:c}=me(a),m=be(d),y=bt(d),p=bt(c),v=y+p,x=r.reduce((T,at)=>T+Number(at.amount||0),0),g=X(n,"vacation"),R=X(n,"sick"),I=X(n,"declaration"),h=g+R+I,u=v+x,f=oe(t.report_month,t.report_year),_=t.work_days_in_month===null||t.work_days_in_month===void 0?"חודש מלא":M(Number(t.work_days_in_month)),k=i||Tt[t.status]||t.status||"—",N=d.map(T=>`<tr><td class="print-date">${U(T.travel_date)}</td><td>${l(T.origin||"")}</td><td>${l(T.destination||"")}</td><td>${l(T.description||"")}</td><td class="num">${M(T.roundtrip_km)}</td><td class="num">₪${P(T.amount)}</td></tr>`),B=c.map(T=>`<tr><td class="print-date">${U(T.travel_date)}</td><td>${l(T.origin||"")}</td><td>${l(T.destination||"")}</td><td>${l(T.description||"")}</td><td class="num">₪${P(T.amount)}</td></tr>`),b=r.map(T=>{const at=mt(s,"expense_entry_id",T.id),Nt=Ie(T,at),he=T.document_type==="receipt"?"קבלה":T.document_type==="invoice"?"חשבונית":T.document_type||"אחר";return`<tr><td class="print-date">${U(T.expense_date)}</td><td>${l(T.description||"")}</td><td>${l(he)}</td><td class="num">₪${P(T.amount)}</td><td class="print-attach">${at?"📎":l(Nt.label)}</td></tr>`}),E=n.map(T=>{const at=mt(s,"absence_entry_id",T.id),Nt=De(T,at);return`<tr><td>${l(Le(T.absence_type))}</td><td class="print-date">${U(T.start_date)}</td><td class="print-date">${U(T.end_date)}</td><td class="num">${M(le(T))}</td><td class="print-attach">${at?"📎":l(Nt.label)}</td><td>${l(T.notes||"")}</td></tr>`}),C=String(t.employee_notes||t.notes||"").trim(),W=String(t.finance_notes||t.manager_notes||t.correction_note||"").trim(),z=String(t.signature_full_name||o).trim()||"—",et=Ze(t.signature_confirmed_at||t.submitted_at),G=Ze(t.authorized_approved_at||t.approved_at||t.paid_at),Y=[];if(N.length){const T=[...N];(rt(m)||rt(y))&&T.push(`<tr class="print-total"><td colspan="4">סה״כ נסיעות לפי ק״מ</td><td class="num">${M(m)}</td><td class="num">₪${P(y)}</td></tr>`),Y.push(`<section class="section-card"><h2>נסיעות לפי ק״מ</h2>${Rt(["תאריך","מוצא","יעד","פירוט","ק״מ","סכום"],T,6,"print-table--travel",Cr)}</section>`)}if(B.length){const T=[...B];rt(p)&&T.push(`<tr class="print-total"><td colspan="4">סה״כ תחבורה ציבורית</td><td class="num">₪${P(p)}</td></tr>`),Y.push(`<section class="section-card"><h2>תחבורה ציבורית</h2>${Rt(["תאריך","מוצא","יעד","פירוט","סכום"],T,5,"print-table--public",Or)}</section>`)}if(b.length&&Y.push(`<section class="section-card"><h2>הוצאות</h2>${Rt(["תאריך","פירוט","סוג","סכום","אסמכתא / קובץ"],b,5,"print-table--expenses")}</section>`),Y.push(`<section class="section-card"><h2>מצב חודשי</h2><p>${l(ua(n))}</p></section>`),E.length&&Y.push(`<section class="section-card"><h2>היעדרויות / ימים</h2>${Rt(["סוג","מתאריך","עד תאריך","ימים","אסמכתא","הערות"],E,6,"print-table--absences")}</section>`),C||W){const T=[C?`<strong>הערות עובד:</strong> ${l(C)}`:"",W?`<strong>הערות מנהל / כספים:</strong> ${l(W)}`:""].filter(Boolean).join("<br>");Y.push(`<section class="section-card"><h2>הערות</h2><div class="notes-box">${T}</div></section>`)}const it=[rt(m)?ot("סה״כ ק״מ",M(m)):"",rt(y)?ot("סה״כ תשלום עבור ק״מ",`₪${P(y)}`):"",rt(p)?ot("סה״כ תחבורה ציבורית",`₪${P(p)}`):"",rt(x)?ot("סה״כ החזר הוצאות",`₪${P(x)}`):"",rt(t.work_days_in_month)?ot("ימי עבודה / שכר",_):"",rt(g)?ot("ימי חופש",M(g)):"",rt(R)?ot("ימי מחלה",M(R)):"",rt(I)||rt(h)?ot("ימי הצהרה / היעדרות",`${M(I)} / ${M(h)}`):"",ot("סה״כ החזרים לכל הדוח",`₪${P(u)}`,{total:!0})].filter(Boolean).join("");return`<section class="employee-page">
    <h1>דוח אישי לשכר — ${l(o)}</h1>
    <section class="meta" aria-label="פרטי דיווח כלליים">
      <div class="box"><span class="label">שם העובד</span><span class="value">${l(o)}</span></div>
      <div class="box"><span class="label">חודש הדיווח</span><span class="value">${l(lt(t.report_month,t.report_year))}</span></div>
      <div class="box"><span class="label">תקופת דיווח</span><span class="value">${l(f.label)}</span></div>
      <div class="box"><span class="label">סטטוס</span><span class="value">${l(k)}</span></div>
    </section>
    ${Y.join("")}
    <section class="section-card financial-summary"><h2>סיכום מאושר לתשלום</h2><section class="summary">${it}</section><p class="summary-note">הסיכום משתמש באותם נתוני נסיעות, תחבורה ציבורית והוצאות של הדוח האישי.</p></section>
    <section class="section-card"><h2>אישורים</h2><div class="signature-box signature-grid"><div class="signature-block"><p class="signature-text">אישור העובד:</p><p class="signature-text">אני מאשר/ת כי הפרטים שדווחו על ידי נכונים ומלאים.</p><div>שם העובד שחתם: <strong>${l(z)}</strong></div><div>תאריך ושעת חתימה: <strong>${l(et)}</strong></div></div><div class="signature-block"><p class="signature-text">אישור גורם מוסמך:</p><p class="signature-text">אני מאשר כי בדקתי את הנתונים והדוחות וכי הם מאושרים להמשך טיפול שכר / החזרים.</p><div>שם הגורם המאשר: <strong>עידן נחום</strong></div><div>תפקיד: <strong>סמנכ״ל כספים ותפעול</strong></div><div>תאריך ושעת אישור: <strong>${l(G)}</strong></div></div></div></section>
  </section>`}function me(t=[]){return{kmTravel:t.filter(e=>e.travel_type!=="public_transport"),publicTransport:t.filter(e=>e.travel_type==="public_transport")}}function be(t=[]){return t.reduce((e,a)=>e+Number(a.roundtrip_km||0),0)}function bt(t=[]){return t.reduce((e,a)=>e+Number(a.amount||0),0)}async function Wt(t,e="אושר לשכר"){const a=await pe(t,{force:!0}),[r,n]=await Promise.all([Fe(a.employee_id,{force:!0}),ue(t,{force:!0})]),s=`דוח אישי חודשי לשכר - ${(r==null?void 0:r.full_name)||"עובד"} - ${lt(a.report_month,a.report_year)}`,i=`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${l(s)}</title>
    <style>${ka()}</style></head><body>
    <div class="print-actions"><button onclick="window.print()">הדפסה / שמירה כ-PDF</button></div>
    ${Sa({report:a,profile:r,...n,forcedStatus:e})}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script>
    </body></html>`,o=window.open("","_blank","width=900,height=1100");o&&(o.document.write(i),o.document.close())}function Fr({monthValue:t,items:e}){const a='<colgroup><col class="print-col-employee"><col class="print-col-status"><col class="print-col-km-total"><col class="print-col-money"><col class="print-col-money"><col class="print-col-money"><col class="print-col-money"></colgroup>',r='<colgroup><col class="print-col-employee"><col class="print-col-work-status"></colgroup>',n=e.map(i=>`<tr><td>${l(i.employeeName)}</td><td>${l(i.statusLabel)}</td><td class="num">${M(i.totalKmTravelKm)}</td><td class="num">₪${P(i.totalKmTravel)}</td><td class="num">₪${P(i.totalPublicTransport)}</td><td class="num">₪${P(i.totalExpenses)}</td><td class="num">₪${P(i.totalPayable)}</td></tr>`),s=e.map(i=>`<tr><td>${l(i.employeeName)}</td><td>${l(i.workStatusLabel)}</td></tr>`);return`<section class="cover-page">
    <h1>דוח הוצאות מסכם חודשי לשכר</h1>
    <section class="meta">
      <div class="box"><span class="label">חודש דיווח</span><span class="value">${l(t)}</span></div>
    </section>
    <section class="section-card"><h2>טבלת סיכום כל העובדים</h2>${Rt(["עובד","סטטוס","סה״כ ק״מ","נסיעות לפי ק״מ","תחבורה ציבורית","הוצאות","סה״כ לתשלום"],n,7,"print-summary-table",a)}</section>
    <section class="section-card"><h2>סיכום ימי עבודה</h2>${Rt(["עובד","סטטוס חודש"],s,2,"print-workdays-table",r)}</section>
  </section>`}async function Br(t,e){var d;const a=(t||[]).filter(c=>{var m;return String(c.reportId||((m=c.report)==null?void 0:m.id)||"").trim()&&Qe(c.report||{status:c.manageStatus})});if(!a.length){w("אין דוחות שאושרו לשכר / אושרו סופית להדפסה עבור הסינון הנוכחי","info");return}const r=[],n=[];for(const c of a){const m=String(c.reportId||((d=c.report)==null?void 0:d.id)||"").trim(),y=await pe(m,{force:!0});if(!Qe(y))continue;const[p,v]=await Promise.all([Fe(y.employee_id,{force:!0}),ue(m,{force:!0})]),{kmTravel:x,publicTransport:g}=me(v.travel||[]),R=be(x),I=bt(x),h=bt(g),u=(v.expenses||[]).reduce((k,N)=>k+Number(N.amount||0),0),f=I+h+u,_=Tt[y.status]||y.status||"—";r.push({employeeName:(p==null?void 0:p.full_name)||(p==null?void 0:p.email)||"—",statusLabel:_,totalKmTravelKm:R,totalKmTravel:I,totalPublicTransport:h,totalExpenses:u,totalPayable:f,workStatusLabel:ua(v.absences||[])}),n.push(Sa({report:y,profile:p,...v,forcedStatus:_}))}if(!r.length){w("אין דוחות שאושרו לשכר / אושרו סופית להדפסה עבור הסינון הנוכחי","info");return}const s=`דוח הוצאות מסכם חודשי לשכר - ${e}`,i=`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${l(s)}</title>
    <style>${ka()}</style></head><body>
    <div class="print-actions"><button onclick="window.print()">הדפסה / שמירה כ-PDF</button></div>
    ${Fr({monthValue:e,items:r})}
    ${n.join("")}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script>
    </body></html>`,o=window.open("","_blank","width=900,height=1100");o&&(o.document.write(i),o.document.close())}function Ea(t){return`
    <div class="pr-simulation-banner" role="alert" dir="rtl">
      <span class="pr-simulation-banner__label">תצוגת אדמין כעובד:</span>
      <strong class="pr-simulation-banner__name">${l(t)}</strong>
      <button class="pr-btn pr-btn--ghost pr-btn--sm pr-simulation-banner__exit" data-pr-action="exit-simulation">← חזרה למסך ניהול</button>
    </div>
  `}function fe(t,{showManagement:e=!0}={}){return`
    <div class="pr-screen-mode-switch" role="tablist" aria-label="דוחות אישיים ומשובים">
      <button class="pr-report-tab${t===j.MY_REPORTS?" is-active":""}" data-pr-action="screen-mode-my-reports" type="button" role="tab" aria-selected="${t===j.MY_REPORTS?"true":"false"}">הדוחות שלי</button>
      ${e?`<button class="pr-report-tab${t===j.MANAGEMENT?" is-active":""}" data-pr-action="screen-mode-management" type="button" role="tab" aria-selected="${t===j.MANAGEMENT?"true":"false"}">ניהול דוחות עובדים</button>`:""}
      <button class="pr-report-tab${t===j.REVIEWS?" is-active":""}" data-pr-action="screen-mode-reviews" type="button" role="tab" aria-selected="${t===j.REVIEWS?"true":"false"}">משובים</button>
    </div>
  `}function Hr(t={},e=null,a={}){const r=e==null||e===""?"חודש מלא":M(e),n=[Number(a.vacation||0)>0?`<div class="pr-my-report-summary__item"><span class="pr-my-report-summary__label">חופש</span><strong class="pr-my-report-summary__value">${M(a.vacation)}</strong></div>`:"",Number(a.sick||0)>0?`<div class="pr-my-report-summary__item"><span class="pr-my-report-summary__label">מחלה</span><strong class="pr-my-report-summary__value">${M(a.sick)}</strong></div>`:"",Number(a.declaration||0)>0?`<div class="pr-my-report-summary__item"><span class="pr-my-report-summary__label">הצהרה</span><strong class="pr-my-report-summary__value">${M(a.declaration)}</strong></div>`:""].filter(Boolean).join("");return`
    <div class="pr-my-report-summary" aria-label="סיכום קצר">
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">סה״כ נסיעות</span>
        <strong class="pr-my-report-summary__value">₪${P(t.travel||0)}</strong>
      </div>
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">סה״כ הוצאות</span>
        <strong class="pr-my-report-summary__value">₪${P(t.expenses||0)}</strong>
      </div>
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">ימי עבודה</span>
        <strong class="pr-my-report-summary__value">${l(r)}</strong>
      </div>
      ${n}
    </div>
  `}function zr(t){return`
    <section class="pr-card pr-month-selector-card" aria-label="בחירת חודש לדוחות אישיים">
      <label class="pr-label">בחירת חודש
        <select class="pr-input pr-input--select pr-input--month-compact" id="pr-my-report-month">
          ${ma(t)}
        </select>
      </label>
    </section>
  `}function Ur(){return`
    <div class="pr-no-report-state" role="status">
      <p class="pr-no-report-msg">לא נמצא דוח לחודש זה</p>
    </div>
  `}function Vr(t,e,a,r){const n=`data-report-month="${a}" data-report-year="${r}"`,s=e!=null&&e.id?` data-report-id="${l(e.id)}"`:"";return t==="not_started"?`<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${n}>מילוי דוח</button>`:t==="in_progress"?`<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${n}>המשך מילוי</button>`:t==="needs_correction"?`<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${n}>עריכת תיקונים</button>`:t==="submitted"||t==="approved"?`
      <button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="view-my-report"${s}>צפייה בדוח</button>
      <button class="pr-btn pr-btn--ghost pr-btn--lg" type="button" data-pr-action="download-report-pdf"${s}>הורדת PDF</button>
    `:`<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${n}>מילוי דוח</button>`}function Wr(t,{isSimulation:e=!1,cardData:a=null,showModeTabs:r=!1,selectedMonthValue:n=Pt()}={}){const s=de(n),{month:i,year:o}=ce(s),d=lt(i,o),c=oe(i,o),m=(a==null?void 0:a.report)||null,y=(a==null?void 0:a.totals)||{travel:0,expenses:0},p=(a==null?void 0:a.workDays)??null,v=(a==null?void 0:a.myStatus)||da(m,y),x=ar(v),g=Vr(v,m,i,o),R=r?fe(j.MY_REPORTS,{showManagement:_t($==null?void 0:$.profile)}):"",I=or(i,o),h=I?"דוח אישי לחודש הנוכחי":`דוח אישי — ${d}`,f=!!m||I?`
          <div class="pr-my-report-card__meta">
            <div class="pr-my-report-card__meta-item">
              <span class="pr-month-label">חודש דיווח</span>
              <strong>${l(d)}</strong>
              <span class="pr-my-report-card__period">${l(c.label)}</span>
            </div>
            <div class="pr-my-report-card__meta-item">
              <span class="pr-month-label">סטטוס</span>
              ${x}
            </div>
          </div>
          ${Hr(y,p,(a==null?void 0:a.absences)||{})}
          <div class="pr-my-report-card__actions">${g}</div>
  `:Ur();return`
    <div class="pr-screen pr-screen--my-reports" dir="rtl">
      ${e?Ea(t.full_name):""}
      <div class="pr-topbar">
        ${e?'<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="exit-simulation">← חזרה למסך ניהול</button>':'<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>'}
        <span class="pr-topbar__title">דוחות אישיים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-landing-body">
        ${R}
        ${zr(s)}
        <section class="pr-card pr-my-report-card" aria-label="הדוחות שלי">
          <div class="pr-my-report-card__header">
            <div>
              <span class="pr-eyebrow">הדוחות שלי</span>
              <h1 class="pr-my-report-card__title">${l(h)}</h1>
            </div>
            <span class="pr-my-report-card__employee">${l(t.full_name||"")}</span>
          </div>
          ${f}
        </section>
      </div>
    </div>
  `}function $e(t){const e=Number(t||0).toLocaleString("he-IL");return`<span class="pr-tab-count">${l(e)}</span>`}function Gt(t,e=""){return`<p class="pr-compact-empty">${e?`<span aria-hidden="true">${l(e)}</span>`:""}<span>${l(t)}</span></p>`}function Jt(t,e,{html:a=!1}={}){return e==null||e===""?"":`
    <div class="pr-info-row">
      <span class="pr-info-label">${l(t)}</span>
      <span class="pr-info-value">${a?e:l(String(e))}</span>
    </div>
  `}const Ra={edit:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',delete:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',receipt:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'};function xt({icon:t,title:e,action:a,attrs:r="",danger:n=!1}={}){return`<button class="pr-icon-btn${n?" pr-icon-btn--danger":""}" type="button" title="${l(e)}" aria-label="${l(e)}" data-pr-action="${l(a)}" ${r}>${Ra[t]||""}</button>`}function ta({icon:t,title:e,attrs:a=""}={}){return`<label class="pr-icon-btn pr-upload-icon-btn" title="${l(e)}" aria-label="${l(e)}">${Ra[t]||""}<input type="file" class="pr-file-input" accept="image/*,.pdf" ${a} /></label>`}function Yr(t,e){const a=String((t==null?void 0:t.full_name)||"").trim(),r=String((e==null?void 0:e.signature_full_name)||"").trim();return a||r}function Kr(t,e,a,r,n,s){const i=[Jt("תקופת דיווח",e.label),Jt("הודעת תיקון מהמנהל",pa(t)),Jt("תאריך החזרה לתיקון",n),Jt("נשלח מחדש",s)].filter(Boolean).join("");return!(t.status!=="draft"||!!(t.finance_notes||n||s))||!i?`<div class="pr-status-compact" aria-label="סטטוס נוכחי">${a}</div>`:`
    <details class="pr-status-accordion">
      <summary class="pr-status-accordion__summary">
        <span class="pr-status-accordion__status">${a}</span>
        <span class="pr-status-accordion__hint" aria-hidden="true">▾</span>
      </summary>
      <div class="pr-status-accordion__body">${i}</div>
    </details>
  `}function kt(t,e,{highlight:a=!1}={}){return e==null||e===""?"":`
    <div class="pr-sum-item${a?" pr-sum-item--total":""}">
      <span class="pr-sum-label">${l(t)}</span>
      <span class="pr-sum-value">${l(e)}</span>
    </div>
  `}function Gr(t,e,a,r,n,s,{isSimulation:i=!1}={}){const o=ba(t),d=lt(t.report_month,t.report_year),c=oe(t.report_month,t.report_year),m=At(Tt[t.status]||t.status,Me[t.status]||"neutral"),y=Tt[t.status]||t.status,{kmTravel:p,publicTransport:v}=me(e),x=be(p),g=bt(p),R=bt(v),I=g+R,h=a.reduce((L,D)=>L+Number(D.amount||0),0),u=X(r,"vacation"),f=X(r,"sick"),_=X(r,"declaration"),k=r.map(L=>{const D=mt(n,"absence_entry_id",L.id),ct=De(L,D),Lt=o?`
      <div class="pr-td-actions-group">
        ${ta({icon:"receipt",title:"צרף אסמכתא להיעדרות",attrs:`data-entry-id="${l(L.id)}" data-entry-type="absence"`})}
        ${xt({icon:"edit",title:"עריכה",action:"edit-absence",attrs:`data-entry-id="${l(L.id)}" data-absence-type="${l(L.absence_type)}" data-start-date="${l(L.start_date)}" data-end-date="${l(L.end_date)}" data-notes="${l(L.notes||"")}"`})}
        ${xt({icon:"delete",title:"מחיקה",action:"delete-entry",danger:!0,attrs:`data-entry-id="${l(L.id)}" data-entry-table="absence_entries"`})}
      </div>`:"";return`
      <tr class="pr-data-row" data-id="${l(L.id)}">
        <td class="pr-col-type">${l(Le(L.absence_type))}</td>
        <td class="pr-td-date">${U(L.start_date)}</td>
        <td class="pr-td-date">${U(L.end_date)}</td>
        <td class="pr-td-num">${M(le(L))}</td>
        <td class="pr-col-status"><span class="pr-attachment-status ${ct.missing?"is-missing":"is-attached"}">${l(ct.label)}</span></td>
        <td class="pr-td-actions">${Lt}</td>
      </tr>`}).join(""),N=r.length>0?`
      <div class="pr-table-scroll pr-entries-table-wrap">
        <table class="pr-data-table pr-entries-table">
          <thead>
            <tr>
              <th class="pr-col-type">סוג</th>
              <th class="pr-col-date">מתאריך</th>
              <th class="pr-col-date">עד תאריך</th>
              <th class="pr-col-num pr-th-num">ימים</th>
              <th class="pr-col-status">אסמכתא</th>
              <th class="pr-col-actions pr-th-actions"></th>
            </tr>
          </thead>
          <tbody>${k}</tbody>
        </table>
      </div>`:Gt("לא דווחו ימי חופש, מחלה או הצהרה לחודש זה."),B=o?`
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="vacation">חופש</button>
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="sick">מחלה</button>
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="declaration">הצהרה</button>
  `:"",b=o?`
    <div class="pr-add-panel pr-absence-panel" id="pr-add-absence-panel" hidden>
      <form class="pr-add-form" data-form-type="absence">
        <input type="hidden" name="id" />
        <input type="hidden" name="absence_type" />
        <div class="pr-absence-fields">
          <div class="pr-form-row">
            <div class="pr-field"><label class="pr-label">מתאריך *</label><input class="pr-input pr-absence-date" type="date" name="start_date" /></div>
            <div class="pr-field"><label class="pr-label">עד תאריך *</label><input class="pr-input pr-absence-date" type="date" name="end_date" /></div>
            <div class="pr-field"><label class="pr-label">ימים מחושבים</label><input class="pr-input" type="number" name="calculated_days" readonly value="0" /></div>
          </div>
          <div class="pr-form-row">
            <div class="pr-field pr-field--wide"><label class="pr-label">אישור מחלה (נדרש רק במחלה)</label><input class="pr-input" type="file" name="attachment" accept="image/*,.pdf" /></div>
          </div>
          <div class="pr-add-form-actions">
            <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
            <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="cancel-absence-form">ביטול</button>
          </div>
        </div>
      </form>
    </div>
  `:"",E=L=>L.map(D=>{const ct=D.travel_type==="public_transport",Lt=ct?"תחבורה ציבורית":"ק״מ",Da=`${l(D.origin||"")} ← ${l(D.destination||"")}`,Ca=o?`
      <div class="pr-td-actions-group">
        ${xt({icon:"edit",title:"עריכה",action:"edit-travel",attrs:`data-entry-id="${l(D.id)}" data-entry-table="${l(D.entry_table||"declared_travel_entries")}" data-travel-type="${l(D.travel_type||"km")}" data-travel-date="${l(D.travel_date)}" data-origin="${l(D.origin||"")}" data-destination="${l(D.destination||"")}" data-description="${l(D.description||"")}" data-roundtrip-km="${l(D.roundtrip_km||"")}" data-amount="${l(D.amount||"")}" data-notes="${l(D.notes||"")}"`})}
        ${xt({icon:"delete",title:"מחיקה",action:"delete-entry",danger:!0,attrs:`data-entry-id="${l(D.id)}" data-entry-table="${l(D.entry_table||"declared_travel_entries")}"`})}
      </div>`:"";return`
      <tr class="pr-data-row" data-id="${l(D.id)}">
        <td class="pr-td-date">${U(D.travel_date)}</td>
        <td class="pr-col-type">${l(Lt)}</td>
        <td class="pr-col-detail">${Da}${D.description?`<span class="pr-td-notes"> · ${l(D.description)}</span>`:""}</td>
        <td class="pr-td-num">${ct?"—":M(D.roundtrip_km)}</td>
        <td class="pr-td-num pr-td-amount">₪${P(D.amount)}</td>
        <td class="pr-td-actions">${Ca}</td>
      </tr>`}).join(""),C=E(p),W=E(v),z=o?`
    <div class="pr-add-panel" id="pr-add-travel-panel" hidden>
      <form class="pr-add-form" id="pr-add-travel-form" data-form-type="declared_travel">
        <input type="hidden" name="id" />
        <input type="hidden" name="original_table" />
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">סוג דיווח *</label>
            <select class="pr-input pr-input--select" name="travel_type" required>
              <option value="km">נסיעה לפי ק״מ</option>
              <option value="public_transport">תחבורה ציבורית</option>
            </select></div>
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">ממקום *</label>
            <input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">למקום *</label>
            <input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט / הערות</label>
            <input class="pr-input" type="text" name="description" placeholder="תיאור הנסיעה" /></div>
          <div class="pr-field pr-travel-km-field"><label class="pr-label">ק״מ *</label>
            <input class="pr-input" type="number" name="roundtrip_km" min="0" step="0.1" required placeholder="0" /></div>
          <div class="pr-field pr-travel-public-field" hidden><label class="pr-label">עלות תחבורה ציבורית ₪ *</label>
            <input class="pr-input" type="number" name="public_transport_amount" min="0" step="0.01" placeholder="0.00" /></div>
        </div>
        <p class="pr-travel-km-note pr-travel-km-field">סכום ההחזר יחושב לאחר השמירה.</p>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="hide-add-travel">ביטול</button>
        </div>
      </form>
    </div>
  `:"",et=a.map(L=>{const D=mt(n,"expense_entry_id",L.id),ct=Ie(L,D),Lt=o?`
      <div class="pr-td-actions-group">
        ${ta({icon:"receipt",title:"צרף קבלה או אסמכתא",attrs:`data-entry-id="${l(L.id)}" data-entry-type="expense"`})}
        ${xt({icon:"edit",title:"עריכה",action:"edit-expense",attrs:`data-entry-id="${l(L.id)}" data-expense-date="${l(L.expense_date)}" data-document-type="${l(L.document_type||"receipt")}" data-description="${l(L.description||"")}" data-amount="${l(L.amount||"")}" data-notes="${l(L.notes||"")}" data-reliability-declaration="${Ce(L)?"yes":"no"}"`})}
        ${xt({icon:"delete",title:"מחיקה",action:"delete-entry",danger:!0,attrs:`data-entry-id="${l(L.id)}" data-entry-table="expense_entries"`})}
      </div>`:"";return`
      <tr class="pr-data-row" data-id="${l(L.id)}">
        <td class="pr-td-date">${U(L.expense_date)}</td>
        <td class="pr-col-detail">${l(L.description)}</td>
        <td class="pr-td-num pr-td-amount">₪${P(L.amount)}</td>
        <td class="pr-col-status" style="text-align:center">${D?'<span class="pr-attachment-icon" title="קובץ מצורף" aria-label="קובץ מצורף">📎</span>':`<span class="pr-attachment-status ${ct.missing?"is-missing":"is-attached"}">${l(ct.label)}</span>`}</td>
        <td class="pr-td-actions">${Lt}</td>
      </tr>`}).join(""),G=o?`
    <div class="pr-add-panel" id="pr-add-expense-panel" hidden>
      <form class="pr-add-form" id="pr-add-expense-form" data-form-type="expense">
        <input type="hidden" name="id" />
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="expense_date" required /></div>
          <div class="pr-field">
            <label class="pr-label">סוג</label>
            <select class="pr-input pr-input--select" name="document_type">
              <option value="receipt">קבלה</option>
              <option value="invoice">חשבונית</option>
              <option value="other">אחר</option>
            </select>
          </div>
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט *</label>
            <input class="pr-input" type="text" name="description" required placeholder="תיאור ההוצאה" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">סכום ₪ *</label>
            <input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">הערות</label>
            <input class="pr-input" type="text" name="notes" placeholder="הערות" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field pr-field--wide"><label class="pr-label">קובץ אסמכתא / קבלה</label>
            <input class="pr-input" type="file" name="attachment" accept="image/*,.pdf" /></div>
        </div>
        <label class="pr-confirm-label pr-reliability-label">
          <input type="checkbox" name="reliability_declaration" value="yes" />
          <span>אין ברשותי קבלה — אני מסמן/ת הצהרת מהימנות להוצאה זו</span>
        </label>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="hide-add-expense">ביטול</button>
        </div>
      </form>
    </div>
  `:"",Y=p.length>0?`
      <div class="pr-travel-group">
        <div class="pr-travel-group__head"><h3>נסיעות לפי ק״מ</h3><span>סה״כ ק״מ: ${M(x)} · סה״כ לתשלום: ₪${P(g)}</span></div>
        <div class="pr-table-scroll pr-entries-table-wrap">
          <table class="pr-data-table pr-entries-table pr-fixed-travel-table pr-fixed-travel-table--km">
            <colgroup><col class="pr-col-date"><col class="pr-col-type"><col class="pr-col-detail"><col class="pr-col-km"><col class="pr-col-money"><col class="pr-col-actions"></colgroup>
            <thead><tr><th class="pr-col-date">תאריך</th><th class="pr-col-type">סוג</th><th class="pr-col-detail">מסלול</th><th class="pr-col-num pr-th-num">ק״מ</th><th class="pr-col-num pr-th-num">₪</th><th class="pr-col-actions pr-th-actions"></th></tr></thead>
            <tbody>${C}<tr class="pr-total-row"><td colspan="3" class="pr-total-label">סה״כ נסיעות לפי ק״מ</td><td class="pr-td-num pr-total-num">${M(x)}</td><td class="pr-td-num pr-total-num pr-total-amount">${P(g)}</td><td></td></tr></tbody>
          </table>
        </div>
      </div>`:Gt("אין נסיעות לפי ק״מ לחודש זה."),it=v.length>0?`
      <div class="pr-travel-group">
        <div class="pr-travel-group__head"><h3>תחבורה ציבורית</h3><span>סה״כ לתשלום: ₪${P(R)}</span></div>
        <div class="pr-table-scroll pr-entries-table-wrap">
          <table class="pr-data-table pr-entries-table pr-fixed-travel-table pr-fixed-travel-table--public">
            <colgroup><col class="pr-col-date"><col class="pr-col-type"><col class="pr-col-detail"><col class="pr-col-money"><col class="pr-col-actions"></colgroup>
            <thead><tr><th class="pr-col-date">תאריך</th><th class="pr-col-type">סוג</th><th class="pr-col-detail">מסלול</th><th class="pr-col-num pr-th-num">₪</th><th class="pr-col-actions pr-th-actions"></th></tr></thead>
            <tbody>${W.replaceAll('<td class="pr-td-num">—</td>',"")}<tr class="pr-total-row"><td colspan="3" class="pr-total-label">סה״כ תחבורה ציבורית</td><td class="pr-td-num pr-total-num pr-total-amount">${P(R)}</td><td></td></tr></tbody>
          </table>
        </div>
      </div>`:Gt("אין נסיעות תחבורה ציבורית לחודש זה."),T=`<div class="pr-travel-split">${Y}${it}</div>`,at=a.length>0?`
      <div class="pr-table-scroll pr-entries-table-wrap">
        <table class="pr-data-table pr-entries-table">
          <thead>
            <tr>
              <th class="pr-col-date">תאריך</th>
              <th class="pr-col-detail">פירוט</th>
              <th class="pr-col-num pr-th-num">₪</th>
              <th class="pr-col-status">אסמכתא</th>
              <th class="pr-col-actions pr-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${et}
            ${h>0?`<tr class="pr-total-row"><td colspan="2" class="pr-total-label">סה"כ</td><td class="pr-td-num pr-total-num pr-total-amount">${P(h)}</td><td colspan="2"></td></tr>`:""}
          </tbody>
        </table>
      </div>`:Gt("לא נוספו הוצאות לחודש זה."),Nt=o?'<button class="pr-btn pr-btn--primary pr-btn--sm pr-section-action" type="button" data-pr-action="show-add-travel">הוספת נסיעה</button>':"",he=o?'<button class="pr-btn pr-btn--primary pr-btn--sm pr-section-action" type="button" data-pr-action="show-add-expense">הוספת הוצאה</button>':"",Pa=Yr(s,t),Na=o&&!i?`
    <div class="pr-submit-card pr-submit-card--compact">
      <label class="pr-label pr-signature-field" for="pr-signature-name">
        <span>שם מלא לחתימה</span>
        <input class="pr-input pr-signature-input" id="pr-signature-name" type="text"
          value="${l(Pa)}" autocomplete="name" />
      </label>
      <label class="pr-confirm-label">
        <input type="checkbox" id="pr-confirm-checkbox" class="pr-confirm-checkbox" />
        <span>אני מאשר/ת שהפרטים נכונים ומלאים</span>
      </label>
      <button class="pr-btn pr-btn--primary pr-submit-btn"
        id="pr-submit-btn" data-pr-action="submit-report"
        data-report-id="${l(t.id)}" disabled>
        ${t.status==="needs_correction"?"שליחה מחדש":"אישור ושליחה"}
      </button>
    </div>
  `:o&&i?`
    <div class="pr-submit-card">
      <p class="pr-sim-note">מצב סימולציה — שליחה חסומה</p>
    </div>
  `:`
    <div class="pr-submit-card pr-submit-card--locked">
      <span class="pr-locked-msg">🔒 הדוח נעול לעריכה — סטטוס: ${l(y)}</span>
      <div class="pr-submit-finish-actions">
        <button class="pr-btn pr-btn--secondary pr-btn--sm" type="button" data-pr-action="download-report-pdf" data-report-id="${l(t.id)}">הורדת PDF</button>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" type="button" data-pr-action="back-to-my-reports">חזרה לדוחות שלי</button>
      </div>
    </div>
  `,La=t.status==="needs_correction"&&(t.correction_requested_at||t.updated_at)?U(String(t.correction_requested_at||t.updated_at).slice(0,10)):"",Ia=t.status!=="needs_correction"&&t.finance_notes&&t.submitted_at?`כן, ${U(String(t.submitted_at).slice(0,10))}`:"",Be=[h>0?kt('סה"כ הוצאות',`₪${P(h)}`):"",I>0?kt('סה"כ נסיעות',`₪${P(I)}`):"",u+f+_===0?kt("ימי עבודה","חודש מלא"):"",u>0?kt("ימי חופש",M(u)):"",f>0?kt("ימי מחלה",M(f)):"",_>0?kt("ימי הצהרה",M(_)):""].filter(Boolean).join("");return`
    <div class="pr-screen pr-report-form" dir="rtl">
      ${i?Ea(s.full_name):""}
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" type="button" data-pr-action="back-to-my-reports">← חזרה לדוחות שלי</button>
        <span class="pr-topbar__title">דוח אישי — ${l(d)}</span>
      </div>
      <div class="pr-body pr-report-detail-body">
        <section class="pr-card pr-report-hero-card" aria-label="כותרת דוח חודשי">
          <div class="pr-report-hero-card__main">
            <span class="pr-eyebrow">דוחות אישיים</span>
            <h1 class="pr-report-hero-card__title">דוח אישי לשכר — ${l(d)}</h1>
            <p class="pr-report-hero-card__meta">${l(s.full_name||"")}</p>
          </div>
        </section>

        <nav class="pr-report-tabs" role="tablist" aria-label="אזורי הדוח">
          <button class="pr-report-tab is-active" type="button" role="tab" aria-selected="true" data-pr-action="switch-report-tab" data-tab="status">
            <span>סטטוס</span>
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="travel">
            <span>נסיעות</span>${$e(e.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="expenses">
            <span>הוצאות</span>${$e(a.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="absences">
            <span>ימי עבודה</span>${$e(r.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="details">
            <span>אישור דיווח</span>
          </button>
        </nav>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="expenses">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">הוצאות</h2>
            </div>
            <div class="pr-section-head__actions">${he}</div>
          </div>
          ${at}
          ${G}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="travel">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">נסיעות</h2>
            </div>
            <div class="pr-section-head__actions">${Nt}</div>
          </div>
          ${T}
          ${z}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="status" id="pr-report-header">
          ${t.status==="needs_correction"?`<div class="pr-correction-alert" role="alert"><strong>הדוח הוחזר לתיקון</strong><span>${l(pa(t))}</span></div>`:""}
          <div class="pr-status-log" aria-label="יומן מצב">
            ${Kr(t,c,m,y,La,Ia)}
          </div>
          <p class="pr-info-note">יש להשלים ולשלוח את הדיווח עד ה־26 בכל חודש. הדיווח מתייחס לתקופת הדיווח עד ה־25 בכל חודש.</p>
        </section>
        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="absences">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">ימי עבודה</h2>
              <p class="pr-section-subtext">מדווחים כאן רק אם היו ימי חופש, מחלה או הצהרה.</p>
            </div>
            <div class="pr-section-head__actions pr-absence-choice">${B}</div>
          </div>
          ${b}
          ${N}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="details">
          <p class="pr-details-period">תקופת דיווח: ${l(c.label)}</p>
          ${Be?`<section class="pr-summary-bar pr-summary-bar--details" aria-label="סיכום הדוח">${Be}</section>`:""}
          ${Na}
        </section>
      </div>
    </div>
  `}function Jr(t,e="הדוח אושר ונשלח לשכר בהצלחה"){return`
    <div class="pr-screen pr-submit-success-screen" dir="rtl">
      <div class="pr-body pr-report-detail-body">
        <section class="pr-card pr-submit-success-card" role="status">
          <span class="pr-submit-success-card__icon" aria-hidden="true">✓</span>
          <h1 class="pr-report-hero-card__title">${l(e)}</h1>
          <p class="pr-helper-text">עותק PDF הופק מנתוני הדוח. ניתן להוריד אותו שוב או לחזור לרשימת החודשים.</p>
          <div class="pr-submit-finish-actions">
            <button class="pr-btn pr-btn--primary" type="button" data-pr-action="download-report-pdf" data-report-id="${l(t)}">הורדת PDF</button>
            <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="back-to-my-reports">חזרה לדוחות שלי</button>
          </div>
        </section>
      </div>
    </div>
  `}function Xr(t=""){const e=t?`<div class="pr-alert pr-alert--danger" role="alert">${l(t)}</div>`:"";return`
    <div class="pr-screen pr-screen--management" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">ניהול דוחות עובדים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-management-body">
        ${fe(j.MANAGEMENT)}
        <section class="pr-card pr-admin-placeholder" aria-label="ניהול דוחות עובדים">
          <h2 class="pr-card__title">ניהול דוחות עובדים</h2>
          <p class="pr-helper-text">רשימת העובדים שחייבים בדיווח תוצג כאן לאחר טעינת הנתונים.</p>
          ${e}
        </section>
      </div>
    </div>
  `}function Qr(t,e=st){const a=Ut(e.month||vt()),{month:r,year:n}=se(a),s=lt(r,n),i=t.map(o=>{const d=o.employee||{},c=o.report||null,m=String(o.reportId||(c==null?void 0:c.id)||"").trim(),y=String(o.reportStatus||(c==null?void 0:c.status)||"").trim(),p=o.totals||{travel:0,expenses:0},v=o.workDays===null||o.workDays===void 0||o.workDays===""?"חודש מלא":M(o.workDays);return`
      <tr class="pr-admin-report-row"
        data-employee-id="${l(d.id)}"
        data-report-month="${l(a)}"
        data-report-id="${l(m)}"
        data-report-status="${l(y)}"
        data-manage-status="${l(o.manageStatus)}">
        <td>${l(d.full_name||"—")}</td>
        <td>${l(s)}</td>
        <td class="pr-td-status">${er(o.manageStatus)}</td>
        <td class="pr-td-num pr-td-amount">₪${P(p.travel)}</td>
        <td class="pr-td-num pr-td-amount">₪${P(p.expenses)}</td>
        <td class="pr-td-num">${l(v)}</td>
        <td class="pr-actions-cell">
          <button class="pr-btn pr-btn--primary pr-btn--sm" type="button" data-pr-action="admin-manage-report"
            data-report-id="${l(m)}"
            data-employee-id="${l(d.id)}"
            data-report-month="${r}"
            data-report-year="${n}">צפייה וניהול</button>
        </td>
      </tr>
    `});return`
    <div class="pr-screen pr-screen--management" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">ניהול דוחות עובדים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-management-body">
        ${fe(j.MANAGEMENT)}
        <div class="pr-card pr-admin-filters pr-admin-filters--compact" aria-label="סינון דוחות עובדים">
          <label class="pr-label">חודש דיווח
            <select class="pr-input pr-input--select pr-input--month-compact" id="pr-filter-month">
              ${ma(a)}
            </select>
          </label>
          <label class="pr-label">סטטוס
            <select class="pr-input pr-input--select" id="pr-filter-status">
              <option value="">כל הסטטוסים</option>
              ${tr(e.status||"")}
            </select>
          </label>
          <div class="pr-admin-report-actions" aria-label="פעולות דוחות מסכמים">
            <button class="pr-btn pr-btn--secondary pr-btn--sm" data-pr-action="export-admin-table" type="button">${l(Ir(e.status||""))}</button>
            <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="clear-admin-filters" type="button">נקה סינון</button>
            <button class="pr-btn pr-btn--primary pr-btn--sm" data-pr-action="print-admin-reports-pdf" type="button">PDF מסכם לכל העובדים</button>
            <button class="pr-btn pr-btn--primary pr-btn--sm" data-pr-action="transfer-approved-to-payment" type="button">העבר מאושרים לתשלום</button>
          </div>
        </div>
        ${t.length===0?oa("אין עובדים להצגה לחודש הנבחר"):`
          <div class="pr-table-scroll">
            <table class="pr-table pr-admin-table pr-admin-table--management">
              <colgroup>
                <col class="pr-admin-col-employee" />
                <col class="pr-admin-col-month" />
                <col class="pr-admin-col-status" />
                <col class="pr-admin-col-money" />
                <col class="pr-admin-col-money" />
                <col class="pr-admin-col-workdays" />
                <col class="pr-admin-col-actions" />
              </colgroup>
              <thead><tr>
                <th>עובד</th><th>חודש דיווח</th><th>סטטוס</th><th>סה״כ נסיעות</th><th>סה״כ הוצאות</th><th>ימי עבודה</th><th>פעולה</th>
              </tr></thead>
              <tbody>${i.join("")}</tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `}function K(t,e){t.innerHTML=`
    <div id="pr-toast" class="pr-toast" role="alert" aria-live="assertive"></div>
    ${e}
  `}function Zr(t,e,a,{isSimulation:r=!1}={}){A={kind:"submit-success",reportId:e,isSimulation:r},Mt({reportId:e}),K(t,Jr(e,a))}async function zt(t,{profile:e,employeeId:a,isSimulation:r=!1,showModeTabs:n=!1,selectedMonth:s="",force:i=!1}={}){const o=Zt(s);yt=o;const{month:d,year:c}=ce(o);let m=null;try{m=await Pr(a,d,c,{force:i})}catch(y){w(O(y,"אירעה תקלה בטעינת נתוני הדוח."),"danger")}A={kind:"my-reports",isSimulation:r,selectedMonth:o},K(t,Wr(e,{isSimulation:r,cardData:m,showModeTabs:n,selectedMonthValue:o})),on(t,{isSimulation:r})}async function tn(t,{isSimulation:e=!1}={}){var o;const a=e?F==null?void 0:F.id:(o=$==null?void 0:$.user)==null?void 0:o.id,r=e?F:$==null?void 0:$.profile;if(!a||!r)return;const n=(A==null?void 0:A.reportId)||(q==null?void 0:q.id);n&&Mt({reportId:n}),ca(t);let s=(A==null?void 0:A.selectedMonth)||yt||"";q!=null&&q.report_month&&(q!=null&&q.report_year)&&(s=qt(q.report_month,q.report_year)),q=null;const i=_t(r)&&!e;await zt(t,{profile:r,employeeId:a,isSimulation:e,showModeTabs:i,selectedMonth:s,force:!0})}function en(t,{report:e,reportProfile:a,travel:r,expenses:n,absences:s,attachments:i,isAdmin:o=!1,isSimulation:d=!1,initialTab:c="status"}={}){if(q=e,A={kind:o&&!d?"admin-report":"employee-report",reportId:e.id,isSimulation:d,initialTab:c},o&&!d){e.profiles=a,K(t,nn(e,r,n,s,i)),cn(t);return}K(t,Gr(e,r,n,s,i,a,{isSimulation:d})),ln(t,{isSimulation:d}),jt(t,c)}function an(t,e,a=!1,{isSimulation:r=!1}={}){var i;const n=String(e||"").trim(),s=a&&!r?"admin-report":"employee-report";return!!(n&&(A==null?void 0:A.kind)===s&&String(A.reportId||"")===n&&!!A.isSimulation==!!r&&(q==null?void 0:q.id)===n&&((i=t==null?void 0:t.querySelector)!=null&&i.call(t,".pr-report-form")))}async function rn(t,e,a=!1,{isSimulation:r=!1,initialTab:n="status",forceReload:s=!1}={}){const i=String(e||"").trim(),o=Ct(i,a&&!r),d=a&&!r?"admin-report":"employee-report";if(!s&&an(t,i,a,{isSimulation:r})){tt("open skipped already rendered",o);return}if(!s&&ht.has(o))return tt("load skipped duplicate",o),ht.get(o);A={kind:d,reportId:i,isSimulation:r,initialTab:n};const c=(async()=>{var h;ca(t);const m=await pe(i,{force:s}),y=r?F==null?void 0:F.id:(h=$==null?void 0:$.user)==null?void 0:h.id;if(!a&&String((m==null?void 0:m.employee_id)||"")!==String(y||""))throw new Error("unauthorized_report_access");let p=$==null?void 0:$.profile;if(r&&F)p=F;else{const u=await Fe(m.employee_id,{force:s});u&&(p={...p||{},full_name:String(u.full_name||(p==null?void 0:p.full_name)||"").trim(),email:String(u.email||(p==null?void 0:p.email)||"").trim()})}const v=await ue(i,{force:s}),{travel:x,expenses:g,absences:R,attachments:I}=v;en(t,{report:m,reportProfile:p,travel:x,expenses:g,absences:R,attachments:I,isAdmin:a,isSimulation:r,initialTab:n})})();ht.set(o,c);try{await c}finally{ht.delete(o)}}async function Q(t,e,a=!1,r={}){try{r.forceReload&&Mt({reportId:e}),await rn(t,e,a,r)}catch(n){console.error("[personal-reports] safeOpenReportDetail failed: report_id=%s, isAdmin=%s, step=openReportDetail",e,a,n),w(O(n,"אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת."),"danger")}}function nn(t,e,a,r,n){const s=t.profiles||{},i=oe(t.report_month,t.report_year),o=t.work_days_in_month===null||t.work_days_in_month===void 0?"חודש מלא":M(Number(t.work_days_in_month)),{kmTravel:d,publicTransport:c}=me(e),m=be(d),y=bt(d),p=bt(c),v=y+p,x=a.reduce((b,E)=>b+Number(E.amount||0),0),g=X(r,"vacation"),R=X(r,"sick"),I=X(r,"declaration"),h=d.length===0?'<tr><td colspan="6" class="pr-table-empty">אין רשומות</td></tr>':d.map(b=>`
        <tr><td>${U(b.travel_date)}</td><td>${l(b.origin)}</td>
        <td>${l(b.destination)}</td><td>${l(b.description)}</td>
        <td class="pr-td-num">${M(b.roundtrip_km)}</td>
        <td class="pr-td-num pr-td-amount">${P(b.amount)}</td></tr>
      `).join(""),u=c.length===0?'<tr><td colspan="5" class="pr-table-empty">אין רשומות</td></tr>':c.map(b=>`
        <tr><td>${U(b.travel_date)}</td><td>${l(b.origin)}</td>
        <td>${l(b.destination)}</td><td>${l(b.description)}</td>
        <td class="pr-td-num pr-td-amount">${P(b.amount)}</td></tr>
      `).join(""),f=a.length===0?'<tr><td colspan="7" class="pr-table-empty">אין רשומות</td></tr>':a.map(b=>{const E=mt(n,"expense_entry_id",b.id),C=Ie(b,E);return`
        <tr><td>${U(b.expense_date)}</td>
        <td>${l(b.document_type==="receipt"?"קבלה":b.document_type==="invoice"?"חשבונית":"אחר")}</td>
        <td>${l(b.description)}</td>
        <td class="pr-td-num pr-td-amount">${P(b.amount)}</td>
        <td style="text-align:center">${E?'<span title="קובץ מצורף">📎</span>':l(C.label)}</td><td>${l(b.notes||"")}</td><td></td></tr>`}).join(""),_=r.length===0?'<tr><td colspan="6" class="pr-table-empty">אין רשומות</td></tr>':r.map(b=>{const E=mt(n,"absence_entry_id",b.id),C=De(b,E);return`<tr><td>${l(Le(b.absence_type))}</td><td>${U(b.start_date)}</td><td>${U(b.end_date)}</td><td class="pr-td-num">${M(le(b))}</td><td>${l(C.label)}</td><td>${l(b.notes||"")}</td></tr>`}).join(""),k=n.map(b=>`
    <div class="pr-attachment-row">
      <span class="pr-attachment-name">${l(b.file_name)}</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment"
        data-storage-path="${l(b.storage_path)}">הורד / צפה</button>
    </div>
  `).join(""),N=At(Tt[t.status]||t.status,Me[t.status]||"neutral"),B=lt(t.report_month,t.report_year);return`
    <div class="pr-screen pr-report-form" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-admin">← חזרה לרשימה</button>
        <span class="pr-topbar__title">${l(B)} — ${l(s.full_name||s.email||"")}</span>
        <div class="pr-topbar-status">${N}</div>
      </div>
      <div class="pr-body">
        <!-- Report identity -->
        <div class="pr-card pr-report-header-card">
          <h2 class="pr-section-title">פרטי דוח</h2>
          <div class="pr-report-identity">
            <div class="pr-id-item"><span class="pr-id-label">עובד</span><strong>${l(s.full_name||"")}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">חודש דיווח</span><strong>${l(B)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">תקופת דיווח</span><strong>${l(i.label)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${N}</div>
          </div>
          <div class="pr-meta-grid">
            <div class="pr-meta-item"><span class="pr-meta-label">ימי עבודה</span><strong>${l(o)}</strong></div>
            <div class="pr-meta-item"><span class="pr-meta-label">ימי חופש מחושבים</span><strong>${M(g)}</strong></div>
            <div class="pr-meta-item"><span class="pr-meta-label">ימי מחלה מחושבים</span><strong>${M(R)}</strong></div>
            <div class="pr-meta-item"><span class="pr-meta-label">ימי הצהרה מחושבים</span><strong>${M(I)}</strong></div>
          </div>
        </div>

        <!-- Summary bar -->
        <div class="pr-summary-bar">
          <div class="pr-sum-item"><span class="pr-sum-label">נסיעות בהצהרה</span><span class="pr-sum-value">₪${P(v)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">החזר הוצאות</span><span class="pr-sum-value">₪${P(x)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">חופש</span><span class="pr-sum-value">${M(g)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">מחלה</span><span class="pr-sum-value">${M(R)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">הצהרה</span><span class="pr-sum-value">${M(I)}</span></div>
        </div>

        <!-- Travel -->
        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">נסיעות בהצהרה</h2></div>
          <h3 class="pr-admin-subtitle">נסיעות לפי ק״מ</h3>
          <div class="pr-table-scroll"><table class="pr-data-table pr-fixed-travel-table pr-fixed-travel-table--km">
            <colgroup><col class="pr-col-date"><col class="pr-col-place"><col class="pr-col-place"><col class="pr-col-detail"><col class="pr-col-km"><col class="pr-col-money"></colgroup>
            <thead><tr><th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th><th class="pr-th-num">ק"מ</th><th class="pr-th-num">₪</th></tr></thead>
            <tbody>${h}
              <tr class="pr-total-row"><td colspan="4" class="pr-total-label">סה"כ נסיעות לפי ק״מ</td><td class="pr-td-num pr-total-num">${M(m)}</td><td class="pr-td-num pr-total-num pr-total-amount">${P(y)}</td></tr>
            </tbody>
          </table></div>
          <h3 class="pr-admin-subtitle">תחבורה ציבורית</h3>
          <div class="pr-table-scroll"><table class="pr-data-table pr-fixed-travel-table pr-fixed-travel-table--public">
            <colgroup><col class="pr-col-date"><col class="pr-col-place"><col class="pr-col-place"><col class="pr-col-detail"><col class="pr-col-money"></colgroup>
            <thead><tr><th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th><th class="pr-th-num">₪</th></tr></thead>
            <tbody>${u}
              <tr class="pr-total-row"><td colspan="4" class="pr-total-label">סה"כ תחבורה ציבורית</td><td class="pr-td-num pr-total-num pr-total-amount">${P(p)}</td></tr>
            </tbody>
          </table></div>
        </div>

        <!-- Transport -->
        <!-- Expenses -->
        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">הוצאות</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>תאריך</th><th>סוג</th><th>פירוט</th><th class="pr-th-num">₪</th><th>קבלה/חשבונית</th><th>הערות</th><th></th></tr></thead>
            <tbody>${f}
              <tr class="pr-total-row"><td colspan="3" class="pr-total-label">סה"כ</td>
                <td class="pr-td-num pr-total-num pr-total-amount">${P(x)}</td>
                <td colspan="3"></td></tr>
            </tbody>
          </table></div>
        </div>

        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">היעדרויות / ימים</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>סוג</th><th>מתאריך</th><th>עד תאריך</th><th class="pr-th-num">ימים</th><th>אסמכתא</th><th>הערות</th></tr></thead>
            <tbody>${_}</tbody>
          </table></div>
        </div>

        ${n.length>0?`
          <div class="pr-card pr-section-card">
            <div class="pr-section-head"><h2 class="pr-section-title">קבצים מצורפים</h2></div>
            <div class="pr-attachments-list">${k}</div>
          </div>
        `:""}

        <!-- Admin notes + actions -->
        <div class="pr-card">
          <h2 class="pr-section-title">הערות כספים</h2>
          <textarea class="pr-input" id="pr-admin-notes" rows="3"
            placeholder="הוסף הערה לעובד…">${l(t.finance_notes||"")}</textarea>
          <button class="pr-btn pr-btn--primary" data-pr-action="admin-save-notes"
            data-report-id="${l(t.id)}" style="margin-top:8px">שמור הערות</button>
        </div>
        <div class="pr-actions pr-admin-detail-actions">
          <button class="pr-btn pr-btn--ghost" data-pr-action="download-report-pdf" data-report-id="${l(t.id)}">הורדת PDF</button>
          ${["submitted","reviewed","approved"].includes(t.status)?`
            ${t.status!=="approved"?`<button class="pr-btn pr-btn--primary" data-pr-action="admin-approve" data-report-id="${l(t.id)}">✔ אשר דוח</button>`:""}
            <button class="pr-btn pr-btn--warning" data-pr-action="admin-return" data-report-id="${l(t.id)}">↩ החזרה לתיקון</button>
          `:""}
          ${t.status==="approved"?`
            <button class="pr-btn pr-btn--primary" data-pr-action="admin-mark-paid" data-report-id="${l(t.id)}">₪ סמן כהועבר לתשלום</button>
          `:""}
        </div>
      </div>
    </div>
  `}async function sn(t,{reportId:e=""}={}){const a=String(e||"").trim();if(a){await Q(t,a,!0,{forceReload:!0});return}w("אין דוח לחודש זה","info")}function on(t,{isSimulation:e=!1}={}){var s,i;(s=t.__prEmployeeAbort)==null||s.abort();const a=new AbortController;t.__prEmployeeAbort=a;const r=ie(t,a.signal),n=e?F==null?void 0:F.id:(i=$==null?void 0:$.user)==null?void 0:i.id;r.on("click",async o=>{const d=o.target.closest("[data-pr-action]");if(!d)return;const c=d.dataset.prAction;if(c==="exit-simulation"){F=null,await V(t,H);return}if(c==="lock-screen"){pt(),K(t,gt()),wt(t);return}if(c==="back-to-dashboard"){Kt();return}if(c==="screen-mode-management"){nt=j.MANAGEMENT,await V(t,H);return}if(c==="screen-mode-reviews"){nt=j.REVIEWS,await V(t,H);return}if(c==="screen-mode-my-reports"){nt=j.MY_REPORTS,yt=Pt(),await V(t,H);return}if(c==="open-month-report"){if(!n)return;const m=Number(d.dataset.reportMonth||0),y=Number(d.dataset.reportYear||0);try{d.disabled=!0;const p=d.textContent;d.textContent="פותח…";const v=await hr(n,m,y);await Q(t,v.id,!1,{isSimulation:e,initialTab:"status"}),d.disabled=!1,d.textContent=p}catch(p){w(O(p),"danger"),d.disabled=!1}return}if(c==="view-my-report"){const m=d.dataset.reportId;if(!m)return;await Q(t,m,!1,{isSimulation:e,initialTab:"status"});return}if(c==="download-report-pdf"){try{await Wt(d.dataset.reportId||(q==null?void 0:q.id),"אושר / נשלח לשכר"),w("PDF מוכן להורדה / שמירה","success")}catch(m){w(O(m),"danger")}return}}),r.on("change",async o=>{if(!o.target.matches("#pr-my-report-month"))return;const d=e?F:$==null?void 0:$.profile;if(!n||!d)return;const c=de(o.target.value);yt=c,o.target.value=c;const m=_t(d)&&!e;await zt(t,{profile:d,employeeId:n,isSimulation:e,showModeTabs:m,selectedMonth:c})})}function Xt(t){var e,a;return((a=(e=t.querySelector(".pr-report-tab.is-active"))==null?void 0:e.dataset)==null?void 0:a.tab)||"status"}function jt(t,e="status"){const r=new Set(["status","travel","expenses","absences","details"]).has(e)?e:"status";t.querySelectorAll(".pr-report-tab").forEach(n=>{const s=n.dataset.tab===r;n.classList.toggle("is-active",s),n.setAttribute("aria-selected",s?"true":"false")}),t.querySelectorAll(".pr-tab-panel").forEach(n=>{n.hidden=n.dataset.tabPanel!==r})}function ln(t,{isSimulation:e=!1}={}){var I;const a="מצב סימולציה — פעולה זו חסומה. זוהי תצוגה בלבד.";(I=t.__prDetailAbort)==null||I.abort();const r=new AbortController;t.__prDetailAbort=r;const n=ie(t,r.signal),s=t.querySelector("#pr-confirm-checkbox"),i=t.querySelector("#pr-submit-btn"),o=t.querySelector("#pr-signature-name");function d(){i&&(i.disabled=!(s!=null&&s.checked&&String((o==null?void 0:o.value)||"").trim()))}s&&i&&(n.on("change",h=>{h.target===s&&d()}),n.on("input",h=>{h.target===o&&d()}),d());const c=t.querySelector("#pr-add-travel-form");c&&g(c);function m(h){const u=t.querySelector(`#${h}`);u&&(u.hidden=!0)}function y(h){var f;const u=t.querySelector(`#${h}`);return u?(u.hidden=!1,(f=u.querySelector("input,select,textarea"))==null||f.focus(),u):null}function p(h,u){h&&Object.entries(u).forEach(([f,_])=>{const k=h.querySelector(`[name="${f}"]`);k&&(k.value=_??"")})}function v(h,u){if(!h)return;const f=h.querySelector('input[name="absence_type"]');f&&(f.value=u||"");const _=h.closest(".pr-absence-panel");t.querySelectorAll('[data-pr-action="choose-absence-type"]').forEach(N=>{N.classList.toggle("is-active",N.dataset.absenceType===u)}),_&&(_.hidden=!u);const k=h.querySelector(".pr-absence-fields");k&&(k.hidden=!u),k==null||k.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach(N=>{N.required=!!u}),R(h)}function x(h){var f;if(!h)return;h.reset();const u=h.closest(".pr-absence-panel");u&&(u.hidden=!0),h.querySelector('input[name="id"]')&&(h.querySelector('input[name="id"]').value=""),h.querySelector('input[name="absence_type"]')&&(h.querySelector('input[name="absence_type"]').value=""),t.querySelectorAll('[data-pr-action="choose-absence-type"]').forEach(_=>_.classList.remove("is-active")),(f=h.querySelector(".pr-absence-fields"))==null||f.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach(_=>{_.required=!1}),R(h)}function g(h){var N;if(!h)return;const f=(((N=h.querySelector('select[name="travel_type"]'))==null?void 0:N.value)||"km")==="public_transport";h.querySelectorAll(".pr-travel-km-field").forEach(B=>{B.hidden=f}),h.querySelectorAll(".pr-travel-public-field").forEach(B=>{B.hidden=!f});const _=h.querySelector('input[name="roundtrip_km"]'),k=h.querySelector('input[name="public_transport_amount"]');_&&(_.required=!f,f&&(_.value="")),k&&(k.required=f,f||(k.value=""))}n.on("blur",async h=>{const u=h.target.closest(".pr-meta-input");if(!u||!q||e||!ba(q))return;const f=u.name;if(!f)return;let _=u.value;u.type==="number"&&(_=_===""?null:Number(_)),_===""&&(_=null);try{await gr(q.id,{[f]:_}),q[f]=_}catch(k){w(O(k,"אירעה תקלה בשמירת הדוח. יש לנסות שוב."),"danger")}},{capture:!0}),n.on("click",async h=>{var _,k,N,B;const u=h.target.closest("[data-pr-action]");if(!u)return;const f=u.dataset.prAction;if(f==="exit-simulation"){F=null,await V(t,H);return}if(f==="back-to-my-reports"){try{await tn(t,{isSimulation:e})}catch(b){w(O(b,"אירעה תקלה בחזרה לדוחות. יש לנסות שוב."),"danger")}return}if(f==="back-to-dashboard"){Kt();return}if(f==="switch-report-tab"){jt(t,u.dataset.tab);return}if(f==="show-add-travel"){jt(t,"travel");const b=y("pr-add-travel-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="declared_travel"]');E&&g(E);return}if(f==="hide-add-travel"){m("pr-add-travel-panel");return}if(f==="show-add-expense"){jt(t,"expenses");const b=y("pr-add-expense-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="expense"]');E==null||E.reset(),(_=b==null?void 0:b.querySelector('form[data-form-type="expense"] input,select,textarea'))==null||_.focus();return}if(f==="hide-add-expense"){m("pr-add-expense-panel");return}if(f==="focus-salary-report"){const b=t.querySelector("#pr-report-header .pr-meta-input:not([readonly])");b==null||b.focus();return}if(f==="choose-absence-type"){const b=y("pr-add-absence-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="absence"]');v(E,u.dataset.absenceType||""),(k=E==null?void 0:E.querySelector('input[name="start_date"]'))==null||k.focus();return}if(f==="cancel-absence-form"){x(t.querySelector('form[data-form-type="absence"]'));return}if(f==="edit-travel"){const b=y("pr-add-travel-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="declared_travel"]');p(E,{id:u.dataset.entryId,original_table:u.dataset.entryTable,travel_type:u.dataset.travelType||"km",travel_date:u.dataset.travelDate,origin:u.dataset.origin,destination:u.dataset.destination,description:u.dataset.description,roundtrip_km:u.dataset.roundtripKm,public_transport_amount:u.dataset.amount}),g(E);return}if(f==="edit-expense"){const b=y("pr-add-expense-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="expense"]');p(E,{id:u.dataset.entryId,expense_date:u.dataset.expenseDate,document_type:u.dataset.documentType,description:u.dataset.description,amount:u.dataset.amount,notes:u.dataset.notes});const C=E==null?void 0:E.querySelector('input[name="reliability_declaration"]');C&&(C.checked=u.dataset.reliabilityDeclaration==="yes");return}if(f==="edit-absence"){const b=y("pr-add-absence-panel"),E=b==null?void 0:b.querySelector('form[data-form-type="absence"]');p(E,{id:u.dataset.entryId,start_date:u.dataset.startDate,end_date:u.dataset.endDate,notes:u.dataset.notes}),v(E,u.dataset.absenceType||""),(N=E==null?void 0:E.querySelector('input[name="start_date"]'))==null||N.focus(),jt(t,"absences");return}if(f==="delete-entry"){if(e){w(a,"warning");return}if(!confirm("למחוק שורה זו?"))return;try{await Ge(u.dataset.entryTable,u.dataset.entryId),await Q(t,q.id,!1,{isSimulation:e,initialTab:Xt(t),forceReload:!0}),w("נמחק","success")}catch(b){w(O(b),"danger")}return}if(f==="submit-report"){if(e){w(a,"warning");return}const b=t.querySelector("#pr-confirm-checkbox"),E=String(((B=t.querySelector("#pr-signature-name"))==null?void 0:B.value)||"").trim();if(!E){w("יש למלא שם מלא לחתימה","warning");return}if(!(b!=null&&b.checked)){w("יש לסמן את תיבת האישור","warning");return}if(!confirm("לשלוח את הדוח לשכר? לאחר שליחה לא ניתן לערוך."))return;try{await Oe(q.id);const C=q.status==="needs_correction";await wr(q.id,E),await Wt(q.id,"נשלח לשכר"),Zr(t,q.id,C?"הדוח נשלח מחדש בהצלחה":"הדוח אושר ונשלח לשכר בהצלחה",{isSimulation:e}),w(C?"הדוח נשלח מחדש בהצלחה":"הדוח אושר ונשלח לשכר בהצלחה","success")}catch(C){w(O(C),"danger")}return}if(f==="download-report-pdf"){try{await Wt(u.dataset.reportId||(q==null?void 0:q.id),"אושר / נשלח לשכר"),w("PDF מוכן להורדה / שמירה","success")}catch(b){w(O(b),"danger")}return}if(f==="view-attachment"){try{const b=await $a(u.dataset.storagePath);window.open(b,"_blank","noopener")}catch(b){w(O(b),"danger")}return}if(f==="delete-attachment"){if(e){w(a,"warning");return}if(!confirm("למחוק קובץ זה?"))return;try{await Tr({id:u.dataset.attachmentId,storage_path:u.dataset.storagePath}),await Q(t,q.id,!1,{isSimulation:e,initialTab:Xt(t),forceReload:!0}),w("קובץ נמחק","success")}catch(b){w(O(b),"danger")}return}});function R(h){var k,N;const u=((k=h==null?void 0:h.querySelector('input[name="start_date"]'))==null?void 0:k.value)||"",f=((N=h==null?void 0:h.querySelector('input[name="end_date"]'))==null?void 0:N.value)||"",_=h==null?void 0:h.querySelector('input[name="calculated_days"]');_&&(_.value=ae(u,f))}n.on("change",async h=>{var b,E;const u=h.target.closest('select[name="travel_type"]');if(u){g(u.closest('form[data-form-type="declared_travel"]'));return}const f=h.target.closest('select[name="absence_type"]');if(f){const C=f.closest('form[data-form-type="absence"]'),W=C==null?void 0:C.querySelector(".pr-absence-fields");W&&(W.hidden=!f.value),W==null||W.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach(z=>{z.required=!!f.value}),f.value&&((b=W==null?void 0:W.querySelector("input,select,textarea"))==null||b.focus());return}const _=h.target.closest(".pr-absence-date");if(_){R(_.closest('form[data-form-type="absence"]'));return}const k=h.target.closest('input[type="file"].pr-file-input');if(!k||!((E=k.files)!=null&&E[0]))return;if(e){w(a,"warning"),k.value="";return}const N=k.files[0],B={expenseEntryId:k.dataset.entryType==="expense"&&k.dataset.entryId||null,absenceEntryId:k.dataset.entryType==="absence"&&k.dataset.entryId||null};try{await we(q.id,$.user.id,B,N),await Q(t,q.id,!1,{isSimulation:e,initialTab:Xt(t),forceReload:!0}),w("הקובץ הועלה","success")}catch(C){w(O(C,"אירעה תקלה בהעלאת הקובץ. יש לנסות שוב."),"danger")}}),n.on("reset",h=>{const u=h.target.closest('form[data-form-type="absence"]');u&&setTimeout(()=>x(u),0)}),n.on("submit",async h=>{var b,E,C,W;const u=h.target.closest(".pr-add-form");if(!u||(h.preventDefault(),_e.has(u)))return;if(e){w(a,"warning");return}const f=u.dataset.formType,_=new FormData(u),k=q.id,N=$.user.id,B=u.querySelector('button[type="submit"]');_e.add(u),B&&(B.disabled=!0);try{if(f==="declared_travel"){const et=String(_.get("travel_type")||"km"),G=String(_.get("original_table")||""),Y=et==="public_transport"?"public_transport_entries":"declared_travel_entries";let it=_.get("id")||void 0;it&&G&&G!==Y&&(await Ge(G,it),it=void 0),await Er({id:it,travel_type:et,report_id:k,employee_id:N,travel_date:_.get("travel_date"),origin:_.get("origin")||"",destination:_.get("destination")||"",description:_.get("description")||"",roundtrip_km:Number(_.get("roundtrip_km")||0),...et==="public_transport"?{amount:Number(_.get("public_transport_amount")||0)}:{}})}else if(f==="expense"){const et=await Rr({id:_.get("id")||void 0,report_id:k,employee_id:N,expense_date:_.get("expense_date"),document_type:_.get("document_type")||"receipt",description:_.get("description")||"",amount:Number(_.get("amount")||0),reliability_declaration:_.get("reliability_declaration")==="yes",notes:_.get("notes")||""}),G=(E=(b=u.querySelector('input[name="attachment"]'))==null?void 0:b.files)==null?void 0:E[0];G&&await we(k,N,{expenseEntryId:et.id},G)}else if(f==="absence"){const et=String(_.get("absence_type")||"").trim(),G=String(_.get("start_date")||"").trim(),Y=String(_.get("end_date")||"").trim(),it=ae(G,Y);if(!et){w("יש לבחור סוג היעדרות","warning");return}if(!G||!Y){w("יש למלא טווח תאריכים","warning");return}if(new Date(`${G}T00:00:00`)>new Date(`${Y}T00:00:00`)){w("תאריך הסיום חייב להיות אחרי תאריך ההתחלה","warning");return}if(it<=0){w("טווח התאריכים לא כולל ימי עבודה (א׳-ה׳)","warning");return}const T=await Sr({id:_.get("id")||void 0,report_id:k,employee_id:N,absence_type:et,start_date:G,end_date:Y,notes:_.get("notes")||""}),at=(W=(C=u.querySelector('input[name="attachment"]'))==null?void 0:C.files)==null?void 0:W[0];at&&await we(k,N,{absenceEntryId:T.id},at)}u.reset(),f==="absence"&&x(u),f==="declared_travel"&&g(u);const z=u.closest(".pr-add-panel");z&&(z.hidden=!0),await Q(t,k,!1,{isSimulation:e,initialTab:Xt(t),forceReload:!0}),w("נשמר","success")}catch(z){console.error("[personal-reports] save error:",z==null?void 0:z.message,z==null?void 0:z.code,z==null?void 0:z.details,z),w(O(z,"אירעה תקלה בשמירת הדוח. יש לנסות שוב."),"danger")}finally{_e.delete(u),B&&(B.disabled=!1)}})}function Ta(t){const e=Ot(t);t.querySelectorAll(".pr-admin-report-row").forEach(a=>{const r=!e.status||a.dataset.manageStatus===e.status;a.hidden=!r})}function ea(t){var r;(r=t.__prAdminAbort)==null||r.abort();const e=new AbortController;t.__prAdminAbort=e;const a=ie(t,e.signal);a.on("click",async n=>{var o;const s=n.target.closest("[data-pr-action]");if(!s)return;const i=s.dataset.prAction;if(s.dataset.reportId,i==="back-to-dashboard"){Kt();return}if(i==="lock-screen"){pt(),K(t,gt()),wt(t);return}if(i==="screen-mode-my-reports"){nt=j.MY_REPORTS,yt=Pt(),await V(t,H);return}if(i==="screen-mode-management"){nt=j.MANAGEMENT,await V(t,H);return}if(i==="screen-mode-reviews"){nt=j.REVIEWS,await V(t,H);return}if(i==="clear-admin-filters"){const d=t.querySelector("#pr-filter-month"),c=t.querySelector("#pr-filter-status");d&&(d.value=Ut(vt())),c&&(c.value=""),await V(t,H,{forceReload:!0});return}if(i==="export-admin-table"){try{const d=Ot(t),c=Xe(d);if(!c.length){w("אין נתונים לייצוא עבור הסינון הנוכחי","info");return}Dr(c,d.month),w("הטבלה הורדה בהצלחה","success")}catch(d){w(O(d,"אירעה תקלה בהורדת הטבלה. יש לנסות שוב."),"danger")}return}if(i==="print-admin-reports-pdf"){try{const d=Ot(t),c=Xe(d);await Br(c,d.month)}catch(d){w(O(d,"אירעה תקלה בהפקת PDF מסכם. יש לנסות שוב."),"danger")}return}if(i==="transfer-approved-to-payment"){try{const d=Ot(t),c=Ut(d.month||vt()),{month:m,year:y}=se(c),p=await xa({...d,month:c},{force:!1}),{approvedIds:v,notApprovedCount:x}=Xa(p);if(!v.length){w("אין דוחות מאושרים להעברה לתשלום בחודש זה","info");return}const g=v.length,R=`להעביר לתשלום את כל הדוחות המאושרים של חודש ${lt(m,y)}?
יועברו לתשלום: ${g}
לא יועברו כי אינם מאושרים: ${x}`;if(!confirm(R))return;await $r(v),w(`הועברו לתשלום ${g} דוחות מאושרים`,"success"),st={...d,month:Ja(c)},await V(t,H,{forceReload:!0})}catch(d){w(O(d,"אירעה תקלה בהעברת הדוחות לתשלום. יש לנסות שוב."),"danger")}return}if(i==="admin-manage-report"){const d=s.closest(".pr-admin-report-row"),c=String(s.dataset.reportId||((o=d==null?void 0:d.dataset)==null?void 0:o.reportId)||"").trim();await sn(t,{reportId:c});return}}),a.on("change",async n=>{if(n.target.matches("#pr-filter-month")){const s=Ot(t);Ga(s)&&(st={...s},await V(t,H,{forceReload:!0}));return}n.target.matches("#pr-filter-status")&&Ta(t)})}function cn(t){var r;(r=t.__prAdminViewAbort)==null||r.abort();const e=new AbortController;t.__prAdminViewAbort=e,ie(t,e.signal).on("click",async n=>{var d;const s=n.target.closest("[data-pr-action]");if(!s)return;const i=s.dataset.prAction,o=s.dataset.reportId;if(i==="back-to-admin"){A={kind:"employee-reports-management"},q=null,await V(t,H,{forceReload:!0});return}if(i==="admin-approve"&&o){if(!confirm("לאשר דוח זה?"))return;try{await Oe(o),await ge(o,{status:"approved",approved_at:new Date().toISOString()}),await Wt(o,"אושר לשכר"),w("הדוח אושר וה-PDF הופק","success"),await Q(t,o,!0,{forceReload:!0})}catch(c){w(O(c),"danger")}return}if(i==="admin-return"&&o){const c=prompt("הסבר לעובד:");if(c===null)return;try{await xr(o,c),w("הדוח הוחזר לתיקון","success"),await Q(t,o,!0,{forceReload:!0})}catch(m){w(O(m),"danger")}return}if(i==="admin-mark-paid"&&o){if(!confirm("לסמן כהועבר לתשלום?"))return;try{await ge(o,{status:"paid",paid_at:new Date().toISOString()}),w("הדוח הועבר לתשלום","success"),await Q(t,o,!0,{forceReload:!0})}catch(c){w(O(c),"danger")}return}if(i==="admin-save-notes"&&o){const c=((d=t.querySelector("#pr-admin-notes"))==null?void 0:d.value)||"";try{await ge(o,{finance_notes:c}),w("הערות נשמרו","success")}catch(m){w(O(m),"danger")}return}if(i==="download-report-pdf"){try{await Wt(s.dataset.reportId||(q==null?void 0:q.id),"אושר / נשלח לשכר"),w("PDF מוכן להורדה / שמירה","success")}catch(c){w(O(c),"danger")}return}if(i==="view-attachment"){try{const c=await $a(s.dataset.storagePath);window.open(c,"_blank","noopener")}catch(c){w(O(c),"danger")}return}})}function Kt(){pt(),document.dispatchEvent(new CustomEvent("app:navigate",{detail:{route:"dashboard"}}))}function wt(t){var r,n,s;(r=t.__prLoginAbort)==null||r.abort();const e=new AbortController;t.__prLoginAbort=e;const a=e.signal;(n=t.querySelector('[data-pr-action="back-to-dashboard"]'))==null||n.addEventListener("click",Kt,{signal:a}),(s=t.querySelector("#pr-internal-login-form"))==null||s.addEventListener("submit",async i=>{if(i.preventDefault(),a.aborted)return;const o=i.currentTarget,d=o.querySelector('button[type="submit"]'),c=new FormData(o),m=ha(c.get("access_code")),y=je();d&&(d.disabled=!0,d.textContent="בודק אימות…");try{if($=await fr(y,m),a.aborted)return;q=null,F=null,nt=j.MY_REPORTS,ut=!0,await V(t,y)}catch(p){if(a.aborted)return;ut=!1,K(t,gt(_a(p))),wt(t)}finally{if(a.aborted)return;d&&(d.disabled=!1,d.textContent="כניסה")}},{signal:a})}async function V(t,e=je(),{forceReload:a=!1}={}){var r;if(!a&&(A==null?void 0:A.kind)==="admin-report"&&A.reportId){await Q(t,A.reportId,!0,{isSimulation:A.isSimulation,initialTab:A.initialTab||"status"});return}if(!a&&(A==null?void 0:A.kind)==="employee-report"&&A.reportId){await Q(t,A.reportId,!1,{isSimulation:A.isSimulation,initialTab:A.initialTab||"status"});return}if(!ut){A={kind:"login"},K(t,gt()),wt(t);return}if(!$||!((r=$.user)!=null&&r.id)){ut=!1,A={kind:"login"},K(t,gt(_a("missing_employee_uuid"))),wt(t);return}if(nt===j.REVIEWS&&!F)await _n(t);else if(_t($.profile)&&nt===j.MY_REPORTS&&!F)await zt(t,{profile:$.profile,employeeId:$.user.id,showModeTabs:!0,selectedMonth:Zt(),force:a});else if(_t($.profile)&&F)await zt(t,{profile:F,employeeId:F.id,isSimulation:!0,selectedMonth:Zt(),force:a});else if(_t($.profile))try{const n={month:st.month||vt(),status:st.status||""},s=await xa(n,{force:a});A={kind:"employee-reports-management"},q=null,K(t,Qr(s||[],n)),ea(t),n.status&&Ta(t)}catch(n){A={kind:"employee-reports-management"},K(t,Xr(O(n,"אזור ניהול דוחות עובדים לא נטען כרגע."))),ea(t)}else await zt(t,{profile:$.profile,employeeId:$.user.id,showModeTabs:!0,selectedMonth:Zt(),force:a})}const qn={load:()=>Promise.resolve({}),render(t,e){var a;return ze(e==null?void 0:e.state)?Ha():He((a=e==null?void 0:e.state)==null?void 0:a.user)?'<div id="pr-root" class="pr-module-root" dir="rtl"><div class="pr-loading-placeholder">טוען…</div></div>':Ba()},bind({root:t,state:e}={}){var y;const a=t&&t.querySelector("#pr-root")||t;if(ze(e)||!He(e==null?void 0:e.user))return;H=(e==null?void 0:e.user)||H||null;const r=((y=a==null?void 0:a.ownerDocument)==null?void 0:y.defaultView)||globalThis.window,n=St&&ut&&$,s=St&&!ut,i=mr(a);Z==null||Z.abort(),Z=new AbortController;const o=Z.signal;n?(St=!0,i&&Ke(a)):s?(St=!0,i&&($=ve(e),Ke(a))):(pt(),$=ve(e),St=!0,V(a,H));const d=()=>{Z==null||Z.abort(),Z=null,pt()},c=()=>{Z==null||Z.abort(),Z=null,pt()},m=p=>{p.persisted&&(pt(),$=ve(e),V(a,H))};document.addEventListener("app:navigate",d,{signal:o}),r==null||r.addEventListener("pagehide",c,{signal:o}),r==null||r.addEventListener("pageshow",m,{signal:o})}},qa={not_opened:"טרם נפתח",manager_preparation:"בהכנת המנהל",ready_for_conversation:"מוכן לשיחה",conversation_in_progress:"שיחה בתהליך",awaiting_employee_response:"ממתין להתייחסות העובד",completed_locked:"הושלם וננעל"},dn={achievements:"מהם ההישגים והתרומות המרכזיים שבאו לידי ביטוי בתקופה האחרונה?",strengths:"אילו חוזקות חשוב לשמר ולהמשיך לפתח?",improvements:"מהם הנושאים המרכזיים לשיפור ומהן הציפיות להמשך?",process_changes:"אילו תהליכי עבודה כדאי לשנות או לשפר?",support_needed:"איזו תמיכה יוכל המנהל לספק?",manager_summary:"מהם עיקרי המשוב והצעדים שסוכמו להמשך?"},pn={achievements:"אילו הישגים, פרויקטים, משימות או תרומות שלך מהתקופה האחרונה חשוב לך להדגיש?",strengths:"אילו חוזקות אישיות ומקצועיות סייעו לך בעבודה ומה חשוב לדעתך להמשיך לשמר?",challenges:"אילו משימות, מצבים או תקופות היו מאתגרים עבורך וכיצד התמודדת איתם?",enablers_barriers:"מה עזר לך להצליח בעבודה ומה הקשה עליך או מנע ממך להתקדם?",learning:"מה למדת בתקופה האחרונה ובאילו תחומים מקצועיים או אישיים הרגשת שהתפתחת?",workload:"כיצד את/ה חווה את עומס העבודה, סדרי העדיפויות וחלוקת המשימות?",role_clarity:"האם תחומי האחריות, הציפיות וסדרי העדיפויות ברורים לך? מה דורש לדעתך הבהרה או תיאום נוסף?",management_support:"כיצד את/ה חווה את המענה, הליווי והתמיכה שאת/ה מקבל/ת מהמנהל הישיר ומהנהלת הארגון?",collaboration:"כיצד מתנהלים לדעתך שיתוף הפעולה, העברת המידע וחלוקת האחריות עם המנהל, הצוות וגורמים נוספים?",decision_processes:"כיצד תהליכי העבודה וקבלת ההחלטות בארגון משפיעים על היכולת שלך לבצע את עבודתך באופן יעיל?",stop:"אילו משימות, החלטות, הרגלים או תהליכי עבודה מקשים על העבודה וכדאי לדעתך להפסיק או לשנות?",start:"אילו תהליכים, דרכי עבודה או יוזמות חדשות כדאי לדעתך להתחיל לקדם?",continue:"אילו דברים מתנהלים היטב וחשוב לדעתך להמשיך לעשות ולשמר?",development:"באילו תחומים היית רוצה להתפתח, להעמיק או לרכוש ידע וניסיון נוספים?",additional_responsibility:"האם יש תחומי אחריות, משימות חדשות או יוזמות שהיית רוצה לקחת על עצמך?",tools:"אילו כלים, מידע, הכשרה, משאבים או תמיכה יכולים לסייע לך להצליח יותר בעבודה?",goals:"אילו מטרות או נושאים היית רוצה לקדם בתקופה הקרובה?",expectations:"מה היית רוצה לקבל מהמנהל ומהארגון כדי להצליח ולהתפתח בהמשך?",management_changes:"מה לדעתך המנהל או הנהלת הארגון יכולים לעשות אחרת כדי לשפר את העבודה וההתנהלות?",criticism:"האם יש ביקורת, דעה או הצעה שחשוב לך להעלות בנוגע לעבודה, להתנהלות או לסביבת העבודה?",additional:"האם יש דבר נוסף שחשוב לך להעלות או לתעד במסגרת השיחה?"},un={response_to_summary:"האם סיכום המנהל משקף את עיקרי השיחה?",agreed_points:"מהן הנקודות המרכזיות שאיתן את/ה מסכים/ה?",clarification_points:"האם יש נקודות שברצונך להבהיר או להוסיף?",final_comment:"האם יש לך הערה מסכמת שחשוב לתעד?"};let qe=[],te=null,aa=null;const Ae=new Set;let re=!1;const mn=["הכנת מנהל","מוכן לשיחה","שיחת משוב","תגובת העובד","אישורים","הושלם"],bn={not_opened:0,manager_preparation:0,ready_for_conversation:1,conversation_in_progress:2,awaiting_employee_response:3,completed_locked:5};async function fn(){var c;const t=(c=$==null?void 0:$.user)==null?void 0:c.id;if(!t)return[];const{data:e,error:a}=await S.from("annual_reviews").select("*").or(`employee_id.eq.${t},manager_id.eq.${t}`).order("review_year",{ascending:!1});if(a){if(["42P01","PGRST205"].includes(a.code))return[];throw a}const{data:r,error:n}=await S.from("annual_review_assignments").select("employee_id,manager_id,employee_name");if(n)throw n;const s=[...new Set((e||[]).map(m=>m.manager_id).filter(Boolean))],i=await Promise.all(s.map(async m=>{const{data:y,error:p}=await S.rpc("resolve_annual_review_manager_name",{p_manager_id:m});if(p)throw p;return[m,typeof y=="string"?y.trim():""]})),o=new Map(i),d=new Map((r||[]).map(m=>[m.employee_id,m]));return qe=(e||[]).map(m=>({...m,...d.get(m.employee_id)||{},manager_name:o.get(m.manager_id)||""})),qe}function hn(t){var s;const e=(s=$==null?void 0:$.user)==null?void 0:s.id,a=t.filter(i=>i.manager_id===e),r=t.find(i=>i.employee_id===e),n=a.length?a:r?[r]:[];return`<section class="pr-card ar-landing no-print" aria-labelledby="ar-landing-title">
    <div class="pr-my-report-card__header"><div><span class="pr-eyebrow">משוב שנתי</span><h2 id="ar-landing-title" class="pr-card__title">${a.length?"ניהול משובים שנתיים":"המשוב השנתי שלי"}</h2></div></div>
    ${n.length?`<div class="ar-review-list">${n.map(i=>`<article class="ar-review-row"><div class="ar-review-row__details"><strong>${l(i.employee_name||"עובד/ת")}</strong><span>${l(i.review_year)}</span></div>${At(qa[i.status]||i.status,i.status==="completed_locked"?"success":"warning")}<button type="button" class="pr-btn pr-btn--primary pr-btn--sm" data-ar-open="${l(i.id)}">פתיחת המשוב</button></article>`).join("")}</div>`:'<p class="pr-helper-text">לא נמצאו משובים להצגה.</p>'}
  </section>`}function ra(t=[]){return`<div class="pr-screen pr-screen--reviews" dir="rtl">
    <div class="pr-topbar"><button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button><span class="pr-topbar__title">משובים</span><button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto">יציאה</button></div>
    <div class="pr-body pr-reviews-body">${fe(j.REVIEWS,{showManagement:_t($==null?void 0:$.profile)})}${hn(t)}</div>
  </div>`}async function _n(t){try{const e=await fn();A={kind:"annual-reviews"},K(t,ra(e)),na(t),t.querySelectorAll("[data-ar-open]").forEach(a=>a.addEventListener("click",()=>ee(t,a.dataset.arOpen)))}catch(e){console.warn("[annual-review] access load failed",(e==null?void 0:e.message)||e),K(t,ra([])),na(t)}}function na(t){var e,a,r,n;(e=t.querySelector('[data-pr-action="back-to-dashboard"]'))==null||e.addEventListener("click",Kt),(a=t.querySelector('[data-pr-action="lock-screen"]'))==null||a.addEventListener("click",()=>{pt(),K(t,gt()),wt(t)}),(r=t.querySelector('[data-pr-action="screen-mode-my-reports"]'))==null||r.addEventListener("click",async()=>{nt=j.MY_REPORTS,await V(t,H)}),(n=t.querySelector('[data-pr-action="screen-mode-management"]'))==null||n.addEventListener("click",async()=>{nt=j.MANAGEMENT,await V(t,H)})}async function yn(t){const e=await Promise.all([S.from("manager_review_evaluations").select("*").eq("review_id",t.id).order("sort_order"),S.from("review_conversation_summary").select("*").eq("review_id",t.id).maybeSingle(),S.from("review_goals").select("*").eq("review_id",t.id).order("sort_order"),S.from("employee_review_response").select("*").eq("review_id",t.id).maybeSingle()]),a=e.find(r=>r.error);if(a)throw a.error;return{evaluations:e[0].data||[],conversation:e[1].data,goals:e[2].data||[],response:e[3].data}}function Qt(t,e,a="",r=!1,n={}){const{className:s="",rows:i=4}=n;return`<label class="ar-field"><span>${l(e)}</span><textarea name="${l(t)}" rows="${i}" class="${l(s)}" ${r?"disabled":""}>${l(a||"")}</textarea></label>`}function vn(t){const e=t.status==="awaiting_employee_response"&&t.employee_approved_at&&t.manager_approved_at?4:bn[t.status]??0;return`<ol class="ar-progress" aria-label="התקדמות המשוב">${mn.map((a,r)=>`<li class="${r<e?"is-complete":r===e?"is-current":""}" ${r===e?'aria-current="step"':""}><span>${r+1}</span>${a}</li>`).join("")}</ol>`}function gn(t,e,a){const r=!!(t.employee_approved_at&&t.manager_approved_at);return t.status==="not_opened"?e?{text:"המשוב עדיין לא נפתח. בלחיצה הבאה ייפתח אזור פרטי להכנת הערכת המנהל. העובד עדיין לא יראה את ההערכה.",actor:"המנהל",editable:"לאחר הפתיחה: דירוגים והערות המנהל בלבד.",operation:"open_review_for_employee",label:"פתיחת המשוב והתחלת הכנת המנהל"}:{text:"המנהל טרם פתח את המשוב.",actor:"המנהל",editable:"אין שדות למילוי בשלב זה."}:t.status==="manager_preparation"?e?{text:"זהו אזור ההכנה הפרטי שלך. העובד עדיין אינו רואה את הדירוגים וההערות. לאחר השלמת ההערכה ניתן לשתף אותה ולהכין את המשוב לשיחה.",actor:"המנהל",editable:"דירוגים, לא רלוונטי והערות לכל מדד.",operation:"share_manager_evaluation",label:"שיתוף הערכת המנהל והכנת המשוב לשיחה"}:{text:"המשוב נמצא בהכנת המנהל וטרם שותף איתך.",actor:"המנהל",editable:"אין שדות למילוי בשלב זה."}:t.status==="ready_for_conversation"?{text:"הערכת המנהל שותפה. כאשר שיחת המשוב מתחילה, המנהל ילחץ על הכפתור הבא. לאחר מכן ייפתחו סיכום השיחה, דברי העובד והמטרות המשותפות.",actor:"המנהל",editable:"הערכת המנהל זמינה לקריאה בלבד.",operation:e?"start_review_conversation":"",label:"התחלת שיחת המשוב"}:t.status==="conversation_in_progress"?{text:"שיחת המשוב בתהליך. כל צד ממלא רק את החלק שלו, ואת המטרות ניתן לערוך יחד. לאחר הלחיצה התוכן יוצג לקריאה בלבד וייפתח שלב תגובת העובד.",actor:"המנהל והעובד",editable:e?"סיכום המנהל והמטרות המשותפות.":"דברי העובד והמטרות המשותפות.",operation:e?"finish_review_conversation":"",label:"סיום השיחה והעברה לתגובת העובד"}:t.status==="awaiting_employee_response"&&r?e?{text:"שני הצדדים אישרו את המשוב. הפעולה הבאה תנעל את המשוב ותסיים את התהליך.",actor:"המנהל",editable:"אין שדות לעריכה. הנעילה תמנע עריכה נוספת.",operation:"complete_and_lock_review",label:"נעילת המשוב וסיום התהליך"}:{text:"שני הצדדים אישרו. המנהל נדרש כעת לנעול את המשוב ולסיים את התהליך.",actor:"המנהל",editable:"אין שדות לעריכה."}:t.status==="awaiting_employee_response"?a?{text:"כעת ניתן לקרוא את הסיכום, להוסיף תגובה ולאשר שקראת את המשוב. האישור אינו מחייב הסכמה עם כל תוכנו.",actor:t.employee_approved_at?"המנהל":"העובד",editable:t.employee_approved_at?"התגובה נשמרה ואושרה; אין עוד עריכה.":"תגובה לסיכום, נקודות הסכמה והבהרה והערה מסכמת.",operation:t.employee_approved_at?"":"approve_review_as_employee",label:"שמירת התגובה ואישור שקראתי"}:{text:"המשוב ממתין לתגובת העובד. ניתן לאשר את חלק המנהל, אך המשוב לא יינעל עד ששני הצדדים יאשרו.",actor:t.employee_approved_at?"המנהל":"העובד",editable:"אין שינוי בדברי העובד או בסיכום השיחה.",operation:t.manager_approved_at?"":"approve_review_as_manager",label:"אישור המנהל"}:{text:"המשוב הושלם וננעל. ניתן לצפות בו ולהדפיסו כ־PDF.",actor:"התהליך הושלם",editable:"המשוב זמין לקריאה בלבד."}}function wn(t,e,a){const r=gn(t,e,a),n=t.status==="awaiting_employee_response"?`<div class="ar-approvals"><span>${t.employee_approved_at?"✓ העובד אישר":"○ ממתין לאישור העובד"}</span><span>${t.manager_approved_at?"✓ המנהל אישר":"○ ממתין לאישור המנהל"}</span></div>`:"";return`<section class="pr-card ar-now no-print" aria-labelledby="ar-now-title"><h2 id="ar-now-title">מה עושים עכשיו?</h2>${vn(t)}<p>${l(r.text)}</p><dl><div><dt>מי נדרש לפעול?</dt><dd>${l(r.actor)}</dd></div><div><dt>מה ניתן למלא?</dt><dd>${l(r.editable)}</dd></div></dl>${n}<div class="ar-workflow">${r.operation?`<button type="button" class="pr-btn pr-btn--primary" data-ar-operation="${r.operation}">${l(r.label)}</button>`:""}${t.status==="completed_locked"&&e?'<button type="button" class="pr-btn pr-btn--ghost" data-ar-reopen>פתיחת המשוב מחדש</button>':""}</div><p class="ar-operation-state" aria-live="polite"></p></section>`}function $n(){return'<dialog class="ar-modal" data-ar-modal aria-labelledby="ar-modal-title"><form method="dialog"><h2 id="ar-modal-title"></h2><p data-ar-modal-text></p><label class="ar-field" data-ar-reason-wrap hidden><span>סיבה מפורשת לפתיחה מחדש</span><textarea data-ar-reason rows="3"></textarea></label><div class="ar-modal__actions"><button class="pr-btn pr-btn--ghost" value="cancel" data-ar-modal-cancel>חזרה למשוב</button><button class="pr-btn pr-btn--primary" value="confirm" data-ar-modal-confirm></button></div></form></dialog>'}function xn(t,e,a){var R,I,h,u;const r=!!t.locked_at||t.status==="completed_locked",n=t.employee_id===((R=$==null?void 0:$.user)==null?void 0:R.id),s=a&&t.status==="manager_preparation"&&!r,i=t.status==="conversation_in_progress"&&!r,o=a&&i,d=n&&i,c=i,m=n&&t.status==="awaiting_employee_response"&&!t.employee_approved_at&&!r,y=a||!!t.manager_shared_at,p=y&&!["not_opened","manager_preparation"].includes(t.status),v=i?"":'<p class="pr-helper-text">השדות מוצגים לקריאה בלבד בשלב זה.</p>',x=e.goals.length?"":'<p class="ar-empty-goals">עדיין לא הוגדרו מטרות להמשך.</p>',g=t.manager_name||"שם המנהל לא זמין";return`<div class="pr-screen ar-screen" dir="rtl"><div class="pr-topbar no-print"><button class="pr-btn pr-btn--ghost" data-ar-back>← חזרה למשובים</button><span class="pr-topbar__title">משוב שנתי</span><button class="pr-btn pr-btn--primary" data-ar-print>הדפסה או שמירה כ־PDF</button></div>
  <main class="pr-body ar-document"><header class="ar-print-header"><div class="ar-logo">תעשיידע</div><div><h1>משוב שנתי</h1><p>${l(t.employee_name||"")} · ${l(t.review_year)}</p><p>שם המנהל: ${l(g)}</p></div>${At(qa[t.status]||t.status,r?"success":"warning")}</header>${wn(t,a,n)}
  ${y?"":`<section class="pr-card ar-section ar-manager-draft-notice"><p>${t.status==="not_opened"?"המנהל טרם פתח את המשוב.":"המשוב נמצא בהכנת המנהל וטרם שותף איתך."}</p></section>`}
  ${y?`<section class="pr-card ar-section"><h2>הערכת המנהל</h2><p class="ar-rating-legend">1 – נדרש שיפור משמעותי · 2 – נדרש שיפור · 3 – עומד בציפיות · 4 – מעל הציפיות · 5 – מצטיין/ת</p><div class="ar-save-state" data-ar-evaluation-save aria-live="polite"></div><div class="ar-evaluations">${e.evaluations.map(f=>`<div class="ar-evaluation" data-evaluation-version="${l(f.version||"")}"><strong>${l(f.metric_label)}</strong><div class="ar-rating" aria-label="דירוג">${[1,2,3,4,5].map(_=>`<button type="button" data-ar-rating="${_}" data-evaluation-id="${l(f.id)}" class="${f.rating===_?"is-selected":""}" ${s?"":"disabled"}>${_}</button>`).join("")}<button type="button" data-ar-rating="na" data-evaluation-id="${l(f.id)}" class="${f.not_applicable?"is-selected":""}" ${s?"":"disabled"}>לא רלוונטי</button></div>${Qt(`evaluation_comment_${f.id}`,"הערה",f.comment,!s,{className:"annual-review-metric-comment",rows:2})}</div>`).join("")}</div></section>`:""}
  ${p?`<section class="pr-card ar-section"><h2>סיכום המנהל</h2>${v}<form data-ar-form="conversation-manager" data-version="${l(((I=e.conversation)==null?void 0:I.version)||"")}">${Object.entries(dn).map(([f,_])=>{var k;return Qt(f,_,(k=e.conversation)==null?void 0:k[f],!o)}).join("")}<div class="ar-save-state" aria-live="polite"></div></form></section><section class="pr-card ar-section"><h2>דברי העובד</h2>${v}<p class="ar-section-help">השאלות נועדו לאפשר לך להעלות את התחומים, המשימות והנושאים החשובים לך בעבודתך. ניתן לבחור לאילו שאלות להתייחס ועל אילו נושאים להרחיב. אין חובה להתייחס לכל השאלות.</p><form data-ar-form="conversation-employee-voice" data-version="${l(((h=e.conversation)==null?void 0:h.version)||"")}">${Object.entries(pn).map(([f,_])=>{var k,N;return Qt(`employee_voice_${f}`,_,(N=(k=e.conversation)==null?void 0:k.employee_voice)==null?void 0:N[f],!d)}).join("")}<div class="ar-save-state" aria-live="polite"></div></form></section><section class="pr-card ar-section"><h2>מטרות ופעולות מוסכמות</h2>${x}<div class="ar-goals" data-can-edit="${c?"true":"false"}"><div class="ar-save-state" data-ar-goals-save aria-live="polite"></div><table><thead><tr><th>מטרה</th><th>פעולה מוסכמת</th><th>אחראי</th><th>מועד יעד</th><th class="no-print"></th></tr></thead><tbody>${e.goals.map(f=>Aa(f,!c)).join("")}</tbody></table>${c?'<button type="button" class="pr-btn pr-btn--primary no-print" data-ar-add-goal>הוספת מטרה</button>':""}</div></section>
  <section class="pr-card ar-section"><h2>תגובת העובד</h2><form data-ar-form="response" data-version="${l(((u=e.response)==null?void 0:u.version)||"")}">${Object.entries(un).map(([f,_])=>{var k;return Qt(f,_,(k=e.response)==null?void 0:k[f],!m)}).join("")}<div class="ar-save-state" aria-live="polite"></div></form></section>`:""}
  <footer class="ar-signatures"><span>שם העובד/ת: ${l(t.employee_name||"")}</span><span>שם המנהל: ${l(g)}</span><span>תאריך אישור: ${t.completed_at?l(new Date(t.completed_at).toLocaleDateString("he-IL")):"____________"}</span></footer></main>${$n()}</div>`}function Aa(t={},e=!1){return`<tr data-goal-id="${l(t.id||"")}" data-version="${l(t.version||"")}"><td contenteditable="${e?"false":"true"}" data-field="goal">${l(t.goal||"")}</td><td contenteditable="${e?"false":"true"}" data-field="agreed_actions">${l(t.agreed_actions||"")}</td><td contenteditable="${e?"false":"true"}" data-field="owner">${l(t.owner||"")}</td><td><input type="date" data-field="target_date" value="${l(t.target_date||"")}" ${e?"disabled":""}></td><td class="no-print">${e?"":'<button type="button" data-ar-delete-goal aria-label="מחיקת יעד">×</button>'}</td></tr>`}async function kn(t,e,a,r){var d;const n=r.dataset.version;let s=S.from(t).update(a).eq("review_id",e);n&&(s=s.eq("version",Number(n)));const{data:i,error:o}=await s.select().maybeSingle();if(o)throw o;if(!i&&n)throw new Error("המידע השתנה במקום אחר. יש לרענן לפני שמירה נוספת.");if(i)r.dataset.version=i.version||"";else{const c=await S.from(t).insert({review_id:e,...a}).select().single();if(c.error)throw c.error;r.dataset.version=c.data.version||""}(d=r.querySelector(".ar-save-state"))==null||d.replaceChildren(document.createTextNode(`נשמר לאחרונה ${new Date().toLocaleString("he-IL")}`))}function Sn(){const t=document.body,e="is-annual-review-print",a=()=>t.classList.remove(e);t.classList.add(e),window.addEventListener("afterprint",a,{once:!0});try{window.print()}catch(r){throw a(),r}}async function ee(t,e){const a=qe.find(s=>s.id===e);if(!a)return;const r=await yn(a),n=a.manager_id===$.user.id;te={review:a,bundle:r},K(t,xn(a,r,n)),Rn(t,a,n)}function J(t,e,a=""){var n;const r=((n=t==null?void 0:t.querySelector)==null?void 0:n.call(t,".ar-save-state"))||t;r&&(r.textContent=e,r.dataset.state=a)}function Ma(){return"המידע השתנה במקום אחר. יש לרענן את המשוב לפני שמירה נוספת."}function xe(t){return Ae.size>0||!!t.querySelector('.ar-save-state[data-state="saving"], .ar-save-state[data-state="error"]')||re}async function ke(t){Ae.add(t);try{const e=await t;return re=!1,e}catch(e){throw re=!0,e}finally{Ae.delete(t)}}function En(t,e,a){const r=t.querySelector("[data-ar-modal]"),s={open_review_for_employee:["פתיחת המשוב","ייפתח אזור פרטי להכנת הערכת המנהל. העובד עדיין לא יראה את ההערכה.","חזרה למשוב","פתיחת המשוב והתחלת הכנת המנהל"],share_manager_evaluation:["שיתוף הערכת המנהל","לאחר השיתוף העובד יוכל לראות את הערכת המנהל. האם להמשיך?","חזרה להערכה","כן, לשתף ולהמשיך"],start_review_conversation:["התחלת שיחת המשוב","ייפתחו סיכום המנהל, דברי העובד והמטרות המשותפות לעריכה לפי ההרשאות של כל צד.","חזרה למשוב","התחלת שיחת המשוב"],finish_review_conversation:["העברה לתגובת העובד",`השיחה תועבר לשלב תגובת העובד. סיכום השיחה והמטרות יוצגו לקריאה בלבד. עדיין לא מדובר בנעילת המשוב.${a?"":" לא הוגדרו מטרות. ניתן לחזור ולהוסיף מטרה או להמשיך ללא מטרות."}`,"חזרה לשיחה",a?"העברה לתגובת העובד":"המשך ללא מטרות"],approve_review_as_employee:["אישור קריאת המשוב","התגובה תישמר ולאחר האישור לא ניתן יהיה לשנותה. האישור מעיד שקראת את המשוב ואינו מחייב הסכמה עם תוכנו.","חזרה לתגובה","שמירת התגובה ואישור שקראתי"],approve_review_as_manager:["אישור חלק המנהל","אישור המנהל יתועד, אך המשוב לא יינעל עד ששני הצדדים יאשרו והמנהל יבצע נעילה מפורשת.","חזרה למשוב","אישור המנהל"],complete_and_lock_review:["נעילת המשוב","פעולה זו תנעל את המשוב ותמנע עריכה נוספת. האם לסיים ולנעול?","חזרה למשוב","כן, לסיים ולנעול"]}[e];return!s||!(r!=null&&r.showModal)?Promise.resolve(!0):(r.querySelector("#ar-modal-title").textContent=s[0],r.querySelector("[data-ar-modal-text]").textContent=s[1],r.querySelector("[data-ar-modal-cancel]").textContent=s[2],r.querySelector("[data-ar-modal-confirm]").textContent=s[3],new Promise(i=>{const o=()=>i(r.returnValue==="confirm");r.addEventListener("close",o,{once:!0}),r.showModal()}))}async function Se(t,e,a,r,n){let s=S.from(t).update(r).eq(e,a);n&&(s=s.eq("version",Number(n)));const{data:i,error:o}=await s.select().maybeSingle();if(o)throw o;if(!i&&n)throw new Error(Ma());return i}function Rn(t,e,a){var d,c,m,y;const r=!!e.locked_at||e.status==="completed_locked",n=a&&e.status==="manager_preparation"&&!r,s=e.status==="conversation_in_progress"&&!r;re=!1,window.onbeforeunload=p=>{if(xe(t))return p.preventDefault(),p.returnValue="",""},(d=t.querySelector("[data-ar-back]"))==null||d.addEventListener("click",()=>{if(xe(t))return w("יש להמתין לסיום השמירה או לתקן שגיאת שמירה לפני היציאה.","danger");V(t,H)}),(c=t.querySelector("[data-ar-print]"))==null||c.addEventListener("click",Sn),t.querySelectorAll(".annual-review-metric-comment").forEach(p=>{const v=()=>{p.style.height="auto",p.style.height=`${Math.max(54,p.scrollHeight)}px`};v(),p.addEventListener("input",v)}),t.querySelectorAll("[data-ar-operation]").forEach(p=>p.addEventListener("click",async v=>{var h,u;const x=v.currentTarget.dataset.arOperation;if(xe(t))return w("לא ניתן לעבור שלב בזמן שמירה פעילה או לאחר שגיאת שמירה.","danger");if(!await En(t,x,!!((u=(h=te==null?void 0:te.bundle)==null?void 0:h.goals)!=null&&u.length)))return;p.disabled=!0,p.setAttribute("aria-busy","true");const g=t.querySelector(".ar-operation-state");g&&(g.textContent="מבצע...");const{data:R,error:I}=await S.rpc(x,{p_review_id:e.id,p_expected_version:e.version});if(I)return p.disabled=!1,p.removeAttribute("aria-busy"),g&&(g.textContent="הפעולה נכשלה. המשוב נשאר בשלב הנוכחי."),w(I.message||"עדכון מצב המשוב נכשל","danger");Object.assign(e,R),await ee(t,e.id)})),(m=t.querySelector("[data-ar-reopen]"))==null||m.addEventListener("click",async()=>{const p=t.querySelector("[data-ar-modal]");p.querySelector("#ar-modal-title").textContent="פתיחת המשוב מחדש",p.querySelector("[data-ar-modal-text]").textContent="המשוב יחזור לשיחת משוב בתהליך. יש להזין סיבה; הפעולה תתועד ביומן.",p.querySelector("[data-ar-reason-wrap]").hidden=!1,p.querySelector("[data-ar-modal-confirm]").textContent="כן, לפתוח מחדש",p.showModal(),await new Promise(R=>p.addEventListener("close",R,{once:!0}));const v=p.querySelector("[data-ar-reason]").value.trim();if(p.querySelector("[data-ar-reason-wrap]").hidden=!0,p.returnValue!=="confirm"||!v)return v||p.returnValue!=="confirm"?void 0:w("נדרשת סיבה מפורשת לפתיחה מחדש.","danger");const{data:x,error:g}=await S.rpc("reopen_annual_review",{p_review_id:e.id,p_expected_version:e.version,p_reason:v});if(g)return w(g.message||"פתיחת המשוב מחדש נכשלה","danger");Object.assign(e,x),await ee(t,e.id)}),t.querySelectorAll("[data-ar-form]").forEach(p=>p.addEventListener("input",()=>{clearTimeout(aa),J(p,"שומר...","saving"),aa=setTimeout(async()=>{const v=Object.fromEntries(new FormData(p));p.querySelectorAll("input[type=checkbox]").forEach(g=>{v[g.name]=g.checked});let x="employee_review_response";p.dataset.arForm==="conversation-manager"&&(x="review_conversation_summary"),p.dataset.arForm==="conversation-employee-voice"&&(x="review_conversation_summary",v.employee_voice=Object.fromEntries(Object.entries(v).filter(([g])=>g.startsWith("employee_voice_")).map(([g,R])=>[g.replace("employee_voice_",""),R])),Object.keys(v).filter(g=>g.startsWith("employee_voice_")).forEach(g=>delete v[g]));try{await ke(kn(x,e.id,v,p)),J(p,"נשמר","saved")}catch(g){J(p,g.message||"שמירת הטופס נכשלה","error")}},700)})),t.querySelectorAll('textarea[name^="evaluation_comment_"]').forEach(p=>p.addEventListener("change",async()=>{if(!n)return;const v=p.closest(".ar-evaluation"),x=p.name.replace("evaluation_comment_","");J(t.querySelector("[data-ar-evaluation-save]"),"שומר...","saving");try{const g=await ke(Se("manager_review_evaluations","id",x,{comment:p.value},v==null?void 0:v.dataset.evaluationVersion));v&&(v.dataset.evaluationVersion=g.version||""),J(t.querySelector("[data-ar-evaluation-save]"),"נשמר","saved")}catch(g){J(t.querySelector("[data-ar-evaluation-save]"),g.message||"שמירת ההערה נכשלה","error")}})),t.querySelectorAll("[data-ar-rating]").forEach(p=>p.addEventListener("click",async()=>{if(!n)return;const v=p.dataset.arRating==="na",x=p.closest(".ar-evaluation");J(t.querySelector("[data-ar-evaluation-save]"),"שומר...","saving");try{await ke(Se("manager_review_evaluations","id",p.dataset.evaluationId,{rating:v?null:Number(p.dataset.arRating),not_applicable:v},x==null?void 0:x.dataset.evaluationVersion)),J(t.querySelector("[data-ar-evaluation-save]"),"נשמר","saved"),await ee(t,e.id)}catch(g){J(t.querySelector("[data-ar-evaluation-save]"),g.message||"שמירת הדירוג נכשלה","error")}}));const i=t.querySelector(".ar-goals"),o=(i==null?void 0:i.dataset.canEdit)==="true"&&s;(y=t.querySelector("[data-ar-add-goal]"))==null||y.addEventListener("click",()=>{var p;o&&((p=t.querySelector(".ar-goals tbody"))==null||p.insertAdjacentHTML("beforeend",Aa()))}),i==null||i.addEventListener("focusout",async p=>{if(!o)return;const v=p.target.closest("tr[data-goal-id]");if(!v||p.target.matches("button"))return;const x=Object.fromEntries([...v.querySelectorAll("[data-field]")].map(R=>[R.dataset.field,R.value??R.textContent.trim()])),g=v.dataset.goalId;J(i.querySelector("[data-ar-goals-save]"),"שומר...","saving");try{const R=g?{data:await Se("review_goals","id",g,x,v.dataset.version)}:await S.from("review_goals").insert({review_id:e.id,...x}).select().single();if(R.error)throw R.error;v.dataset.goalId=R.data.id,v.dataset.version=R.data.version||"",J(i.querySelector("[data-ar-goals-save]"),"נשמר","saved")}catch(R){J(i.querySelector("[data-ar-goals-save]"),R.message||"שמירת היעד נכשלה","error")}}),i==null||i.addEventListener("click",async p=>{if(!o)return;const v=p.target.closest("[data-ar-delete-goal]");if(!v)return;const x=v.closest("tr"),g=x==null?void 0:x.dataset.goalId;if(J(i.querySelector("[data-ar-goals-save]"),"שומר...","saving"),g){let R=S.from("review_goals").delete().eq("id",g);x!=null&&x.dataset.version&&(R=R.eq("version",Number(x.dataset.version)));const{data:I,error:h}=await R.select().maybeSingle();if(h||!I){J(i.querySelector("[data-ar-goals-save]"),(h==null?void 0:h.message)||Ma(),"error");return}}x==null||x.remove(),J(i.querySelector("[data-ar-goals-save]"),"נשמר","saved")})}export{qn as personalReportsScreen};
