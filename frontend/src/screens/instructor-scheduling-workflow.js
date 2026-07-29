import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { rankInstructors, deriveEducationLevel } from './instructor-matching-engine.js';
import { showToast } from './shared/toast.js';

const txt = value => String(value ?? '').trim();
function group(rows, key='emp_id') { return rows.reduce((out,row) => ((out[txt(row[key])] ||= []).push(row), out), {}); }
function card(candidate, topId) {
  const i=candidate.instructor; const reasons=candidate.eligible ? candidate.explanation : candidate.failures.join(' · ');
  return `<article class="ds-card" style="padding:14px;display:grid;gap:7px"><div style="display:flex;justify-content:space-between"><strong>${escapeHtml(i.full_name || i.emp_id)}</strong>${candidate.score == null ? '' : `<span class="ds-badge">ציון ${candidate.score}</span>`}</div><span class="ds-muted">מזהה: ${escapeHtml(i.emp_id)} · שפות: ${escapeHtml((candidate.profile?.instruction_languages || []).join(', ') || '—')}</span><p style="margin:0">${escapeHtml(reasons)}</p>${candidate.warnings.length ? `<p style="margin:0;color:#9a6700">⚠ ${escapeHtml(candidate.warnings.join(' · '))}</p>` : ''}${candidate.eligible ? `<button type="button" class="ds-btn ds-btn--primary" data-select-scheduling-candidate="${escapeHtml(i.emp_id)}" data-top="${i.emp_id === topId ? 'yes':'no'}">בחירה</button>` : ''}</article>`;
}
export function bindInstructorScheduling(root, { ui, state, onAssigned } = {}) {
  const button=root?.querySelector('[data-find-instructor]'); if (!button || button.dataset.bound) return; button.dataset.bound='yes';
  button.addEventListener('click', async () => {
    if (!['admin','operation_manager'].includes(txt(state?.user?.role))) return showToast('אין הרשאה לשמור שיבוץ','error');
    const form=button.closest('[data-drawer-form]'); const activity=JSON.parse(form?.dataset.exportRow || '{}');
    activity.instruction_language=form.querySelector('[name="instruction_language"]')?.value || activity.instruction_language || 'he';
    activity.required_instructor_gender=form.querySelector('[name="required_instructor_gender"]')?.value || activity.required_instructor_gender || 'any';
    activity.education_level=form.querySelector('[name="education_level"]')?.value || activity.education_level || deriveEducationLevel(activity.grade);
    button.disabled=true; button.textContent='מחשב התאמות…';
    try {
      const [contacts,profiles,rules,exceptions,activities]=await Promise.all([
        supabase.from('contacts_instructors').select('*'), supabase.from('instructor_scheduling_profiles').select('*'),
        supabase.from('instructor_availability_rules').select('*'), supabase.from('instructor_availability_exceptions').select('*'),
        supabase.from('activities').select('*').neq('row_id',txt(activity.row_id || activity.RowID))
      ]);
      const error=[contacts,profiles,rules,exceptions,activities].find(x=>x.error)?.error; if(error) throw error;
      const profileMap=Object.fromEntries(profiles.data.map(p=>[txt(p.emp_id),p]));
      const assignments={}; for(const a of activities.data) { const id=txt(a.emp_id); if(!id) continue; for(let n=1;n<=35;n++){const date=a[`date_${n}`];if(date)(assignments[id] ||= []).push({date,start_time:a.start_time,end_time:a.end_time,activity_name:a.activity_name,school:a.school,authority:a.authority});} }
      const results=rankInstructors({ instructors:contacts.data, profiles:profileMap, rules:group(rules.data), exceptions:group(exceptions.data), assignments, activity });
      [...results.recommended,...results.exceptions,...results.rejected].forEach(c=>{c.profile=profileMap[txt(c.instructor.emp_id)] || {};});
      const eligible=[...results.recommended,...results.exceptions]; const top=eligible[0];
      const section=(title,rows)=>`<section style="display:grid;gap:9px"><h3>${title} <span class="ds-badge">${rows.length}</span></h3>${rows.map(c=>card(c,txt(top?.instructor.emp_id))).join('') || '<p class="ds-muted">אין מועמדים בקבוצה זו.</p>'}</section>`;
      ui.openDrawer({title:'איתור ושיבוץ מדריך',content:`<div dir="rtl" style="display:grid;gap:16px"><header><h2>${escapeHtml(activity.activity_name || 'פעילות')}</h2><p>${escapeHtml(activity.school || '—')} · ${escapeHtml(activity.authority || '—')} · ${escapeHtml(activity.education_level || 'שכבה לא הוגדרה')} · ${activity.instruction_language==='ar'?'ערבית':'עברית'} · ${escapeHtml(activity.start_time || '')}–${escapeHtml(activity.end_time || '')}</p><strong>${eligible.length ? 'מוכן לשיבוץ' : 'אין מועמדים מתאימים'}</strong></header>${section('מומלצים',results.recommended)}${section('מתאימים עם חריגה',results.exceptions)}${section('לא מתאימים',results.rejected)}</div>`,onOpen:(drawer)=>{
        drawer.querySelectorAll('[data-select-scheduling-candidate]').forEach(select=>select.addEventListener('click',()=>{
          const candidate=eligible.find(c=>txt(c.instructor.emp_id)===select.dataset.selectSchedulingCandidate); const exception=candidate.warnings.length>0; const override=select.dataset.top!=='yes';
          ui.openModal({title:'אישור שיבוץ',content:`<div dir="rtl"><h3>${escapeHtml(candidate.instructor.full_name)}</h3><p>השיבוץ יחול על כל תאריכי המפגשים בשעות ${escapeHtml(activity.start_time||'')}–${escapeHtml(activity.end_time||'')}.</p>${candidate.warnings.length?`<p>חריגות: ${escapeHtml(candidate.warnings.join(' · '))}</p>`:''}<label>${override||exception?'סיבה (חובה)':'הערה'}<textarea class="ds-input" data-assignment-reason></textarea></label>${exception?'<label><input type="checkbox" data-approve-exception> אני מאשר/ת את החריגה</label>':''}<p data-assignment-error></p></div>`,actions:'<button class="ds-btn ds-btn--primary" data-confirm-assignment>אישור ושיבוץ</button><button class="ds-btn" data-save-assignment-draft>שמירה כטיוטה</button><button class="ds-btn" data-ui-close-modal>ביטול</button>'});
          const save=async(draft)=>{const modal=document.querySelector('.ds-modal__content');const reason=txt(modal.querySelector('[data-assignment-reason]')?.value);const err=modal.querySelector('[data-assignment-error]');if((override||exception)&&!reason){err.textContent='חובה להזין סיבה.';return;}if(exception&&!modal.querySelector('[data-approve-exception]')?.checked){err.textContent='חובה לאשר את החריגה.';return;}try{const decision=draft?'draft':exception?'exception_approved':override?'overridden':'approved';const {error}=await supabase.rpc('assign_activity_instructor',{p_activity_id:txt(activity.row_id||activity.RowID),p_emp_id:txt(candidate.instructor.emp_id),p_instructor_name:candidate.instructor.full_name,p_top_emp_id:txt(top?.instructor.emp_id)||null,p_selected_score:candidate.score,p_top_score:top?.score??null,p_decision_type:decision,p_reason:reason||null});if(error)throw error;ui.closeModal();ui.closeDrawer();showToast(draft?'טיוטת השיבוץ נשמרה':'המדריך שובץ בהצלחה','success');onAssigned?.();}catch(e){err.textContent=`השמירה נכשלה: ${e.message}`;}};
          document.querySelector('[data-confirm-assignment]')?.addEventListener('click',()=>save(false)); document.querySelector('[data-save-assignment-draft]')?.addEventListener('click',()=>save(true));
        }));
      }});
    } catch(e) { showToast(`חישוב ההתאמות נכשל: ${e.message}`,'error'); } finally { button.disabled=false;button.textContent='איתור ושיבוץ מדריך'; }
  });
}
