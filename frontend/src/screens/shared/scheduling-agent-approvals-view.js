export const escapeAgentHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function agentRequestHtml(request,now=Date.now()){
 const e=escapeAgentHtml,p=request.preview||{},option=p.option||{};
 const expired=new Date(request.expires_at).getTime()<=now,canApprove=request.state==='pending'&&!expired;
 const dates=option.meetings||[];
 return `<article><h2>${e(p.school)} · ${e(p.program)}</h2><dl><dt>רשות</dt><dd>${e(p.authority)}</dd><dt>מדריך מוצע</dt><dd>${e(option.instructorName||option.instructorEmpId)}</dd><dt>מצב</dt><dd>${e(request.state)}${expired?' · פג תוקף':''}</dd><dt>מספר מפגשים</dt><dd>${dates.length}</dd><dt>תוקף הבקשה</dt><dd>${e(request.expires_at)}</dd></dl><details><summary>כל המפגשים המוצעים</summary><ol>${dates.map(m=>`<li>${e(m.date)} · ${e(m.start_time)}–${e(m.end_time)}</li>`).join('')}</ol></details><p>מזהה קורס: <bdi>${e(p.activityId)}</bdi></p><label><input type="checkbox" data-reviewed="${e(request.id)}" ${canApprove?'':'disabled'}> בדקתי את המדריך ואת כל המועדים המוצגים</label><p><button data-approve="${e(request.id)}" disabled>מאשר את השינוי המוצג</button></p></article>`;
}
