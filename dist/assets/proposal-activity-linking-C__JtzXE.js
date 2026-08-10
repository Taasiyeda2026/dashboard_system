import{C as y,i as x,b9 as T,bb as I,b4 as A,B as N,bc as P}from"./index-DpctzQJl.js";const L=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,D=new Set(["approved","sent","מאושר","מאושר וחתום","נשלח"]),B=/(שעות\s*)?בדיק(ה|ות)?/i,E="data-proposal-activity-creator",b="data-activity-gefen-column",O=120;let k=null,q=!1;function i(e){return String(e??"").replace(/\s+/g," ").trim()}function M(e){const t=Number(e);return Number.isFinite(t)?Math.max(1,Math.min(100,Math.floor(t))):1}function j(){var e,t,r,n;return i(((t=(e=A)==null?void 0:e.user)==null?void 0:t.display_role)||((n=(r=A)==null?void 0:r.user)==null?void 0:n.role))}function z(){var e;return I((e=A)==null?void 0:e.user)||["admin","operation_manager","domain_manager"].includes(j())}function F(){var e;return P((e=A)==null?void 0:e.user)}function $(e){const t=i(e),r=t.toLowerCase();return["next_year","gefen","combined"].includes(r)?r:['תשפ"ז',"תשפ״ז",'שנת הלימודים תשפ"ז',"שנת הלימודים תשפ״ז",'תוכניות תשפ"ז',"תוכניות תשפ״ז"].includes(t)?"next_year":["גפן",'גפ"ן',"גפ״ן"].includes(t)?"gefen":["summer","קיץ",'קיץ תשפ"ו',"קיץ תשפ״ו"].includes(r)||["קיץ",'קיץ תשפ"ו',"קיץ תשפ״ו"].includes(t)?"summer":r}function G(e){return i(e).toLowerCase()}function H(e){return!e||e.archived_at||!D.has(G(e.status))?!1:["next_year","gefen","combined"].includes($(e.activity_type_group))}function R(e,t){if(!(e!=null&&e.id)||B.test(i(e.item_name)))return!1;const r=$(e.proposal_group);return r==="summer"?!1:$(t==null?void 0:t.activity_type_group)==="combined"?r==="next_year"||r==="gefen":!0}function g(e,t="success"){try{N(e,t)}catch{console[t==="error"?"error":"info"](e)}}function U(){if(document.getElementById("proposal-activity-linking-styles"))return;const e=document.createElement("style");e.id="proposal-activity-linking-styles",e.textContent=`
    .proposal-activity-creator {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--ds-border, #d7dde5);
      border-radius: 12px;
      background: var(--ds-surface, #fff);
    }
    .proposal-activity-creator__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .proposal-activity-creator__title {
      margin: 0;
      font-size: .98rem;
      font-weight: 800;
    }
    .proposal-activity-creator__item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--ds-border, #e5e7eb);
    }
    .proposal-activity-creator__item:first-of-type { border-top: 0; }
    .proposal-activity-creator__name {
      min-width: 0;
      font-weight: 700;
    }
    .proposal-activity-creator__meta {
      display: block;
      margin-top: 2px;
      color: #64748b;
      font-size: .76rem;
    }
    .proposal-activity-creator__button {
      min-width: 138px;
      border: 0;
      border-radius: 9px;
      padding: 7px 11px;
      background: #1f2937;
      color: #fff;
      font: inherit;
      font-size: .82rem;
      font-weight: 700;
      cursor: pointer;
    }
    .proposal-activity-creator__button[disabled] {
      background: #e5e7eb;
      color: #475569;
      cursor: default;
    }
    th[${b}],
    td[${b}] {
      min-width: 178px;
      vertical-align: middle;
    }
    .activity-gefen-cell {
      display: grid;
      gap: 5px;
      font-size: .76rem;
      line-height: 1.25;
    }
    .activity-gefen-cell__checks {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
    }
    .activity-gefen-cell label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      cursor: pointer;
    }
    .activity-gefen-cell input[type="checkbox"] { margin: 0; }
    .activity-gefen-cell__order {
      width: 100%;
      min-width: 125px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
      font-size: .75rem;
    }
    .activity-gefen-cell__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 5px 8px;
      color: #64748b;
      font-size: .7rem;
    }
    .activity-gefen-cell__readonly { color: #475569; }
    @media (max-width: 900px) {
      .proposal-activity-creator__item { grid-template-columns: 1fr; }
      .proposal-activity-creator__button { width: 100%; }
    }
  `,document.head.appendChild(e)}function V(e,t){var c,l;const r=new Set(t.map(i)),n=e.querySelectorAll(".ds-pa-info-cell");for(const m of n){const u=i((c=m.querySelector(".ds-pa-info-label"))==null?void 0:c.textContent);if(r.has(u))return i((l=m.querySelector(".ds-pa-info-value"))==null?void 0:l.textContent)}return""}function J(e){var r;const t=[e,...e.querySelectorAll("*")];for(const n of t)for(const c of((r=n.getAttributeNames)==null?void 0:r.call(n))||[]){if(!/proposal/i.test(c))continue;const l=i(n.getAttribute(c));if(L.test(l))return l}return""}async function K(e){const t=J(e),r="id,quote_number,status,activity_type_group,archived_at,version_number";if(t){const{data:m,error:u}=await y.from("proposals_agreements").select(r).eq("id",t).maybeSingle();if(u)throw u;return m||null}const n=V(e,["מספר הצעה","מספר הצעת מחיר","מס׳ הצעה"]);if(!n)return null;const{data:c,error:l}=await y.from("proposals_agreements").select(r).eq("quote_number",n).is("archived_at",null).order("version_number",{ascending:!1}).limit(1).maybeSingle();if(l)throw l;return c||null}async function Q(e){const[{data:t,error:r},{data:n,error:c}]=await Promise.all([y.from("proposal_agreement_items").select("id,proposal_agreement_id,item_name,item_type,gefen_number,activity_no,list_id,meetings_count,hours_count,quantity,unit_price,total_price,proposal_group,sort_order").eq("proposal_agreement_id",e).order("sort_order",{ascending:!0}),y.from("activities").select("row_id,proposal_agreement_id,proposal_item_id,proposal_item_sequence,is_gefen_funded,exists_in_gefen,gefen_order_number").eq("proposal_agreement_id",e)]);if(r)throw r;if(c)throw c;return{items:Array.isArray(t)?t:[],activities:Array.isArray(n)?n:[]}}function W(e){const t=e.querySelector("[data-pa-drawer-items]");return t?t.closest(".ds-pa-info-card")||t.parentElement||e:e.querySelector(".ds-pa-activities-wide")||e}function X(e){const t=[],r=M(e.quantity);return t.push(r===1?"קבוצה אחת":`${r} קבוצות`),i(e.gefen_number)&&t.push(`מס׳ גפ״ן ${i(e.gefen_number)}`),e.meetings_count!=null&&t.push(`${i(e.meetings_count)} מפגשים`),t.join(" · ")}function Y(e){const t=new Map;for(const r of e){const n=i(r.proposal_item_id);if(!n)continue;const c=t.get(n)||[];c.push(r),t.set(n,c)}for(const r of t.values())r.sort((n,c)=>Number(n.proposal_item_sequence||0)-Number(c.proposal_item_sequence||0));return t}function Z(e,t){const r=Math.max(0,e-t);return r===0?e===1?"הפעילות נוצרה":`${e} פעילויות נוצרו`:r===1?"יצירת פעילות":`יצירת ${r} פעילויות`}function ee(e,t,r){var u;(u=e.querySelector(`[${E}]`))==null||u.remove();const n=r.items.filter(d=>R(d,t));if(!n.length)return;const c=Y(r.activities),l=document.createElement("section");l.className="proposal-activity-creator",l.setAttribute(E,t.id),l.innerHTML=`
    <div class="proposal-activity-creator__head">
      <h3 class="proposal-activity-creator__title">פעילויות 2027</h3>
    </div>
    ${n.map(d=>{const o=M(d.quantity),f=c.get(i(d.id))||[],s=f.length,a=s>=o,p=f.filter(h=>h.exists_in_gefen===!0).length,_=s?[`${Math.min(s,o)} מתוך ${o} פעילויות נוצרו`,p?`${p} סומנו כקיימות בגפ״ן`:""].filter(Boolean).join(" · "):X(d);return`
        <div class="proposal-activity-creator__item" data-proposal-item-id="${i(d.id)}">
          <div class="proposal-activity-creator__name">
            ${x(i(d.item_name))}
            ${_?`<span class="proposal-activity-creator__meta">${x(_)}</span>`:""}
          </div>
          <button type="button"
            class="proposal-activity-creator__button"
            data-create-activity-from-proposal-item="${i(d.id)}"
            ${a||!z()?"disabled":""}>
            ${Z(o,s)}
          </button>
        </div>
      `}).join("")}
  `,l.addEventListener("click",async d=>{const o=d.target.closest("[data-create-activity-from-proposal-item]");if(!o||o.disabled)return;d.preventDefault(),d.stopPropagation();const f=i(o.getAttribute("data-create-activity-from-proposal-item"));if(!L.test(f))return;o.disabled=!0,o.textContent="יוצר פעילויות…";const{data:s,error:a}=await y.rpc("create_activity_from_proposal_item",{p_proposal_item_id:f});if(a){console.error("[proposal-activity-create]",a),o.disabled=!1,o.textContent="יצירת פעילות",g(a.message||"יצירת הפעילויות נכשלה.","error");return}T();const p=Number((s==null?void 0:s.created_count)||0);p<=0?g("כל שורות הפעילות כבר קיימות."):g(p===1?"שורת הפעילות נוצרה בהצלחה.":`${p} שורות פעילות נוצרו בהצלחה.`),e.removeAttribute("data-proposal-activity-loaded"),v()}),W(e).insertAdjacentElement("afterend",l),e.setAttribute("data-proposal-activity-loaded",t.id)}async function te(e){var t;if(!(!y||e.getAttribute("data-proposal-activity-loading")==="true")){e.setAttribute("data-proposal-activity-loading","true");try{const r=await K(e);if(!r||!H(r)){(t=e.querySelector(`[${E}]`))==null||t.remove();return}if(e.getAttribute("data-proposal-activity-loaded")===r.id&&e.querySelector(`[${E}="${r.id}"]`))return;const n=await Q(r.id);ee(e,r,n)}catch(r){console.error("[proposal-activity-enhancement]",r)}finally{e.removeAttribute("data-proposal-activity-loading")}}}function C(e){var n;const t=i(((n=e.dataset)==null?void 0:n.rowId)||e.getAttribute("data-row-id"));if(t)return t;const r=e.querySelector("[data-row-id]");return i(r==null?void 0:r.getAttribute("data-row-id"))}function re(e,t){const r=i(e.proposal_agreement_id);return{quote:r?i(t.get(r)):""}}async function S(e,t){const r=i(e.row_id);if(!r)return null;const n={...t,updated_at:new Date().toISOString()},{data:c,error:l}=await y.from("activities").update(n).eq("row_id",r).select("row_id,proposal_agreement_id,proposal_item_id,proposal_item_sequence,is_gefen_funded,exists_in_gefen,gefen_order_number,funding,activity_season").single();if(l)throw l;return T(),c}function w(e,t,r){const n=F(),c=t.is_gefen_funded===!0,l=t.exists_in_gefen===!0,m=i(t.gefen_order_number);e.innerHTML=`
    <div class="activity-gefen-cell" data-gefen-row-id="${i(t.row_id)}">
      <div class="activity-gefen-cell__checks">
        <label title="הפעילות ממומנת באמצעות גפ״ן">
          <input type="checkbox" data-gefen-field="is_gefen_funded" ${c?"checked":""} ${n?"":"disabled"}>
          מימון גפ״ן
        </label>
        <label title="סימון ידני: הפעילות או ההזמנה קיימת בפועל במערכת גפ״ן">
          <input type="checkbox" data-gefen-field="exists_in_gefen" ${l?"checked":""} ${n?"":"disabled"}>
          קיים בגפ״ן
        </label>
      </div>
      <input class="activity-gefen-cell__order"
        type="text"
        data-gefen-field="gefen_order_number"
        value="${x(m)}"
        placeholder="מספר הזמנת גפ״ן"
        ${n&&l?"":"disabled"}>
      <div class="activity-gefen-cell__meta">
        ${r.quote?`<span>הצעה ${x(r.quote)}</span>`:""}
        ${n?"":'<span class="activity-gefen-cell__readonly">לצפייה בלבד</span>'}
      </div>
    </div>
  `,e.querySelectorAll("input").forEach(s=>{s.addEventListener("click",a=>a.stopPropagation()),s.addEventListener("keydown",a=>a.stopPropagation())});const u=e.querySelector('[data-gefen-field="is_gefen_funded"]'),d=e.querySelector('[data-gefen-field="exists_in_gefen"]'),o=e.querySelector('[data-gefen-field="gefen_order_number"]');u==null||u.addEventListener("change",async()=>{try{const a=u.checked?{is_gefen_funded:!0,funding:"גפן"}:{is_gefen_funded:!1,exists_in_gefen:!1,gefen_order_number:null,funding:i(t.funding)==="גפן"?null:t.funding},p=await S(t,a);Object.assign(t,p||a),w(e,t,r),g("נתוני גפ״ן נשמרו.")}catch(s){console.error("[activity-gefen-update]",s),u.checked=!u.checked,g(s.message||"שמירת נתוני גפ״ן נכשלה.","error")}}),d==null||d.addEventListener("change",async()=>{try{const a=d.checked?{is_gefen_funded:!0,exists_in_gefen:!0,funding:"גפן"}:{exists_in_gefen:!1,gefen_order_number:null},p=await S(t,a);Object.assign(t,p||a),w(e,t,r),g("נתוני גפ״ן נשמרו.")}catch(s){console.error("[activity-gefen-update]",s),d.checked=!d.checked,g(s.message||"שמירת נתוני גפ״ן נכשלה.","error")}});const f=async()=>{const s=i(o==null?void 0:o.value);if(s!==i(t.gefen_order_number))try{const a=await S(t,{is_gefen_funded:!0,exists_in_gefen:!0,funding:"גפן",gefen_order_number:s||null});Object.assign(t,a||{gefen_order_number:s}),w(e,t,r),g("מספר הזמנת גפ״ן נשמר.")}catch(a){console.error("[activity-gefen-order-update]",a),o&&(o.value=i(t.gefen_order_number)),g(a.message||"שמירת מספר ההזמנה נכשלה.","error")}};o==null||o.addEventListener("blur",f),o==null||o.addEventListener("keydown",s=>{s.key==="Enter"&&(s.preventDefault(),o.blur())})}async function ne(e){const t=[...e.querySelectorAll("tbody tr")],r=t.map(C).filter(Boolean);if(!r.length)return;const n=r.join("|");if(e.getAttribute("data-gefen-enhanced-signature")===n)return;e.setAttribute("data-gefen-enhanced-signature",`loading:${n}`);const{data:c,error:l}=await y.from("activities").select("row_id,proposal_agreement_id,proposal_item_id,proposal_item_sequence,is_gefen_funded,exists_in_gefen,gefen_order_number,funding,activity_season").in("row_id",r);if(l)throw e.removeAttribute("data-gefen-enhanced-signature"),l;const m=(Array.isArray(c)?c:[]).filter(a=>i(a.activity_season)==="school_2027");if(!m.length){e.setAttribute("data-gefen-enhanced-signature",n);return}const u=[...new Set(m.map(a=>i(a.proposal_agreement_id)).filter(Boolean))],d=new Map;if(u.length){const{data:a,error:p}=await y.from("proposals_agreements").select("id,quote_number").in("id",u);if(p)throw p;(a||[]).forEach(_=>d.set(i(_.id),i(_.quote_number)))}const o=e.querySelector("thead tr:last-child");let f=o==null?void 0:o.querySelector(`th[${b}]`);o&&!f&&(f=document.createElement("th"),f.setAttribute(b,"true"),f.scope="col",f.textContent="גפ״ן",o.appendChild(f));const s=new Map(m.map(a=>[i(a.row_id),a]));t.forEach(a=>{const p=C(a);let _=a.querySelector(`td[${b}]`);_||(_=document.createElement("td"),_.setAttribute(b,"true"),a.appendChild(_));const h=s.get(p);if(!h){_.textContent="—";return}w(_,h,re(h,d))}),e.setAttribute("data-gefen-enhanced-signature",n)}async function ae(){if(!(!y||q)){q=!0;try{const e=[...document.querySelectorAll("#app table")];for(const t of e)try{await ne(t)}catch(r){console.error("[activity-gefen-table-enhancement]",r)}}finally{q=!1}}}async function ie(){U();const e=[...document.querySelectorAll("#app [data-pa-proposal-detail]")];await Promise.all(e.map(te)),await ae()}function v(){clearTimeout(k),k=setTimeout(()=>{ie().catch(e=>console.error("[proposal-activity-linking]",e))},O)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",v,{once:!0}):v();new MutationObserver(v).observe(document.documentElement,{childList:!0,subtree:!0});window.addEventListener("hashchange",v);
