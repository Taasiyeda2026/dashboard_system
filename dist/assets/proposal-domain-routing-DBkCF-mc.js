import{C as y,i as x,b9 as T,b4 as $,B as I}from"./index-CH0LFGSL.js";const L=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,k=new Set(["approved","sent","מאושר","מאושר וחתום","נשלח"]),b="data-proposal-domain-routing",p="data-proposal-activity-creator",R=90;let v=null,_=!1;const E=new Map;function i(t){return String(t??"").replace(/\s+/g," ").trim()}function D(t){return t===!0||t===1||t==="1"||t==="yes"||t==="true"}function C(t){return i(t).toLowerCase()}function j(t){const e=i(t),r=e.toLowerCase();return["next_year","gefen","combined"].includes(r)?r:['תשפ"ז',"תשפ״ז",'שנת הלימודים תשפ"ז',"שנת הלימודים תשפ״ז",'תוכניות תשפ"ז',"תוכניות תשפ״ז"].includes(e)?"next_year":["גפן",'גפ"ן',"גפ״ן"].includes(e)?"gefen":r}function z(){var r;const t=((r=$)==null?void 0:r.user)||{},e=i(t.display_role||t.role);return i(t.user_id)==="3030"||e==="admin"||["operation_manager","domain_manager"].includes(e)||D(t.manage_proposals_agreements)}function S(t,e="success"){try{I(t,e)}catch{console[e==="error"?"error":"info"](t)}}function N(){if(document.getElementById("proposal-domain-routing-styles"))return;const t=document.createElement("style");t.id="proposal-domain-routing-styles",t.textContent=`
    .proposal-israa-routing {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--ds-border, #d7dde5);
      border-radius: 12px;
      background: var(--ds-surface, #fff);
    }
    .proposal-israa-routing__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .proposal-israa-routing__title {
      margin: 0;
      font-size: .96rem;
      font-weight: 800;
    }
    .proposal-israa-routing__domain {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 23px;
      padding: 0 7px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-size: .72rem;
      font-weight: 800;
    }
    .proposal-israa-routing__body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
    }
    .proposal-israa-routing__summary {
      min-width: 0;
      color: #475569;
      font-size: .8rem;
      line-height: 1.45;
    }
    .proposal-israa-routing__button {
      min-width: 190px;
      border: 0;
      border-radius: 9px;
      padding: 8px 12px;
      background: #0f766e;
      color: #fff;
      font: inherit;
      font-size: .82rem;
      font-weight: 800;
      cursor: pointer;
    }
    .proposal-israa-routing__button[disabled] {
      background: #e5e7eb;
      color: #64748b;
      cursor: default;
    }
    @media (max-width: 900px) {
      .proposal-israa-routing__body { grid-template-columns: 1fr; }
      .proposal-israa-routing__button { width: 100%; }
    }
  `,document.head.appendChild(t)}function O(t,e){var a,u;const r=new Set(e.map(i)),n=t.querySelectorAll(".ds-pa-info-cell");for(const l of n){const d=i((a=l.querySelector(".ds-pa-info-label"))==null?void 0:a.textContent);if(r.has(d))return i((u=l.querySelector(".ds-pa-info-value"))==null?void 0:u.textContent)}return""}function U(t){var r;const e=[t,...t.querySelectorAll("*")];for(const n of e)for(const a of((r=n.getAttributeNames)==null?void 0:r.call(n))||[]){if(!/proposal/i.test(a))continue;const u=i(n.getAttribute(a));if(L.test(u))return u}return""}async function B(t){const e=U(t),r=O(t,["מספר הצעה","מספר הצעת מחיר","מס׳ הצעה"]),n=e||`quote:${r}`,a=E.get(n);if(a&&Date.now()-a.at<3e4)return a.row;const u=["id","quote_number","status","activity_type_group","proposal_domain","archived_at","version_number","school_framework","client_authority","total_amount"].join(",");let l=y.from("proposals_agreements").select(u);if(e)l=l.eq("id",e).maybeSingle();else if(r)l=l.eq("quote_number",r).is("archived_at",null).order("version_number",{ascending:!1}).limit(1).maybeSingle();else return null;const{data:d,error:m}=await l;if(m)throw m;const c=d||null;return E.set(n,{at:Date.now(),row:c}),c}function M(t){const e=t.querySelector("[data-pa-drawer-items]");return e?e.closest(".ds-pa-info-card")||e.parentElement||t:t.querySelector(".ds-pa-activities-wide")||t}function P(t){return!t||t.archived_at||!k.has(C(t.status))?!1:["next_year","gefen","combined"].includes(j(t.activity_type_group))}function A(t){var e;(e=t.querySelector(`[${p}][${b}]`))==null||e.remove(),t.removeAttribute("data-proposal-domain-routing-loaded")}function G(t,e){var h;const r=`${e.id}:E:${C(e.status)}`;if(t.querySelector(`[${p}][${b}="E"]`)&&t.getAttribute("data-proposal-domain-routing-loaded")===r){t.setAttribute("data-proposal-activity-loaded",e.id);return}(h=t.querySelector(`[${p}]`))==null||h.remove();const a=document.createElement("section");a.className="proposal-israa-routing",a.setAttribute(p,e.id),a.setAttribute(b,"E");const u=i(e.quote_number),l=i(e.school_framework),d=i(e.client_authority),m=[u?`הצעה ${u}`:"",l,d].filter(Boolean).join(" · "),c=z();a.innerHTML=`
    <div class="proposal-israa-routing__head">
      <h3 class="proposal-israa-routing__title">מעקב הצעות גפ״ן – תשפ״ז</h3>
      <span class="proposal-israa-routing__domain">E</span>
    </div>
    <div class="proposal-israa-routing__body">
      <div class="proposal-israa-routing__summary">
        ${x(m||"הצעה בתחום E")}
        <br>ההצעה תתווסף לטבלת המעקב של איסראא ולא למסך כל הפעילויות.
      </div>
      <button type="button"
        class="proposal-israa-routing__button"
        data-route-proposal-to-israa="${x(e.id)}"
        ${c?"":"disabled"}>
        ${c?"הוספה / עדכון במעקב איסראא":"אין הרשאה להוספה"}
      </button>
    </div>
  `,a.addEventListener("click",async g=>{const s=g.target.closest("[data-route-proposal-to-israa]");if(!s||s.disabled)return;g.preventDefault(),g.stopPropagation(),s.disabled=!0;const q=s.textContent;s.textContent="מעדכן את המעקב…";try{const{data:o,error:w}=await y.rpc("create_israa_tracking_from_proposal",{p_proposal_id:e.id});if(w)throw w;T(),window.dispatchEvent(new CustomEvent("israa-tracking-updated",{detail:{proposalId:e.id,row:(o==null?void 0:o.row)||null}})),s.textContent=o!=null&&o.created?"נוסף למעקב איסראא":"עודכן במעקב איסראא",S(o!=null&&o.created?"ההצעה נוספה למעקב איסראא.":"ההצעה עודכנה במעקב איסראא."),setTimeout(()=>{s.isConnected&&(s.disabled=!1,s.textContent="עדכון במעקב איסראא")},1400)}catch(o){console.error("[proposal-domain-e-israa-routing]",o),s.disabled=!1,s.textContent=q,S((o==null?void 0:o.message)||"הוספת ההצעה למעקב איסראא נכשלה.","error")}}),M(t).insertAdjacentElement("afterend",a),t.setAttribute("data-proposal-domain-routing-loaded",r),t.setAttribute("data-proposal-activity-loaded",e.id)}async function H(t){var e;if(!(!y||t.getAttribute("data-proposal-domain-routing-loading")==="true")){t.setAttribute("data-proposal-domain-routing-loading","true");try{const r=await B(t);if(!r)return;const n=i(r.proposal_domain).toUpperCase();if(n==="Y"){A(t);return}if(n!=="E"||!P(r)){(e=t.querySelector(`[${p}]`))==null||e.remove(),t.removeAttribute("data-proposal-activity-loaded"),A(t);return}G(t,r)}catch(r){console.error("[proposal-domain-routing]",r)}finally{t.removeAttribute("data-proposal-domain-routing-loading")}}}async function F(){if(!_){_=!0;try{N();const t=[...document.querySelectorAll("#app [data-pa-proposal-detail]")];for(const e of t)await H(e)}finally{_=!1}}}function f(){clearTimeout(v),v=setTimeout(()=>{F().catch(t=>console.error("[proposal-domain-routing-run]",t))},R)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",f,{once:!0}):f();new MutationObserver(f).observe(document.documentElement,{childList:!0,subtree:!0});window.addEventListener("hashchange",f);
