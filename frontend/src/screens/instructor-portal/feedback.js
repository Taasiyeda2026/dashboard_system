import { supabase, waitForSupabaseAuthSession } from '../../supabase-client.js';
import { escapeHtml } from '../shared/html.js';
import { dsPageHeader, dsScreenStack } from '../shared/layout.js';
import { copyText, openQrProjection } from '../../impact-feedback/feedback-share.js';
import { publicFeedbackUrl } from '../../impact-feedback/feedback-domain.js';
import './feedback.css';

const YEAR='school_2027';
const EMPTY={student:[],personal:[]};
const statusLabel={completed:'הושלם',draft:'בהמשך מילוי',pending:'ממתין למילוי'};
const stageLabel={pre:'פתיחת קורס',post:'סיום קורס',final:'סיום קורס',final_b:'סיום מחצית ב׳'};

export async function fetchInstructorPortalFeedback() {
  const session=await waitForSupabaseAuthSession();
  if (!session?.user?.id) throw new Error('יש להתחבר מחדש כדי לצפות במשובים');
  if (!supabase) throw new Error('מסד הנתונים אינו זמין');
  const {data,error}=await supabase.rpc('feedback_instructor_portal_items',{p_academic_year:YEAR});
  if(error) throw new Error(error.code==='42501'?'אין הרשאה להצגת משובים':error.message||'שגיאה בטעינת המשובים');
  return {student:Array.isArray(data?.student)?data.student:[],personal:Array.isArray(data?.personal)?data.personal:[]};
}

export function publicUrl(token) {
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(String(token||''))) return '';
  return publicFeedbackUrl(token,window.location.href);
}

function studentCard(item) {
  const stage=item.stage==='pre'?'משוב פתיחת קורס':'משוב סיום קורס';
  return `<article class="instructor-feedback-card" data-feedback-id="${escapeHtml(item.id)}">
    <h3>${stage}</h3>
    <dl>
      <div><dt>בית ספר</dt><dd>${escapeHtml(item.school||'—')}</dd></div>
      <div><dt>רשות</dt><dd>${escapeHtml(item.authority||'—')}</dd></div>
      <div><dt>כיתה</dt><dd>${escapeHtml([item.grade,item.class_group].filter(Boolean).join(' / ')||'—')}</dd></div>
      <div><dt>קורס</dt><dd>${escapeHtml(item.course||'—')}</dd></div>
    </dl>
    <div class="instructor-feedback-actions">
      <button type="button" class="ds-btn ds-btn--sm" data-feedback-copy="${escapeHtml(item.id)}">העתקת קישור</button>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-feedback-qr="${escapeHtml(item.id)}">הצגת QR</button>
    </div>
  </article>`;
}

function personalCard(item) {
  const label=item.stage==='pre'?'משוב פתיחה לאחר הכשרה':item.stage==='final_b'?'משוב סיום מחצית ב׳':'משוב סיום מחצית א׳';
  const complete=item.status==='completed';
  const link=publicUrl(item.token);
  return `<article class="instructor-feedback-card" data-feedback-id="${escapeHtml(item.id)}">
    <h3>${escapeHtml(label)}</h3>
    <p class="instructor-feedback-program">${escapeHtml(item.program_title||item.program_key||'')}</p>
    <p class="instructor-feedback-state">${escapeHtml(statusLabel[item.status]||'ממתין למילוי')}</p>
    ${complete?'<p class="instructor-feedback-done">המשוב הוגש והושלם.</p>':
      link?`<a class="ds-btn ds-btn--primary" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${item.status==='draft'?'המשך מילוי':'מילוי משוב'}</a>`:
      '<p>קישור השאלון עדיין אינו זמין.</p>'}
  </article>`;
}

export function instructorFeedbackContent(data=EMPTY) {
  const students=Array.isArray(data.student)?data.student:[];
  const personal=Array.isArray(data.personal)?data.personal:[];
  return `<section class="instructor-area instructor-feedback-page" dir="rtl">
    ${dsPageHeader('משובים','קישורים למשובי תלמידים והמשובים האישיים שלך')}
    <div class="instructor-feedback-tabs" role="tablist" aria-label="סוגי משובים">
      <button type="button" role="tab" aria-selected="true" data-feedback-tab="students">משובי תלמידים</button>
      <button type="button" role="tab" aria-selected="false" data-feedback-tab="mine">המשובים שלי</button>
      <button type="button" class="ds-btn ds-btn--sm" data-feedback-refresh>רענון</button>
    </div>
    <section data-feedback-panel="students" role="tabpanel">
      <p class="instructor-feedback-note">משובי התלמידים מוצגים רק לאחר שנפתחו עבורך. תשובות התלמידים אינן מוצגות.</p>
      <div class="instructor-feedback-grid">
      ${students.length?students.map(studentCard).join(''):'<p class="instructor-feedback-empty">אין משובי תלמידים זמינים כרגע.</p>'}
      </div>
    </section>
    <section data-feedback-panel="mine" role="tabpanel" hidden>
      <p class="instructor-feedback-note">לכל תוכנית ומחצית משוב אישי נפרד. התשובות נשמרות ב־Supabase ומאפשרות המשך ממכשיר אחר.</p>
      <div class="instructor-feedback-grid">
      ${personal.length?personal.map(personalCard).join(''):'<p class="instructor-feedback-empty">אין משובים אישיים זמינים כרגע.</p>'}
      </div>
    </section>
    <p class="instructor-feedback-error" role="alert" data-feedback-error hidden></p>
  </section>`;
}

export const instructorFeedbackScreen={
  load: async()=>fetchInstructorPortalFeedback(),
  render(data) { return dsScreenStack(instructorFeedbackContent(data)); },
  bind({root}) {
    let current=EMPTY;
    let running=false;
    let tab='students';
    const host=()=>root.querySelector('.instructor-feedback-page');
    const choose=(value)=>{
      tab=value;
      const section=host();
      section?.querySelectorAll('[data-feedback-tab]').forEach(el=>{
        el.setAttribute('aria-selected',String(el.dataset.feedbackTab===value));
      });
      section?.querySelectorAll('[data-feedback-panel]').forEach(el=>{
        el.hidden=el.dataset.feedbackPanel!==value;
      });
    };
    const refresh=async()=>{
      if(running||!root.isConnected) return;
      running=true;
      try{
        const result=await fetchInstructorPortalFeedback();
        if(!root.isConnected) return;
        current=result;
        const node=document.createElement('div');
        node.innerHTML=instructorFeedbackContent(result);
        host()?.replaceWith(node.firstElementChild);
        choose(tab);
      }catch(error){
        const node=host()?.querySelector('[data-feedback-error]');
        if(node){node.hidden=false;node.textContent=error?.message||'טעינת המשובים נכשלה';}
      }finally{running=false;}
    };
    // All clicks use delegation; refreshed HTML does not lose event handlers.
    root.addEventListener('click',async(event)=>{
      const t=event.target.closest('[data-feedback-tab],[data-feedback-copy],[data-feedback-qr],[data-feedback-refresh]');
      if(!t||!root.contains(t))return;
      if(t.dataset.feedbackTab){choose(t.dataset.feedbackTab);return;}
      if(t.hasAttribute('data-feedback-refresh')){await refresh();return;}
      const id=t.dataset.feedbackCopy||t.dataset.feedbackQr;
      const entry=(current.student||[]).find(item=>String(item.id)===String(id));
      if(!entry)return;
      const url=publicUrl(entry.token);
      if(!url)return;
      if(t.hasAttribute('data-feedback-copy')){
        const ok=await copyText(url);
        t.textContent=ok?'הקישור הועתק':'לא ניתן להעתיק';
      }else{
        await openQrProjection({audience:'student',stage:entry.stage,public_token:entry.token},{
          programTitle:entry.course,schoolName:entry.school,grade:entry.grade});
      }
    });
    const timer=setInterval(()=>{
      if(!root.isConnected){clearInterval(timer);return;}
      refresh();
    },60000);
    // populate the delegated click backing data (and revalidate time gates).
    refresh();
  }
};
