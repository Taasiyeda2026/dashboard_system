const COURSE_OPTIONS = [
  { key: 'biomimicry', label: 'ביומימיקרי', icon: '🦋' },
  { key: 'rokchim-olam', label: 'רוקחים עולם', icon: '🧪' },
  { key: 'ai', label: 'בינה מלאכותית', icon: '🤖' },
  { key: 'premium', label: 'פרימיום', icon: '⭐' }
];

const INVITATION_TYPES = [
  { key: 'lecture', label: 'הרצאה' },
  { key: 'tour', label: 'סיור' },
  { key: 'graduation', label: 'מפגש סיום קורס' }
];

const TEMPLATE_CONTENT = {
  'biomimicry:graduation': {
    title: 'הזמנה למפגש הסיום', subtitle: 'קורס ביומימיקרי – המצאות\nבהשראה מן הטבע',
    body1: 'לאורך התהליך יצאו התלמידים למסע חקר בעקבות הטבע: הם התבוננו בבעלי חיים, בצמחים ובתופעות טבע וגילו כיצד הטבע יכול לעורר השראה לפיתוח פתרונות טכנולוגיים חדשניים.',
    body2: 'במפגש ניחשף לרעיונות המקוריים של התלמידים ולדרך שבה סקרנות, יצירתיות, מדע וטכנולוגיה התחברו לחוויית למידה משמעותית בהשראת הטבע.',
    participants: 'הנהלת בית הספר | מחנכת הכיתה: ______\nהגב׳ יעל אביב, מנהלת תחום החינוך והפדגוגיה – תעשיידע\nהגב׳ הילה רוזן, אחראית הדרכה ומנחת הקבוצה – תעשיידע',
    closing: 'נשמח לראותכם!'
  }
};

const PRESET_BACKGROUNDS = {
  soft: 'radial-gradient(circle at 10% 18%, rgba(18,185,129,0.16), transparent 24%), radial-gradient(circle at 88% 16%, rgba(14,165,233,0.16), transparent 23%), radial-gradient(circle at 92% 82%, rgba(217,249,157,0.24), transparent 24%), linear-gradient(90deg, rgba(18,185,129,0.08) 0 9%, transparent 9% 91%, rgba(14,165,233,0.08) 91% 100%)',
  clean: 'linear-gradient(135deg, #fffdf6 0%, #f8fafc 70%, #eef2ff 100%)'
};

const getTemplate = (s) => TEMPLATE_CONTENT[`${s.course}:${s.type}`] || TEMPLATE_CONTENT['biomimicry:graduation'];

function ensureInvitationStyles() {
  if (document.getElementById('invitations-screen-style')) return;
  const style = document.createElement('style');
  style.id = 'invitations-screen-style';
  style.textContent = `
  .inv-shell{display:grid;grid-template-columns:310px 1fr;gap:28px;align-items:start;direction:rtl}
  .inv-panel{background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.75);border-radius:22px;box-shadow:0 18px 42px rgba(15,23,42,.16);padding:14px;height:calc(100vh - 56px);overflow-y:auto;position:sticky;top:28px}
  .inv-title{margin:0 0 8px;font-size:20px}.inv-field{display:grid;gap:4px;margin-bottom:8px}.inv-field input,.inv-field textarea,.inv-field select{border:1px solid #cbd5e1;border-radius:10px;padding:8px;font:inherit}
  .inv-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.inv-chip{border:1px solid #dbe5ef;background:#f8fafc;border-radius:12px;padding:10px;cursor:pointer}.inv-chip.active{background:#dcfce7;border-color:#86efac}
  .inv-btn{width:100%;border:0;border-radius:12px;padding:11px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#14b8a6,#22c7d9);color:#fff}
  .invitation-preview-viewport{overflow:auto;display:flex;justify-content:center;align-items:flex-start;max-height:calc(100vh - 32px);padding:12px;scroll-padding-top:12px}
  .invitation-preview-empty{width:min(760px,100%);min-height:360px;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px;border-radius:24px;border:1px solid rgba(203,213,225,.9);background:linear-gradient(145deg,rgba(255,255,255,.95),rgba(241,245,249,.92));box-shadow:0 18px 34px rgba(15,23,42,.08);color:#334155;font-size:20px;font-weight:700;line-height:1.6}
  .invitation-preview-wrapper{width:100%;display:flex;justify-content:center;align-items:flex-start}
  .invitation-preview-scale{width:794px;height:1123px;display:flex;justify-content:center;align-items:flex-start;transform:scale(var(--a4-scale,1));transform-origin:top center}
  .invitation-print-page{width:794px;min-height:1123px;padding:102px 76px 70px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background-color:#fffdf6;background-image:none;background-size:cover;background-position:center;box-shadow:0 18px 42px rgba(15,23,42,.16)}
  .inv-print-modal{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.56);display:flex;align-items:center;justify-content:center;padding:20px}
  .inv-print-modal[hidden]{display:none}
  .inv-print-dialog{width:min(980px,96vw);max-height:94vh;overflow:auto;border-radius:20px;background:#fff;border:1px solid #dbe5ef;box-shadow:0 20px 48px rgba(2,6,23,.35);padding:16px;display:grid;gap:12px}
  .inv-print-actions{display:flex;justify-content:flex-start;gap:8px;position:sticky;top:0;background:#fff;padding-bottom:6px;z-index:2}
  .inv-print-preview{display:flex;justify-content:center;overflow:auto;padding:8px}
  .inv-print-preview .invitation-print-page{box-shadow:0 10px 24px rgba(2,6,23,.2)}
  .page-ribbon{position:absolute;top:0;bottom:0;width:66px;z-index:1;opacity:.92}.page-ribbon.right{right:0;background:radial-gradient(circle at 50% 14%, rgba(255,255,255,0.92) 0 6px, transparent 7px),radial-gradient(circle at 45% 31%, rgba(18,185,129,0.42), transparent 26px),radial-gradient(circle at 60% 60%, rgba(14,165,233,0.28), transparent 30px),linear-gradient(180deg, rgba(18,185,129,0.4), rgba(14,165,233,0.18))}.page-ribbon.left{left:0;background:radial-gradient(circle at 50% 80%, rgba(255,255,255,0.9) 0 7px, transparent 8px),radial-gradient(circle at 50% 22%, rgba(14,165,233,0.35), transparent 28px),radial-gradient(circle at 56% 58%, rgba(217,249,157,0.45), transparent 28px),linear-gradient(180deg, rgba(14,165,233,0.22), rgba(18,185,129,0.34))}
  .decor-bubble{position:absolute;border-radius:999px;border:1px solid rgba(255,255,255,0.68);background:rgba(255,255,255,0.42);box-shadow:0 10px 24px rgba(15,23,42,0.08);z-index:1}.bubble-1{width:118px;height:118px;top:62px;right:64px}.bubble-2{width:88px;height:88px;bottom:86px;left:78px}.bubble-3{width:54px;height:54px;top:170px;left:92px}
  .logos-header{position:absolute;top:24px;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:18px;padding:8px 20px;border-radius:999px;background:rgba(255,255,255,0.76);border:1px solid rgba(255,255,255,0.72)}
  .logo-slot{width:118px;height:42px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(248,250,252,0.72);border:1px dashed rgba(148,163,184,0.5);overflow:hidden;color:#94a3b8;font-size:11px;font-weight:800}.logo-slot img{display:none;width:100%;height:100%;object-fit:contain}.logo-slot.has-logo img{display:block}.logo-slot.has-logo span{display:none}
  .content-area{text-align:center;display:flex;flex-direction:column;align-items:center;gap:13px;z-index:2;width:100%;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.82);border-radius:34px;padding:46px 46px 40px}
  .invite-title{font-size:52px;font-weight:800;line-height:1.05;margin:0}.invite-subtitle{font-size:28px;font-weight:800;color:#0f766e;line-height:1.18;margin:0}
  .school-year-title{padding:5px 18px;border-radius:999px;background:rgba(20,184,166,.1);font-size:22px;font-weight:800}.school-info{font-size:19px}.main-text{font-size:20px;line-height:1.62}
  .event-details{background:linear-gradient(135deg, rgba(255,255,255,0.96), rgba(240,249,255,0.92));padding:13px 22px;border-radius:18px;border:2px solid rgba(20,184,166,.18);font-size:20px;line-height:1.55}
  .participants{width:100%;font-size:16.5px;line-height:1.82;text-align:right;background:rgba(248,250,252,0.72);border:1px solid rgba(226,232,240,0.88);border-radius:18px;padding:14px 18px}
  .closing-text{color:#058669;margin-top:8px;font-size:34px;font-weight:800}
  @media (max-width:1200px){.inv-shell{grid-template-columns:1fr}.inv-panel{position:static;height:auto}.invitation-preview-viewport{max-height:none}}
  @media print{
    @page{size:A4 portrait;margin:0}
    html,body{width:210mm!important;height:297mm!important;margin:0!important;padding:0!important;overflow:hidden!important;background:white!important}
    body.printing-invitation *{visibility:hidden!important}
    body.printing-invitation #print-root,body.printing-invitation #print-root *{visibility:visible!important}
    #print-root{position:fixed!important;inset:0!important;display:flex!important;align-items:flex-start!important;justify-content:center!important;overflow:hidden!important;background:white!important;z-index:2147483647!important}
    #print-root .invitation-print-page{
      position:fixed!important;
      top:0!important;
      right:0!important;
      left:auto!important;
      width:210mm!important;
      height:297mm!important;
      min-height:297mm!important;
      margin:0!important;
      padding:26mm 18mm 18mm!important;
      transform:none!important;
      scale:none!important;
      box-shadow:none!important;
      overflow:hidden!important;
      page-break-before:avoid!important;
      page-break-after:avoid!important;
      page-break-inside:avoid!important;
      break-before:avoid!important;
      break-after:avoid!important;
      break-inside:avoid!important;
      -webkit-print-color-adjust:exact!important;
      print-color-adjust:exact!important
    }
    #print-root .invitation-preview-viewport,#print-root .invitation-preview-scale,#print-root .invitation-preview-wrapper{
      transform:none!important;
      scale:none!important;
      overflow:visible!important
    }
  }
  `;
  document.head.appendChild(style);
}

function invitationEmptyStateHtml() {
  return `<div class="invitation-preview-empty">כדי להתחיל ליצור הזמנה, בחרו קורס וסוג הזמנה מהחלונית בצד.</div>`;
}

function invitationPreviewHtml(s) {
  const t = getTemplate(s);
  return `<div class="invitation-preview-wrapper"><div class="invitation-preview-scale"><div class="invitation-print-page ${s.hasBackground ? 'has-background' : ''}" id="invitation-page" style="background-image:${s.backgroundCss};">
    <div class="page-ribbon right"></div><div class="page-ribbon left"></div>
    <div class="decor-bubble bubble-1"></div><div class="decor-bubble bubble-2"></div><div class="decor-bubble bubble-3"></div>
    <header class="logos-header">
      ${['education', 'taasiyeda', 'school'].map((k) => `<div class="logo-slot ${s.logos[k] ? 'has-logo' : ''}"><span>${k === 'education' ? 'משרד החינוך' : k === 'taasiyeda' ? 'תעשיידע' : 'בית הספר'}</span><img src="${s.logos[k] || ''}"/></div>`).join('')}
    </header>
    <div class="content-area"><h1 class="invite-title">${s.title || t.title}</h1><h2 class="invite-subtitle">${(s.subtitle || t.subtitle).replace(/\n/g, '<br>')}</h2>
    <div class="school-year-title">${s.schoolYear || 'תשפ״ו'}</div><p class="school-info">תלמידי כיתה ${s.className || '______'} | בית ספר ${s.school || '______'}</p>
    <div class="main-text"><p>${s.body1 || t.body1}</p><p>${s.body2 || t.body2}</p></div>
    <div class="event-details"><strong>יום:</strong> ${s.day || '______'} | <strong>תאריך:</strong> ${s.date || '______'} | <strong>שעה:</strong> ${s.time || '______'}<br><strong>מיקום:</strong> ${s.location || '______'}</div>
    <p class="participants"><strong>בהשתתפות:</strong><br>${(s.participants || t.participants).replace(/\n/g, '<br>')}</p>
    <div class="closing-text">${s.closing || t.closing}</div></div></div></div></div>`;
}

export const invitationsScreen = { load: async () => ({}), render() { ensureInvitationStyles(); const s = { course: '', type: '', school: '', className: '', title: '', subtitle: '', schoolYear: '', day: '', date: '', time: '', location: '', body1: '', body2: '', participants: '', closing: '', backgroundCss: PRESET_BACKGROUNDS.soft, hasBackground: false, logos: { education: '', taasiyeda: '', school: '' } }; return `<section class="inv-shell" data-invitations-root><aside class="inv-panel"><h2 class="inv-title">מחולל הזמנות</h2><div class="inv-grid">${COURSE_OPTIONS.map((c) => `<button type="button" class="inv-chip ${s.course === c.key ? 'active' : ''}" data-course="${c.key}">${c.icon} ${c.label}</button>`).join('')}</div><div class="inv-grid" style="grid-template-columns:1fr">${INVITATION_TYPES.map((t) => `<button type="button" class="inv-chip ${s.type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}</div>${[['schoolYear','שנת לימודים'],['className','כיתה'],['school','בית ספר'],['title','כותרת'],['subtitle','כותרת משנה'],['day','יום'],['date','תאריך'],['time','שעה'],['location','מיקום'],['body1','פסקה 1'],['body2','פסקה 2'],['participants','משתתפים'],['closing','סיום']].map(([k,l])=>`<label class="inv-field"><span>${l}</span>${['subtitle','participants','body1','body2'].includes(k)?`<textarea data-field="${k}"></textarea>`:`<input data-field="${k}"/>`}</label>`).join('')}<label class="inv-field"><span>רקע מובנה</span><select data-background-preset><option value="soft">רקע עדין</option><option value="clean">רקע בהיר</option></select></label><label class="inv-field"><span>העלאת תמונת רקע</span><input type="file" accept="image/*" data-background-upload /></label>${['education','taasiyeda','school'].map((k)=>`<label class="inv-field"><span>לוגו ${k}</span><input type="file" accept="image/*" data-logo-upload="${k}"/></label>`).join('')}<button type="button" class="inv-btn" data-print>הפק / שמור כ-PDF</button></aside><main class="invitation-preview-viewport" data-inv-preview>${invitationEmptyStateHtml()}</main></section>`; },
  bind({ root }) { const host = root?.querySelector('[data-invitations-root]'); if (!host) return; const state = { course: '', type: '', school: '', className: '', title: '', subtitle: '', schoolYear: '', day: '', date: '', time: '', location: '', body1: '', body2: '', participants: '', closing: '', backgroundCss: PRESET_BACKGROUNDS.soft, hasBackground: false, logos: { education: '', taasiyeda: '', school: '' } }; const repaint = () => { host.querySelectorAll('[data-course]').forEach((el) => el.classList.toggle('active', el.dataset.course === state.course)); host.querySelectorAll('[data-type]').forEach((el) => el.classList.toggle('active', el.dataset.type === state.type)); const p = host.querySelector('[data-inv-preview]'); const canPreview = Boolean(state.course && state.type); if (p) p.innerHTML = canPreview ? invitationPreviewHtml(state) : invitationEmptyStateHtml(); const wrap = p?.querySelector('.invitation-preview-scale'); const availWidth = p?.clientWidth || 980; const availHeight = p?.clientHeight || 1200; if (wrap) { const widthScale = (availWidth - 24) / 794; const heightScale = (availHeight - 24) / 1123; const nextScale = Math.max(0.78, Math.min(1, widthScale, heightScale)); wrap.style.setProperty('--a4-scale', String(nextScale)); wrap.style.width = '794px'; wrap.style.height = '1123px'; } if (p) p.scrollTop = 0; };
    host.querySelectorAll('[data-course]').forEach((el) => el.addEventListener('click', () => { state.course = el.dataset.course || state.course; repaint(); })); host.querySelectorAll('[data-type]').forEach((el) => el.addEventListener('click', () => { state.type = el.dataset.type || state.type; repaint(); })); host.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', (e) => { const f = e.target?.dataset?.field; if (!f) return; state[f] = e.target.value || ''; repaint(); }));
    host.querySelector('[data-background-preset]')?.addEventListener('change', (e) => { state.backgroundCss = PRESET_BACKGROUNDS[e.target.value] || PRESET_BACKGROUNDS.soft; state.hasBackground = true; repaint(); });
    host.querySelector('[data-background-upload]')?.addEventListener('change', (e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { state.backgroundCss = `url('${r.result}')`; state.hasBackground = true; repaint(); }; r.readAsDataURL(file); });
    host.querySelectorAll('[data-logo-upload]').forEach((i) => i.addEventListener('change', (e) => { const k = e.target.dataset.logoUpload; const f = e.target.files?.[0]; if (!k || !f) return; const r = new FileReader(); r.onload = () => { state.logos[k] = String(r.result || ''); repaint(); }; r.readAsDataURL(f); }));
    const ensurePrintRoot = () => {
      let printRoot = document.getElementById('print-root');
      if (!printRoot) {
        printRoot = document.createElement('div');
        printRoot.id = 'print-root';
        document.body.appendChild(printRoot);
      }
      return printRoot;
    };
    ensurePrintRoot();
    const cleanupPrintRoot = () => {
      const printRoot = document.getElementById('print-root');
      if (printRoot) printRoot.innerHTML = '';
      document.body.classList.remove('printing-invitation');
    };
    const ensurePrintModal = () => {
      let modal = document.getElementById('inv-print-modal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'inv-print-modal';
      modal.className = 'inv-print-modal';
      modal.hidden = true;
      modal.innerHTML = `<div class="inv-print-dialog" role="dialog" aria-modal="true" aria-label="תצוגה מוקדמת להדפסה">
        <div class="inv-print-actions">
          <button type="button" class="inv-btn" data-modal-print>הדפס / שמור כ־PDF</button>
          <button type="button" class="inv-btn" data-modal-close>סגירה</button>
        </div>
        <div class="inv-print-preview" data-modal-preview></div>
      </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target?.closest('[data-modal-close]')) modal.hidden = true;
      });
      modal.querySelector('[data-modal-print]')?.addEventListener('click', () => {
        const previewPage = modal.querySelector('[data-modal-preview] .invitation-print-page');
        if (!previewPage) return;
        const printRoot = ensurePrintRoot();
        printRoot.innerHTML = '';
        const clonedPage = previewPage.cloneNode(true);
        clonedPage.removeAttribute('id');
        clonedPage.style.transform = 'none';
        clonedPage.style.scale = 'none';
        printRoot.appendChild(clonedPage);
        document.body.classList.add('printing-invitation');
        window.print();
      });
      return modal;
    };
    host.querySelector('[data-print]')?.addEventListener('click', () => {
      if (!state.course || !state.type) return;
      const sourcePage = host.querySelector('.invitation-print-page');
      if (!sourcePage) return;
      const modal = ensurePrintModal();
      const previewTarget = modal.querySelector('[data-modal-preview]');
      if (!previewTarget) return;
      previewTarget.innerHTML = '';
      const clonedPage = sourcePage.cloneNode(true);
      clonedPage.removeAttribute('id');
      clonedPage.style.transform = 'none';
      clonedPage.style.scale = 'none';
      previewTarget.appendChild(clonedPage);
      modal.hidden = false;
    });
    window.addEventListener('afterprint', cleanupPrintRoot);
    window.addEventListener('resize', repaint);
    repaint();
  }
};
