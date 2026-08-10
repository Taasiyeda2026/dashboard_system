import{q as i,a3 as d,i as l,j as o,a6 as p}from"./index-CH0LFGSL.js";const g={load:({api:e})=>e.adminLists(),render(e){const s=Array.isArray(e==null?void 0:e.categories)?e.categories:[],n=s.length===0?i("אין רשימות"):s.map(r=>d({title:l(r.category),padded:!0,body:`
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-2, 8px);">
              ${(r.items||[]).map(a=>{const t=a.label?a.label:a.value;return`<li><span class="ds-badge" dir="rtl">${l(t)}</span></li>`}).join("")}
            </ul>
          `})).join("");return o(`
      ${p("ניהול רשימות",`${s.length} קטגוריות`)}
      ${n}
    `)},bind(){}};export{g as adminListsScreen};
