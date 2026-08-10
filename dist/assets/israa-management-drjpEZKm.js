import{j as V,i as o}from"./index-DpctzQJl.js";const sa="92bfb9d9-1b17-4022-901a-5f7cf17a263a",O=1e6;let L="table",f=[],k=null,z={},A=!1,M={},S=null,E=null,x=[],Y=!1,P=!1,C=null,I={},R=!1,q={},y=null,G=0;const ra=["","נשלחה הצעה",'גפן תשפ"ז',"תוכנית קיץ"],H=[{key:"authority",label:"רשות",type:"text"},{key:"school_name",label:'שם ביה"ס',type:"text"},{key:"contact_person",label:"איש קשר",type:"text"},{key:"phone",label:"טלפון",type:"tel"},{key:"email",label:"אימייל",type:"email"},{key:"program_name",label:"תוכנית",type:"program"},{key:"quantity",label:"כמות",type:"number"},{key:"total_cost",label:'סה"כ עלות',type:"text"},{key:"activity_date",label:"תאריך",type:"date"},{key:"status",label:"סטטוס",type:"status"},{key:"notes",label:"הערות",type:"text"}],aa=new Set(["contact_person","phone","email"]),j=H.filter(a=>!aa.has(a.key)),N=H.filter(a=>aa.has(a.key));function K(a){var t,i,l,n;const s=String(((t=a==null?void 0:a.user)==null?void 0:t.user_id)||""),r=String(((i=a==null?void 0:a.user)==null?void 0:i.auth_user_id)||""),e=String(((l=a==null?void 0:a.user)==null?void 0:l.display_role)||((n=a==null?void 0:a.user)==null?void 0:n.role)||"");return s==="3030"||r===sa||e==="admin"}function J(a){var r,e;const s=(e=(r=a==null?void 0:a.clientSettings)==null?void 0:r.dropdown_options)==null?void 0:e.activity_names;return Array.isArray(s)?s.map(t=>String(t.label||t.value||"")).filter(Boolean):[]}function v(a){return`<span class="money money--ils" dir="ltr"><span class="money__symbol">₪</span><span class="money__value">${(Number(a)||0).toLocaleString("he-IL",{minimumFractionDigits:0,maximumFractionDigits:0})}</span></span>`}function ta(a){if(!a)return"";try{const s=new Date(a);return`${String(s.getDate()).padStart(2,"0")}/${String(s.getMonth()+1).padStart(2,"0")}/${s.getFullYear()}`}catch{return String(a)}}function la(a,s){return s.key==="activity_date"?o(ta(a==null?void 0:a[s.key])):o(String((a==null?void 0:a[s.key])??""))}function D(a,s,r,e){const t=o(String(s??""));return r.type==="status"?`<select class="israa-inp" name="${a}">
      ${ra.map(i=>`<option value="${o(i)}"${i===(s??"")?" selected":""}>${o(i||"(ריק)")}</option>`).join("")}
    </select>`:r.type==="program"?e.length?`<select class="israa-inp" name="${a}">
        ${["",...e].map(i=>`<option value="${o(i)}"${i===(s??"")?" selected":""}>${o(i||"(ריק)")}</option>`).join("")}
      </select>`:`<input class="israa-inp" name="${a}" type="text" value="${t}" />`:r.type==="number"?`<input class="israa-inp" name="${a}" type="number" min="1" max="999" value="${t}" />`:r.type==="date"?`<input class="israa-inp" name="${a}" type="date" value="${t}" />`:`<input class="israa-inp" name="${a}" type="text" value="${t}" />`}function na(a,s,r,e,t){const i=a.id===s,l=i||a.id===e,n=j.map(c=>{const h=i?D(c.key,r[c.key]??a[c.key],c,t):la(a,c);return`<td class="israa-cell${c.key==="notes"?" israa-cell--notes":""}">${h}</td>`}).join(""),m=i?`<td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--save" data-israa-save="${o(a.id)}" title="שמירה">💾</button>
        <button class="israa-btn israa-btn--cancel" data-israa-cancel="${o(a.id)}" title="ביטול">✕</button>
      </td>`:`<td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--edit" data-israa-edit="${o(a.id)}" title="עריכה">✏️</button>
        <button class="israa-btn israa-btn--del" data-israa-del="${o(a.id)}" title="מחיקה">🗑️</button>
      </td>`,u=`<tr class="israa-row${i?" israa-row--editing":""}" data-row-id="${o(a.id)}"${i?"":` data-prog-toggle="${o(a.id)}"`}>${n}${m}</tr>`;if(!l)return u;let g;return i?g=N.map(c=>{const h=D(c.key,r[c.key]??a[c.key],c,t);return`<div class="prog-detail__field"><span class="prog-detail__lbl">${o(c.label)}:</span>${h}</div>`}).join(""):g=N.map(h=>{const w=String(a[h.key]??"");return w?`<span class="prog-detail__item"><span class="prog-detail__lbl">${o(h.label)}:</span> <span>${o(w)}</span></span>`:""}).join("")||'<span class="prog-detail__empty">אין פרטי איש קשר</span>',u+`<tr class="prog-detail-row" data-detail-for="${o(a.id)}">
    <td colspan="${j.length+1}" class="prog-detail-cell${i?" prog-detail-cell--edit":""}">
      ${g}
    </td>
  </tr>`}function oa(a,s){const r=j.map(t=>`<td class="israa-cell${t.key==="notes"?" israa-cell--notes":""}">${D(t.key,a[t.key],t,s)}</td>`).join(""),e=N.map(t=>{const i=D(t.key,a[t.key],t,s);return`<div class="prog-detail__field"><span class="prog-detail__lbl">${o(t.label)}:</span>${i}</div>`}).join("");return`<tr class="israa-row israa-row--new" data-row-id="__new__">
      ${r}
      <td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--save" data-israa-save-new title="שמירה">💾</button>
        <button class="israa-btn israa-btn--cancel" data-israa-cancel-new title="ביטול">✕</button>
      </td>
    </tr>
    <tr class="prog-detail-row">
      <td colspan="${j.length+1}" class="prog-detail-cell prog-detail-cell--edit">
        ${e}
      </td>
    </tr>`}function da(a,s,r,e,t,i,l,n){const m=j.map(c=>`<th class="israa-th${c.key==="notes"?" israa-th--notes":""}">${o(c.label)}</th>`).join(""),u=j.length+1,g=[!a.length&&!e?`<tr><td colspan="${u}" class="israa-empty">אין רשומות. לחצי "+ הוספת שורה" להתחיל.</td></tr>`:"",a.map(c=>na(c,s,r,l,n)).join(""),e?oa(t,n):""].join("");return`<div class="israa-toolbar">
      <button class="israa-btn israa-btn--primary" data-israa-action="add-row"${e?" disabled":""}>+ הוספת שורה</button>
      <button class="israa-btn" data-israa-action="export-csv">📥 ייצוא לאקסל</button>
    </div>
    <div class="prog-section">
      ${i?`<div class="israa-error">${o(i)}</div>`:""}
      <div class="israa-table-wrap">
        <table class="israa-table prog-table" dir="rtl">
          <thead>
            <tr>${m}<th class="israa-th israa-th--actions">פעולות</th></tr>
          </thead>
          <tbody>${g}</tbody>
        </table>
      </div>
    </div>`}function ea(a,s){const r=Number(s)||0,e=a.reduce((g,c)=>g+(Number(c.amount)||0),0),t=e+r,i=O-t,l=Math.max(0,i),n=t/O*100,m=i<=0,u=Math.max(0,t-O);return{total:e,collabAmt:r,reached:t,balance:i,remaining:l,rawPct:n,overGoal:m,overAmt:u}}function ia(a){if(a.overGoal||a.balance<=0){const i=['<strong class="sim-goal-opts__highlight">היעד הושג.</strong> אין צורך בקורסים או סדנאות נוספים כדי להגיע ליעד.'];return a.overAmt>0&&i.push(`מעבר ליעד: <strong class="sim-goal-opts__highlight">+${v(a.overAmt)}</strong>`),i.join("<br>")}const s=Math.ceil(a.balance*.7/9e3),r=Math.ceil(a.balance*.3/500),e=s.toLocaleString("he-IL"),t=r.toLocaleString("he-IL");return[`להגעה ליעד אפשר להביא עוד <strong class="sim-goal-opts__highlight">${e} קורסים</strong> במחיר ממוצע של <strong class="sim-goal-opts__highlight">${v(9e3)}</strong> לקורס.`,`להגעה ליעד אפשר להביא עוד <strong class="sim-goal-opts__highlight">${t} סדנאות מייקרים</strong> במחיר ממוצע של <strong class="sim-goal-opts__highlight">${v(500)}</strong> לסדנה.`].join("<br>")}function ca(a){const{total:s,remaining:r,rawPct:e,overGoal:t,overAmt:i}=a,l=e.toFixed(1)+"%";return`<div class="sim-cards">
      <div class="sim-card">
        <div class="sim-card__lbl">יעד הכנסות</div>
        <div class="sim-card__val sim-card__val--goal">${v(O)}</div>
      </div>
      <div class="sim-card">
        <div class="sim-card__lbl">סה"כ הכנסות</div>
        <div class="sim-card__val">${v(s)}</div>
      </div>
      <div class="sim-card">
        <div class="sim-card__lbl">נותר ליעד</div>
        <div class="sim-card__val${t?" sim-card__val--over":""}">${v(t?0:r)}</div>
      </div>
      <div class="sim-card${t?" sim-card--highlight":""}">
        <div class="sim-card__lbl">התקדמות</div>
        <div class="sim-card__val${t?" sim-card__val--over":""}">${l}${t?" 🎉":""}</div>
      </div>
      ${t?`<div class="sim-card sim-card--over-banner"><div class="sim-card__lbl">מעבר ליעד</div><div class="sim-card__val sim-card__val--over">+${v(i)}</div></div>`:""}
    </div>`}function ma(a){const s=Math.min(a.rawPct,100).toFixed(2);return`<div class="sim-progress" dir="rtl">
      <div class="sim-progress__head">
        <span class="sim-progress__pct">${a.rawPct.toFixed(1)}%</span>
      </div>
      <div class="sim-progress__track">
        <div class="sim-progress__fill${a.overGoal?" sim-progress__fill--over":""}" style="width:${s}%"></div>
      </div>
    </div>`}function pa(a,s){const r=Number(s)||0;return`<div class="sim-goal-opts">
      <div class="sim-goal-opts__title">אפשרויות להגעה ליעד</div>
      <div class="sim-goal-opts__collab-row">
        <label class="sim-goal-opts__collab-label">
          <span>סה"כ שיתופי פעולה:</span>
          <input class="israa-inp sim-goal-opts__collab-inp" type="number" min="0" step="1"
                 value="${o(String(r))}" data-sim-collab placeholder="0" />
          <span class="sim-goal-opts__formatted" data-sim-collab-formatted>${v(r)}</span>
        </label>
      </div>
      <div class="sim-goal-opts__result" data-sim-goal-result>${ia(a)}</div>
    </div>`}function ba(a,s,r){const e=a.id===s,t=e?r.revenue_date??a.revenue_date??"":a.revenue_date??"",i=e?r.payer_name??a.payer_name??"":a.payer_name??"",l=e?r.amount??a.amount??"":a.amount??"",n=Number(l)>0?Number(l)*.1:null,m=o(String(i??"")),u=e?`<td class="israa-cell sim-cell--date"><input class="israa-inp" name="revenue_date" type="date" value="${o(String(t))}" /></td>`:`<td class="israa-cell sim-cell--date">${o(ta(t))}</td>`,g=e?`<td class="israa-cell sim-cell--payer"><input class="israa-inp" name="payer_name" type="text" value="${m}" /></td>`:`<td class="israa-cell sim-cell--payer">${m}</td>`,c=e?`<td class="israa-cell sim-cell--amt"><input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${o(String(l))}" /></td>`:`<td class="israa-cell sim-cell--amt">${l!==""&&l!=null?v(l):""}</td>`,h=`<td class="israa-cell sim-cell--comm">${n!=null?v(n):""}</td>`,w=e?`<td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--save" data-sim-save="${o(a.id)}" title="שמירה">💾</button>
        <button class="israa-btn israa-btn--cancel" data-sim-cancel="${o(a.id)}" title="ביטול">✕</button>
      </td>`:`<td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--edit" data-sim-edit="${o(a.id)}" title="עריכה">✏️</button>
        <button class="israa-btn israa-btn--del" data-sim-del="${o(a.id)}" title="מחיקה">🗑️</button>
      </td>`;return`<tr class="israa-row${e?" israa-row--editing":""}" data-sim-row-id="${o(a.id)}">${u}${g}${c}${h}${w}</tr>`}function ua(a){return`<tr class="israa-row israa-row--new">
      <td class="israa-cell sim-cell--date">
        <input class="israa-inp" name="revenue_date" type="date" value="${o(String(a.revenue_date??""))}" />
      </td>
      <td class="israa-cell sim-cell--payer">
        <input class="israa-inp" name="payer_name" type="text" value="${o(String(a.payer_name??""))}" placeholder="גורם משלם" />
      </td>
      <td class="israa-cell sim-cell--amt">
        <input class="israa-inp sim-inp--amt" name="amount" type="number" min="0" step="1" value="${o(String(a.amount??""))}" placeholder="0" />
      </td>
      <td class="israa-cell sim-cell--comm"></td>
      <td class="israa-cell israa-cell--actions">
        <button class="israa-btn israa-btn--save" data-sim-save-new title="שמירה">💾</button>
        <button class="israa-btn israa-btn--cancel" data-sim-cancel-new title="ביטול">✕</button>
      </td>
    </tr>`}function ga(a,s,r,e,t,i,l,n){if(l)return'<div class="sim-loading">טוען נתוני סימולטור…</div>';const m=ea(a,n),u=[!a.length&&!e?'<tr><td colspan="5" class="israa-empty">אין הכנסות. לחצי "+ הוספת הכנסה" להתחיל.</td></tr>':"",a.map(g=>ba(g,s,r)).join(""),e?ua(t):""].join("");return`
    ${ca(m)}
    ${ma(m)}
    ${pa(m,n)}
    <div class="sim-table-section">
      <div class="israa-toolbar">
        <button class="israa-btn israa-btn--primary" data-sim-action="add-row"${e?" disabled":""}>+ הוספת הכנסה</button>
      </div>
      ${i?`<div class="israa-error">${o(i)}</div>`:""}
      <div class="israa-table-wrap">
        <table class="israa-table sim-table" dir="rtl">
          <thead>
            <tr>
              <th class="israa-th sim-th--date">תאריך</th>
              <th class="israa-th sim-th--payer">גורם משלם</th>
              <th class="israa-th sim-th--amt">סכום</th>
              <th class="israa-th sim-th--comm">עמלות</th>
              <th class="israa-th israa-th--actions">פעולות</th>
            </tr>
          </thead>
          <tbody>${u}</tbody>
        </table>
      </div>
    </div>`}function Q(a){return`<div class="israa-tabbar" role="tablist" dir="rtl">
      <button class="israa-tab${a==="table"?" is-active":""}" data-israa-tab="table" role="tab">טבלת תוכניות</button>
      <button class="israa-tab${a==="simulator"?" is-active":""}" data-israa-tab="simulator" role="tab">סימולטור</button>
    </div>`}function W(a,s){return a==="simulator"?Q(a)+`<div class="sim-panel">${ga(x,C,I,R,q,y,P,G)}</div>`:Q(a)+da(f,k,z,A,M,S,E,s)}function fa(a){const r=[H.map(l=>l.label).join(","),...a.map(l=>H.map(n=>{let m=String(l[n.key]??"");return(m.includes(",")||m.includes('"')||m.includes(`
`))&&(m='"'+m.replace(/"/g,'""')+'"'),m}).join(","))],e=new Blob(["\uFEFF"+r.join(`\r
`)],{type:"text/csv;charset=utf-8"}),t=URL.createObjectURL(e),i=document.createElement("a");i.href=t,i.download="israa-program-tracking.csv",document.body.appendChild(i),i.click(),i.remove(),URL.revokeObjectURL(t)}function X(a){var e;const s=(e=a.nextElementSibling)!=null&&e.classList.contains("prog-detail-row")?a.nextElementSibling:null,r={};return H.forEach(t=>{const i=a.querySelector(`[name="${t.key}"]`)||(s?s.querySelector(`[name="${t.key}"]`):null);i&&(r[t.key]=t.type==="number"?i.value===""?null:parseInt(i.value,10):t.type==="date"?i.value||null:i.value)}),r}function Z(a){var e,t,i;const s=((e=a.querySelector('[name="amount"]'))==null?void 0:e.value)??"";return{revenue_date:(((t=a.querySelector('[name="revenue_date"]'))==null?void 0:t.value)??"")||null,payer_name:((i=a.querySelector('[name="payer_name"]'))==null?void 0:i.value)??"",amount:s===""?null:parseFloat(s)}}const ha=`<style data-israa-styles>
.israa-mgmt{
  direction:rtl;
  width:100%;
  max-width:100%;
  min-width:0;
  box-sizing:border-box;
}

.israa-tabbar{
  display:flex;
  gap:4px;
  margin-bottom:14px;
  border-bottom:2px solid var(--ds-border,#e2e8f0);
}

.israa-tab{
  background:none;
  border:none;
  border-bottom:3px solid transparent;
  padding:8px 18px;
  font-size:14px;
  cursor:pointer;
  color:var(--ds-text-secondary,#64748b);
  margin-bottom:-2px;
  transition:color .15s,border-color .15s;
}

.israa-tab.is-active{
  color:var(--ds-accent,#1a3358);
  border-bottom-color:var(--ds-accent,#1a3358);
  font-weight:600;
}

.israa-toolbar{
  display:flex;
  gap:8px;
  margin-bottom:10px;
  align-items:center;
}

.israa-table-wrap{
  overflow-x:auto;
  border:1px solid var(--ds-border,#e2e8f0);
  border-radius:6px;
  background:#fff;
}

.israa-table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
  table-layout:fixed;
  background:#fff;
}

.israa-th{
  background:var(--ds-table-head-bg,#f1f5f9);
  padding:5px 8px;
  text-align:right;
  font-weight:600;
  white-space:nowrap;
  border-bottom:1px solid var(--ds-border,#e2e8f0);
  font-size:12px;
}

.money{
  display:inline-flex;
  flex-direction:row;
  align-items:center;
  justify-content:center;
  gap:3px;
  direction:ltr;
  unicode-bidi:isolate;
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
}

.money__symbol,
.money__value{
  display:inline-block;
  line-height:1;
}

.israa-th--actions{
  width:72px;
  text-align:center;
}

.israa-cell{
  padding:3px 6px;
  border-bottom:1px solid var(--ds-border,#f1f5f9);
  vertical-align:middle;
  font-size:12px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.israa-cell--actions{
  text-align:center;
  white-space:nowrap;
  overflow:visible;
  width:72px;
}

.israa-row:last-child .israa-cell{
  border-bottom:none;
}

.israa-row:hover .israa-cell{
  background:var(--ds-row-hover,#f8fafc);
}

.israa-row--editing .israa-cell{
  background:#fffbeb;
}

.israa-row--new .israa-cell{
  background:#f0fdf4;
}

.israa-empty{
  text-align:center;
  padding:28px;
  color:var(--ds-text-secondary,#94a3b8);
  font-size:13px;
}

.israa-inp{
  width:100%;
  min-width:0;
  padding:2px 5px;
  font-size:11px;
  border:1px solid #cbd5e1;
  border-radius:3px;
  background:#fff;
  box-sizing:border-box;
}

.israa-inp:focus{
  outline:2px solid var(--ds-accent,#1a3358);
  outline-offset:0;
}

.israa-error{
  background:#fef2f2;
  border:1px solid #fca5a5;
  color:#b91c1c;
  border-radius:4px;
  padding:8px 12px;
  margin-bottom:8px;
  font-size:13px;
}

.israa-btn{
  padding:3px 7px;
  font-size:11px;
  border:1px solid #cbd5e1;
  border-radius:4px;
  cursor:pointer;
  background:#fff;
  color:var(--ds-text,#1e293b);
  line-height:1.4;
  white-space:nowrap;
}

.israa-btn:hover{
  background:#f1f5f9;
}

.israa-btn:disabled{
  opacity:.5;
  cursor:default;
}

.israa-btn--primary{
  background:var(--ds-accent,#1a3358);
  color:#fff;
  border-color:var(--ds-accent,#1a3358);
  font-size:12px;
  padding:4px 10px;
}

.israa-btn--primary:hover:not(:disabled){
  opacity:.88;
}

.israa-btn--save{
  background:#16a34a;
  color:#fff;
  border-color:#16a34a;
}

.israa-btn--save:hover:not(:disabled){
  opacity:.85;
}

.israa-btn--del{
  background:#dc2626;
  color:#fff;
  border-color:#dc2626;
}

.israa-btn--del:hover:not(:disabled){
  opacity:.85;
}

.israa-btn--cancel{
  background:#64748b;
  color:#fff;
  border-color:#64748b;
}

.israa-btn--edit{
  background:var(--ds-accent,#1a3358);
  color:#fff;
  border-color:var(--ds-accent,#1a3358);
}

/* ── Simulator ─────────────────────────────────────────────────────────────── */

.sim-panel{
  direction:rtl;
}

.sim-loading{
  padding:28px;
  text-align:center;
  color:var(--ds-text-secondary,#64748b);
  font-size:14px;
}

.sim-cards{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-bottom:14px;
  justify-content:center;
}

.sim-card{
  background:#fff;
  border:1px solid var(--ds-border,#e2e8f0);
  border-radius:8px;
  padding:10px 14px;
  min-width:120px;
  max-width:200px;
  flex:0 1 auto;
  box-shadow:0 1px 2px rgba(0,0,0,.04);
  text-align:center;
}

.sim-card--highlight{
  border-color:var(--ds-accent,#1a3358);
  background:#f0f4ff;
}

.sim-card--over-banner{
  border-color:#16a34a;
  background:#f0fdf4;
}

.sim-card__lbl{
  font-size:13px;
  color:var(--ds-text-secondary,#64748b);
  margin-bottom:4px;
  white-space:nowrap;
}

.sim-card__val{
  font-size:17px;
  font-weight:700;
  color:var(--ds-text,#1e293b);
  white-space:nowrap;
}

.sim-card__val--goal{
  color:#1a3358;
}

.sim-card__val--over{
  color:#16a34a;
}

.sim-progress{
  max-width:680px;
  margin:0 auto 16px;
  direction:rtl;
}

.sim-progress__head{
  display:flex;
  justify-content:flex-start;
  margin-bottom:5px;
}

.sim-progress__track{
  height:10px;
  background:#e2e8f0;
  border-radius:99px;
  overflow:hidden;
  display:flex;
  justify-content:flex-start;
  direction:rtl;
}

.sim-progress__fill{
  height:100%;
  background:var(--ds-accent,#1a3358);
  border-radius:99px;
  transition:width .4s ease;
}

.sim-progress__fill--over{
  background:#16a34a;
}

.sim-progress__pct{
  font-size:12px;
  font-weight:700;
  white-space:nowrap;
  min-width:40px;
  color:var(--ds-text,#1e293b);
}

.sim-goal-opts{
  background:#fff;
  border:1.5px solid #cbd5e1;
  border-radius:10px;
  padding:14px 18px;
  margin:0 auto 16px;
  max-width:640px;
  box-shadow:0 2px 8px rgba(26,51,88,.05);
}

.sim-goal-opts__title{
  font-size:17px;
  font-weight:800;
  color:var(--ds-text,#1e293b);
  margin-bottom:10px;
  text-align:right;
}

.sim-goal-opts__collab-row{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:10px;
}

.sim-goal-opts__collab-label{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  font-weight:600;
  color:var(--ds-text,#1e293b);
  flex-wrap:wrap;
}

.sim-goal-opts__collab-inp{
  width:120px!important;
  text-align:left;
  direction:ltr;
}

.sim-goal-opts__formatted{
  font-size:14px;
  font-weight:700;
  color:var(--ds-text,#1e293b);
}

.sim-goal-opts__result{
  font-size:15px;
  font-weight:600;
  color:var(--ds-text,#1e293b);
  line-height:1.9;
}

.sim-goal-opts__highlight{
  font-weight:800;
  color:var(--ds-accent,#1a3358);
}

/* ── Simulator income table ───────────────────────────────────────────────── */

.sim-table-section{
  margin-top:18px;
  display:flex;
  flex-direction:column;
  align-items:center;
}

.sim-table-section .israa-toolbar{
  width:600px;
  max-width:100%;
  display:flex;
  justify-content:flex-start;
  margin-bottom:8px;
}

.sim-table-section .israa-table-wrap{
  width:600px;
  max-width:100%;
  background:#fff;
  border:1px solid #cbd5e1;
  border-radius:8px;
  box-shadow:0 2px 8px rgba(26,51,88,.06);
  overflow-x:hidden;
}

.sim-table{
  width:100%;
  table-layout:fixed;
  background:#fff;
  border-collapse:separate;
  border-spacing:0;
}

.sim-table .israa-th{
  background:#f8fafc;
  border-bottom:1px solid #cbd5e1;
  border-inline-start:1px solid #dbe3ef;
  font-weight:700;
  text-align:center;
}

.sim-table .israa-th:first-child{
  border-inline-start:none;
}

.sim-table .israa-cell{
  background:#fff;
  border-bottom:1px solid #e2e8f0;
  border-inline-start:1px solid #eef2f7;
  text-align:center;
}

.sim-table .israa-cell:first-child{
  border-inline-start:none;
}

.sim-table .israa-row:nth-child(even) .israa-cell{
  background:#fbfdff;
}

.sim-table .israa-row:hover .israa-cell{
  background:#f8fafc;
}

.sim-table th:nth-child(1),
.sim-table td:nth-child(1){
  width:13%;
  text-align:center;
}

.sim-table th:nth-child(2),
.sim-table td:nth-child(2){
  width:33%;
  text-align:right;
}

.sim-table th:nth-child(3),
.sim-table td:nth-child(3){
  width:20%;
  text-align:center;
}

.sim-table th:nth-child(4),
.sim-table td:nth-child(4){
  width:20%;
  text-align:center;
}

.sim-table th:nth-child(5),
.sim-table td:nth-child(5){
  width:14%;
  text-align:center;
}

.sim-th--date,
.sim-th--payer,
.sim-th--amt,
.sim-th--comm,
.sim-cell--date,
.sim-cell--payer,
.sim-cell--amt,
.sim-cell--comm{
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
}

.sim-cell--payer{
  text-align:right;
}

.sim-cell--amt,
.sim-cell--comm{
  text-align:center;
}

.sim-cell--comm{
  color:var(--ds-text-secondary,#64748b);
}

.sim-inp--amt{
  text-align:left;
  direction:ltr;
}

.sim-table .money{
  justify-content:center;
}

@media (max-width:640px){
  .sim-table-section .israa-table-wrap{
    overflow-x:auto;
  }
}

/* ── Program table ─────────────────────────────────────────────────────────── */

.prog-section{
  max-width:80%;
}

@media (max-width:768px){
  .prog-section{
    max-width:100%;
  }
}

.prog-section .israa-table-wrap{
  background:#fff;
  box-shadow:0 2px 8px rgba(26,51,88,.07);
}

.prog-table{
  table-layout:auto;
}

.israa-th--notes{
  min-width:140px;
}

.israa-cell--notes{
  white-space:normal;
  word-break:break-word;
}

.prog-table .israa-row[data-prog-toggle]{
  cursor:pointer;
}

.prog-detail-row .prog-detail-cell{
  background:#eef2fa;
  padding:8px 14px;
  border-bottom:1px solid var(--ds-border,#e2e8f0);
}

.prog-detail__item{
  display:inline-flex;
  gap:4px;
  align-items:center;
  font-size:12px;
  color:var(--ds-text,#1e293b);
  margin-left:18px;
}

.prog-detail__lbl{
  font-weight:600;
  color:var(--ds-text-secondary,#64748b);
  white-space:nowrap;
}

.prog-detail__empty{
  color:var(--ds-text-secondary,#94a3b8);
  font-size:12px;
  font-style:italic;
}

.prog-detail-cell--edit{
  background:#fffbeb!important;
}

.prog-detail-cell--edit .prog-detail__field{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:12px;
  margin-left:14px;
}

.prog-detail-cell--edit .prog-detail__field .israa-inp{
  width:150px!important;
}

@media (max-width:700px){
  .sim-table-section .israa-toolbar,
  .sim-table-section .israa-table-wrap,
  .sim-table{
    width:100%;
    min-width:0;
  }
}
</style>`,xa={load:async({api:a,state:s})=>{if(!K(s))return{rows:[]};const r=await a.israaProgramTracking();return f=Array.isArray(r==null?void 0:r.rows)?r.rows:[],{rows:f}},render(a,{state:s}={}){return K(s)?(a!=null&&a.rows&&(f=Array.isArray(a.rows)?a.rows:f),V(ha+'<div class="israa-mgmt">'+W(L,J(s))+"</div>")):V('<div style="padding:24px;color:#b91c1c;direction:rtl">אין גישה לעמוד זה.</div>')},bind({root:a,state:s,api:r}){const e=a.querySelector(".israa-mgmt");if(!e)return;function t(){a.contains(e)&&(e.innerHTML=W(L,J(s)))}async function i(){if(!(Y||P)){P=!0,t();try{const l=await r.israaSimulatorEntries();x=Array.isArray(l==null?void 0:l.rows)?l.rows:[],Y=!0,y=null}catch(l){y=l.message||"שגיאה בטעינת נתוני סימולטור"}finally{P=!1}t()}}e.addEventListener("click",async l=>{const n=l.target,m=n.closest("[data-israa-tab]");if(m){L=m.dataset.israaTab,t(),L==="simulator"&&i();return}if(n.closest('[data-israa-action="add-row"]')){A||(A=!0,M={},k=null,t());return}if(n.closest('[data-israa-action="export-csv"]')){fa(f);return}const u=n.closest("[data-israa-edit]");if(u){const d=f.find(p=>p.id===u.dataset.israaEdit);d&&(k=d.id,z={...d},A=!1,t());return}if(n.closest("[data-israa-cancel]")){k=null,z={},t();return}if(n.closest("[data-israa-cancel-new]")){A=!1,M={},t();return}const g=n.closest("[data-israa-save]");if(g){const d=g.dataset.israaSave,p=e.querySelector(`[data-row-id="${d}"]`);if(!p)return;g.disabled=!0,g.textContent="…";try{const b=X(p),_=await r.israaUpdateRow(d,b);f=f.map($=>$.id===d?(_==null?void 0:_.row)||{...$,...b}:$),k=null,z={},S=null}catch(b){S=b.message||"שגיאה בשמירה"}t();return}const c=n.closest("[data-israa-save-new]");if(c){const d=e.querySelector(".israa-row--new");if(!d)return;c.disabled=!0,c.textContent="…";try{const p=X(d),b=await r.israaInsertRow(p);f=[...f,(b==null?void 0:b.row)||{id:String(Date.now()),...p}],A=!1,M={},S=null}catch(p){S=p.message||"שגיאה בהוספה"}t();return}const h=n.closest("[data-israa-del]");if(h){const d=h.dataset.israaDel;if(!window.confirm("למחוק את השורה הזו?"))return;h.disabled=!0;try{await r.israaDeleteRow(d),f=f.filter(p=>p.id!==d),k===d&&(k=null,z={}),E===d&&(E=null),S=null}catch(p){S=p.message||"שגיאה במחיקה"}t();return}const w=n.closest("[data-prog-toggle]");if(w&&!n.closest(".israa-cell--actions")){const d=w.dataset.progToggle;E=E===d?null:d,t();return}if(n.closest('[data-sim-action="add-row"]')){R||(R=!0,q={},C=null,t());return}const U=n.closest("[data-sim-edit]");if(U){const d=x.find(p=>p.id===U.dataset.simEdit);d&&(C=d.id,I={...d},R=!1,t());return}if(n.closest("[data-sim-cancel]")){C=null,I={},t();return}if(n.closest("[data-sim-cancel-new]")){R=!1,q={},t();return}const T=n.closest("[data-sim-save]");if(T){const d=T.dataset.simSave,p=e.querySelector(`[data-sim-row-id="${d}"]`);if(!p)return;T.disabled=!0,T.textContent="…";const b=Z(p);try{const _=await r.israaSimUpdateRow(d,b);x=x.map($=>$.id===d?(_==null?void 0:_.row)||{...$,...b}:$),C=null,I={},y=null}catch(_){y=_.message||"שגיאה בשמירה"}t();return}const F=n.closest("[data-sim-save-new]");if(F){const d=e.querySelector(".sim-panel .israa-row--new");if(!d)return;F.disabled=!0,F.textContent="…";const p=Z(d);try{const b=await r.israaSimInsertRow(p);x=[...x,(b==null?void 0:b.row)||{id:String(Date.now()),...p}],R=!1,q={},y=null}catch(b){y=b.message||"שגיאה בהוספה"}t();return}const B=n.closest("[data-sim-del]");if(B){const d=B.dataset.simDel;if(!window.confirm("למחוק את הרשומה הזו?"))return;B.disabled=!0;try{await r.israaSimDeleteRow(d),x=x.filter(p=>p.id!==d),C===d&&(C=null,I={}),y=null}catch(p){y=p.message||"שגיאה במחיקה"}t()}}),e.addEventListener("input",l=>{if(!l.target.matches("[data-sim-collab]"))return;const n=Math.max(0,parseFloat(l.target.value)||0),m=e.querySelector("[data-sim-goal-result]");m&&(m.innerHTML=ia(ea(x,n)));const u=e.querySelector("[data-sim-collab-formatted]");u&&(u.innerHTML=v(n))}),e.addEventListener("change",l=>{l.target.matches("[data-sim-collab]")&&(G=Math.max(0,parseFloat(l.target.value)||0),l.target.value=G,t())}),L==="simulator"&&i()}};export{xa as israaManagementScreen};
