import{C as d,i as h}from"./index-DpctzQJl.js";import{r as P}from"./annual-reviews-safe-runtime-01EJ_1YJ.js";const m="annual-review-final-pdfs",q="annual_review_final_documents",L=20*1024*1024;function S(a){const e=Number(a||0);return!Number.isFinite(e)||e<=0?"":e<1024*1024?`${Math.ceil(e/1024)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}function U(a){if(!a)return"";const e=new Date(a);return Number.isNaN(e.getTime())?"":new Intl.DateTimeFormat("he-IL",{dateStyle:"medium",timeStyle:"short"}).format(e)}function w(a){var t;const e=String((a==null?void 0:a.message)||a||"");return((t=[["annual_review_final_pdf_manager_forbidden","רק המנהל המשויך למשוב רשאי להעלות את הקובץ הסופי."],["annual_review_final_pdf_review_not_completed","ניתן להעלות את הקובץ רק לאחר שהמשוב הושלם וננעל."],["annual_review_final_pdf_already_registered","כבר נשמר קובץ PDF סופי למשוב זה."],["annual_review_final_pdf_object_missing","הקובץ לא נמצא באחסון. יש לנסות להעלות אותו מחדש."],["annual_review_final_pdf_size_mismatch","גודל הקובץ שנשמר אינו תואם. יש לפנות למנהל המערכת."],["annual_review_final_pdf_invalid_size","גודל הקובץ אינו תקין."],["annual_review_final_pdf_invalid_sha256","בדיקת תקינות הקובץ נכשלה."]].find(([i])=>e.includes(i)))==null?void 0:t[1])||e||"הפעולה נכשלה."}async function E(a){const{data:e,error:n}=await d.from(q).select("review_id,file_path,original_file_name,mime_type,file_size,sha256,uploaded_at").eq("review_id",a).maybeSingle();if(n)throw n;return e||null}async function B(a){if(!(a instanceof File))throw new Error("יש לבחור קובץ PDF.");if(!a.name.toLowerCase().endsWith(".pdf"))throw new Error("ניתן להעלות קובץ PDF בלבד.");if(a.size<=0)throw new Error("הקובץ ריק.");if(a.size>L)throw new Error("גודל הקובץ המרבי הוא 20 MB.");const e=new Uint8Array(await a.slice(0,5).arrayBuffer());if(String.fromCharCode(...e)!=="%PDF-")throw new Error("הקובץ שנבחר אינו קובץ PDF תקין.")}async function C(a){var n;if(!((n=globalThis.crypto)!=null&&n.subtle))throw new Error("הדפדפן אינו מאפשר לבצע בדיקת תקינות לקובץ.");const e=await globalThis.crypto.subtle.digest("SHA-256",await a.arrayBuffer());return[...new Uint8Array(e)].map(t=>t.toString(16).padStart(2,"0")).join("")}function A(a){const e=String((a==null?void 0:a.message)||"").toLowerCase();return Number((a==null?void 0:a.statusCode)||(a==null?void 0:a.status)||0)===409||e.includes("duplicate")||e.includes("already exists")||e.includes("resource already exists")}async function M(a,e,n){const{data:t,error:i}=await d.storage.from(m).download(a);if(i)throw i;if(Number((t==null?void 0:t.size)||0)!==e.size)throw new Error("קיים כבר קובץ אחר עבור המשוב. יש לפנות למנהל המערכת.");if(await C(t)!==n)throw new Error("קיים כבר קובץ אחר עבור המשוב. יש לפנות למנהל המערכת.")}async function T(a,e=!1){const n=e?{download:a.original_file_name||"משוב-סופי.pdf"}:void 0,{data:t,error:i}=await d.storage.from(m).createSignedUrl(a.file_path,120,n);if(i)throw i;if(!(t!=null&&t.signedUrl))throw new Error("לא ניתן לפתוח את הקובץ.");return t.signedUrl}async function b(a,e=!1){const n=window.open("about:blank","_blank");try{const t=await T(a,e);n?(n.opener=null,n.location.replace(t)):window.location.assign(t)}catch(t){throw n==null||n.close(),t}}function D(a){const e=U(a.uploaded_at),n=S(a.file_size);return`<section class="ar2-card" data-final-pdf-card>
    <div class="ar2-card__head">
      <div>
        <h2>מסמך המשוב הסופי</h2>
        <p class="ar2-muted">הקובץ נשמר בארכיון פרטי וזמין לעובד ולמנהל לצפייה בלבד.</p>
      </div>
      <span class="ar2-status is-complete">הועלה וננעל</span>
    </div>
    <div class="ar2-private" style="display:grid;gap:5px">
      <strong>${h(a.original_file_name||"משוב סופי.pdf")}</strong>
      <span>${h([n,e].filter(Boolean).join(" · "))}</span>
      <span>לא ניתן להחליף, לערוך או למחוק את הקובץ דרך המערכת.</span>
    </div>
    <div class="ar2-actions ar2-no-print">
      <button type="button" class="ar2-btn ar2-btn--primary" data-final-pdf-view>צפייה בקובץ</button>
      <button type="button" class="ar2-btn ar2-btn--ghost" data-final-pdf-download>הורדת הקובץ</button>
    </div>
  </section>`}function $(a){return`<section class="ar2-card" data-final-pdf-card>
    <div class="ar2-card__head">
      <div>
        <h2>מסמך המשוב הסופי</h2>
        <p class="ar2-muted">לאחר השלמת המשוב נשמר עותק PDF סופי לצפייה עתידית.</p>
      </div>
      <span class="ar2-status is-waiting">ממתין להעלאה</span>
    </div>
    ${a?`<div class="ar2-private" style="display:grid;gap:8px">
      <span>יש להפיק את המשוב באמצעות הכפתור „הדפסת המשוב המלא”, לשמור כ־PDF ולהעלות כאן.</span>
      <strong>לאחר ההעלאה לא ניתן להחליף או למחוק את הקובץ.</strong>
      <label class="ar2-field">
        <span>בחירת קובץ PDF עד 20 MB</span>
        <input class="ar2-input" type="file" accept="application/pdf,.pdf" data-final-pdf-file>
      </label>
      <span class="ar2-muted" data-final-pdf-selection>לא נבחר קובץ.</span>
      <div class="ar2-save" data-final-pdf-state aria-live="polite"></div>
    </div>
    <div class="ar2-actions ar2-no-print">
      <button type="button" class="ar2-btn ar2-btn--primary" data-final-pdf-upload disabled>העלאת הקובץ הסופי ונעילתו</button>
    </div>`:'<div class="ar2-private">המנהל טרם העלה את קובץ המשוב הסופי.</div>'}
  </section>`}function _(a,e){var t;(t=a.querySelector("[data-final-pdf-card]"))==null||t.remove();const n=a.querySelector("footer.ar2-signatures");return n?(n.insertAdjacentHTML("beforebegin",e),a.querySelector("[data-final-pdf-card]")):null}function l(a,e,n=!1){const t=a.querySelector("[data-final-pdf-state]");t&&(t.textContent=e,t.dataset.state=n?"error":"")}function F(a,e){var n,t;(n=a.querySelector("[data-final-pdf-view]"))==null||n.addEventListener("click",async()=>{try{await b(e,!1)}catch(i){window.alert(w(i))}}),(t=a.querySelector("[data-final-pdf-download]"))==null||t.addEventListener("click",async()=>{try{await b(e,!0)}catch(i){window.alert(w(i))}})}function N(a,e,n){const t=e.querySelector("[data-final-pdf-file]"),i=e.querySelector("[data-final-pdf-upload]"),f=e.querySelector("[data-final-pdf-selection]");!t||!i||(t.addEventListener("change",()=>{var s;const r=(s=t.files)==null?void 0:s[0];i.disabled=!r,f&&(f.textContent=r?`${r.name} · ${S(r.size)}`:"לא נבחר קובץ."),l(e,"")}),i.addEventListener("click",async()=>{var s,g;const r=(s=t.files)==null?void 0:s[0];if(r&&window.confirm("הקובץ יישמר כגרסה הסופית ולא ניתן יהיה להחליפו או למחוק אותו. להמשיך?")){t.disabled=!0,i.disabled=!0;try{l(e,"בודק את הקובץ…"),await B(r);const o=await C(r),v=`${n.review.id}/final.pdf`;l(e,"מעלה את הקובץ…");const{error:c}=await d.storage.from(m).upload(v,r,{cacheControl:"31536000",contentType:"application/pdf",upsert:!1});if(c){if(!A(c))throw c;await M(v,r,o)}l(e,"נועל ושומר בארכיון…");const{data:z,error:u}=await d.rpc("register_annual_review_final_document",{p_review_id:n.review.id,p_original_file_name:r.name,p_file_size:r.size,p_sha256:o});if(u&&!String(u.message||"").includes("annual_review_final_pdf_already_registered"))throw u;const p=z||await E(n.review.id);if(!p)throw new Error("הקובץ הועלה אך רישום הארכיון לא הושלם.");const y=_(a,D(p));y&&F(y,p)}catch(o){t.disabled=!1,i.disabled=!((g=t.files)!=null&&g[0]),l(e,w(o),!0)}}}))}P(async(a,e)=>{if(e.review.status!=="completed_locked"||a.dataset.finalPdfSafe==="true")return;a.dataset.finalPdfSafe="true";const n=await E(e.review.id);if(n){const i=_(a,D(n));i&&F(i,n);return}const t=_(a,$(e.isManager));t&&e.isManager&&N(a,t,e)});
