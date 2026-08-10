import{B as c,q as y,i as l,j as v,a6 as u,a3 as h}from"./index-CH0LFGSL.js";const $=[{key:"sheet_activities",label:"פעילויות",hint:"טבלת מקור יחידה: activities"}],f={load:({api:s})=>Promise.all([s.adminSettings(),s.listSheets()]).then(([a,e])=>({settings:a,sheets:e})),render(s){const a=(s==null?void 0:s.settings)||{},e=(s==null?void 0:s.sheets)||{},i=Array.isArray(a==null?void 0:a.rows)?a.rows:[],o=Array.isArray(e==null?void 0:e.sheets)?e.sheets:[],d=(e==null?void 0:e.sheet_roles)||{},n=i.length===0?y("אין הגדרות מערכת"):`
        <div class="ds-table-wrap">
          <table class="ds-table">
            <thead>
              <tr>
                <th>מפתח</th>
                <th>ערך</th>
                <th>תיאור</th>
              </tr>
            </thead>
            <tbody>
              ${i.map(t=>`
                <tr>
                  <td><code>${l(t.key)}</code></td>
                  <td>${l(t.value||"—")}</td>
                  <td class="ds-muted">${l(t.description||"—")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `,r=o.length===0?y("לא נמצאו לשוניות"):`
        <div style="display: flex; flex-direction: column; gap: var(--space-4, 16px);">
          ${$.map(t=>{const m=d[t.key]||"";return`
              <div style="display: flex; flex-direction: column; gap: var(--space-1, 4px);">
                <label style="font-weight: 500;" for="sheet-role-${l(t.key)}">${l(t.label)}</label>
                <p class="ds-muted" style="margin: 0; font-size: var(--font-size-sm, 0.875rem);">${l(t.hint)}</p>
                <div style="display: flex; align-items: center; gap: var(--space-2, 8px); flex-wrap: wrap; margin-top: var(--space-1, 4px);">
                  <select id="sheet-role-${l(t.key)}" data-role="${l(t.key)}" class="ds-input ds-sheet-role-select" style="min-width: 180px;">
                    ${o.map(p=>`<option value="${l(p.name)}"${p.name===m?" selected":""}>${l(p.name)}</option>`).join("")}
                  </select>
                  <button type="button" class="ds-btn ds-btn--primary ds-sheet-role-save" data-role="${l(t.key)}">שמור</button>
                </div>
              </div>
            `}).join("")}
        </div>
      `;return v(`
      ${u("הגדרות מערכת",`${i.length} הגדרות`)}
      ${h({title:"מיפוי לשוניות גיליון",padded:!0,body:r})}
      ${h({title:"הגדרות",padded:!1,body:n})}
    `)},bind({root:s,api:a,rerender:e,clearScreenDataCache:i}){s.querySelectorAll(".ds-sheet-role-save").forEach(o=>{o.addEventListener("click",async()=>{const d=o.dataset.role,n=s.querySelector(`.ds-sheet-role-select[data-role="${CSS.escape(d)}"]`),r=n==null?void 0:n.value;if(!(!d||!r)){o.disabled=!0;try{await a.saveSheetMapping({role:d,sheet_name:r}),i==null||i(),c("הלשונית עודכנה בהצלחה"),e==null||e()}catch(t){c(t.message||"שגיאה בשמירה","error")}finally{o.disabled=!1}}})})}};export{f as adminSettingsScreen};
