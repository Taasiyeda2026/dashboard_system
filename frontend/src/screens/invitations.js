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
    title: 'הזמנה למפגש הסיום',
    subtitle: 'קורס ביומימיקרי – המצאות\nבהשראה מן הטבע',
    body1: 'לאורך התהליך יצאו התלמידים למסע חקר בעקבות הטבע: הם התבוננו בבעלי חיים, בצמחים ובתופעות טבע וגילו כיצד הטבע יכול לעורר השראה לפיתוח פתרונות טכנולוגיים חדשניים.',
    body2: 'במפגש ניחשף לרעיונות המקוריים של התלמידים ולדרך שבה סקרנות, יצירתיות, מדע וטכנולוגיה התחברו לחוויית למידה משמעותית בהשראת הטבע.',
    closing: 'נשמח לראותכם!',
    participants: 'הנהלת בית הספר ומחנכת הכיתה: ______\nהגב׳ יעל אביב, מנהלת תחום החינוך והפדגוגיה – תעשיידע\nהגב׳ הילה רוזן, אחראית הדרכה ומנחת הקבוצה – תעשיידע'
  },
  'rokchim-olam:tour': {
    title: 'הזמנה לסיור לימודי',
    subtitle: 'במסגרת קורס “רוקחים עולם”',
    body1: 'הצטרפו אלינו לסיור לימודי בחברת פארמה, כחלק מתהליך הלמידה בקורס “רוקחים עולם”.',
    body2: 'במהלך הסיור ייחשפו התלמידים לעולם הפרמצבטיקה, לתהליכי פיתוח וייצור בתעשיית התרופות, ולדרך שבה מדע, חדשנות וטכנולוגיה משתלבים בעולם הבריאות.'
  },
  'rokchim-olam:lecture': {
    title: 'הזמנה להרצאה',
    subtitle: 'במסגרת קורס “רוקחים עולם”',
    body1: 'אנו מזמינים את התלמידים להרצאה מיוחדת במסגרת קורס “רוקחים עולם”, שתפתח צוהר לעולם הפרמצבטיקה, המחקר והחדשנות בתעשיית הבריאות.',
    body2: 'במהלך ההרצאה ייחשפו התלמידים לתהליכים, אתגרים ורעיונות מעולם התרופות, ויבינו כיצד ידע מדעי הופך לפתרונות המשפיעים על חיי היום־יום.'
  }
};

const getTemplate = (s) => TEMPLATE_CONTENT[`${s.course}:${s.type}`] || {};

const PRESET_BACKGROUNDS = {
  soft: 'radial-gradient(circle at 10% 18%, rgba(18,185,129,0.16), transparent 24%), radial-gradient(circle at 88% 16%, rgba(14,165,233,0.16), transparent 23%), radial-gradient(circle at 92% 82%, rgba(217,249,157,0.24), transparent 24%), linear-gradient(90deg, rgba(18,185,129,0.08) 0 9%, transparent 9% 91%, rgba(14,165,233,0.08) 91% 100%)',
  clean: 'linear-gradient(135deg, #fffdf6 0%, #f8fafc 70%, #eef2ff 100%)',
  aqua: 'radial-gradient(circle at 18% 18%, rgba(34,211,238,0.22), transparent 28%), radial-gradient(circle at 82% 78%, rgba(16,185,129,0.2), transparent 30%), #f8fafc'
};

function ensureInvitationStyles() {
  if (document.getElementById('invitations-screen-style')) return;
  const style = document.createElement('style');
  style.id = 'invitations-screen-style';
  style.textContent = `
    .inv-shell{display:grid;grid-template-columns:300px 1fr;gap:22px;align-items:start;direction:rtl}
    .inv-panel{background:rgba(255,255,255,.96);border:1px solid #dbe5ef;border-radius:20px;padding:14px;box-shadow:0 12px 26px rgba(15,23,42,.08);position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto}
    .inv-title{margin:0 0 6px;font-size:20px}.inv-muted{color:#64748b;margin:0 0 10px;font-size:13px}
    .inv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px}
    .inv-chip{border:1px solid #dbe5ef;background:#f8fafc;border-radius:10px;padding:8px;cursor:pointer;font-weight:700;font-size:13px}
    .inv-chip.active{border-color:#14b8a6;background:#ecfeff}
    .inv-field{display:grid;gap:3px;margin-bottom:7px}.inv-field input,.inv-field textarea,.inv-field select{border:1px solid #cbd5e1;border-radius:8px;padding:7px;font:inherit;font-size:13px}
    .inv-field textarea{min-height:54px;resize:vertical}
    .inv-actions{display:grid;gap:8px;margin-top:10px}.inv-btn{border:0;border-radius:10px;padding:10px;font-weight:800;cursor:pointer}
    .inv-btn.print{background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#fff}
    .inv-preview-wrap{display:flex;justify-content:center;align-items:flex-start;overflow:auto;max-height:calc(100vh - 32px);padding:14px}
    .inv-a4-stage{display:flex;justify-content:center;align-items:flex-start;min-width:100%}
    .inv-a4{width:794px;min-height:1123px;background:#fffdf6;position:relative;box-shadow:0 18px 48px rgba(2,8,23,.24);padding:102px 76px 70px;overflow:hidden;display:flex;justify-content:center;align-items:center;transform-origin:top center}
    .inv-ribbon{position:absolute;top:0;bottom:0;width:66px;opacity:.92;pointer-events:none}.inv-ribbon.right{right:0;background:radial-gradient(circle at 50% 14%, rgba(255,255,255,.92) 0 6px, transparent 7px),radial-gradient(circle at 45% 31%, rgba(18,185,129,.42), transparent 26px),linear-gradient(180deg, rgba(18,185,129,.4), rgba(14,165,233,.18))}.inv-ribbon.left{left:0;background:radial-gradient(circle at 50% 80%, rgba(255,255,255,.9) 0 7px, transparent 8px),radial-gradient(circle at 50% 22%, rgba(14,165,233,.35), transparent 28px),linear-gradient(180deg, rgba(14,165,233,.22), rgba(18,185,129,.34))}
    .inv-logos{position:absolute;top:24px;left:50%;transform:translateX(-50%);display:flex;gap:18px;padding:8px 20px;background:rgba(255,255,255,.76);border-radius:999px;border:1px solid rgba(255,255,255,.72);z-index:3}
    .inv-logo-slot{width:118px;height:42px;border-radius:12px;background:rgba(248,250,252,.72);border:1px dashed rgba(148,163,184,.5);display:flex;align-items:center;justify-content:center;overflow:hidden;color:#94a3b8;font-size:11px;font-weight:800}.inv-logo-slot img{display:none;width:100%;height:100%;object-fit:contain}.inv-logo-slot.has-logo img{display:block}.inv-logo-slot.has-logo span{display:none}
    .inv-content{width:100%;text-align:center;background:rgba(255,255,255,.86);border-radius:34px;padding:46px 46px 40px;border:1px solid rgba(255,255,255,.82);z-index:2}
    .inv-badge{display:inline-flex;padding:8px 18px;border-radius:999px;background:linear-gradient(135deg, rgba(18,185,129,.12), rgba(14,165,233,.12));color:#06775f;font-size:14px;font-weight:800}
    .inv-head{font-size:52px;font-weight:800;line-height:1.05;margin:10px 0;color:#102033}.inv-sub{font-size:27px;font-weight:800;color:#0f766e;line-height:1.2}
    .inv-year{display:inline-flex;padding:5px 18px;border-radius:999px;background:rgba(20,184,166,.1);color:#058669;font-size:22px;font-weight:800;margin-top:8px}
    .inv-school{font-size:19px;margin:6px 0 10px;padding:6px 16px;border-radius:999px;background:rgba(248,250,252,.92);border:1px solid rgba(226,232,240,.88)}
    .inv-body{font-size:22px;line-height:1.7;text-align:right;margin:12px 0}.inv-body p{margin:0 0 8px}.inv-event{background:linear-gradient(135deg, rgba(255,255,255,.96), rgba(240,249,255,.92));padding:13px 22px;border-radius:18px;border:2px solid rgba(20,184,166,.18);font-size:20px;line-height:1.6;margin:12px 0}
    .inv-participants{width:100%;text-align:right;background:rgba(248,250,252,.72);border:1px solid rgba(226,232,240,.88);border-radius:18px;padding:14px 18px;font-size:16px;line-height:1.8}
    .inv-closing{font-size:34px;color:#058669;font-weight:800;margin-top:12px}
    @media print{@page{size:A4 portrait;margin:0} .inv-panel{display:none !important}.inv-shell{display:block}.inv-preview-wrap{overflow:visible !important;max-height:none !important;padding:0 !important}.inv-a4-stage{min-width:0 !important}.inv-a4{width:210mm;height:297mm;min-height:0;margin:0;box-shadow:none;padding:28mm 20mm 18mm;transform:none !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    @media (max-width:1380px){.inv-a4{transform:scale(.82)}}
    @media (max-width:1200px){.inv-shell{grid-template-columns:1fr}.inv-panel{position:static;max-height:none}.inv-preview-wrap{max-height:none}.inv-a4{transform:scale(.76)}}
  `;
  document.head.appendChild(style);
}

const typeLabel = (s) => INVITATION_TYPES.find((t) => t.key === s.type)?.label || '';
const courseLabel = (s) => COURSE_OPTIONS.find((c) => c.key === s.course)?.label || '';
const showHostField = (s) => s.type === 'tour' || s.type === 'lecture';
const showSpeakerField = (s) => s.type === 'lecture';

function invitationPreviewHtml(s) {
  const tpl = getTemplate(s);
  return `<div class="inv-a4-stage"><article class="inv-a4" id="invitation-page" style="background:${s.backgroundCss};background-size:cover;background-position:center;">
      <div class="inv-ribbon right"></div><div class="inv-ribbon left"></div>
      <header class="inv-logos">
        ${['education','taasiyeda','school'].map((k) => `<div class="inv-logo-slot ${s.logos[k] ? 'has-logo' : ''}"><span>${k === 'education' ? 'משרד החינוך' : k === 'taasiyeda' ? 'תעשיידע' : 'בית הספר'}</span>${s.logos[k] ? `<img src="${s.logos[k]}" alt="${k}"/>` : '<img alt=""/>'}</div>`).join('')}
      </header>
      <section class="inv-content">
        <div class="inv-badge">${typeLabel(s)} · ${courseLabel(s)}</div>
        <h1 class="inv-head">${s.title || tpl.title || 'הזמנה'}</h1>
        <div class="inv-sub">${(s.subtitle || tpl.subtitle || '').replace(/\n/g, '<br>')}</div>
        <div class="inv-year">${s.schoolYear || 'שנת לימודים'}</div>
        <div class="inv-school">${s.className || 'כיתה / קהל יעד'} · ${s.school || 'בית ספר'}</div>
        <div class="inv-body"><p>${s.body1 || tpl.body1 || ''}</p><p>${s.body2 || tpl.body2 || ''}</p></div>
        <div class="inv-event"><strong>יום:</strong> ${s.day || '______'} | <strong>תאריך:</strong> ${s.date || '______'} | <strong>שעה:</strong> ${s.time || '______'}<br><strong>מיקום:</strong> ${s.location || '______'}</div>
        <div class="inv-participants"><strong>בהשתתפות:</strong><br>${(s.participants || tpl.participants || 'משתתפים / נציגים').replace(/\n/g, '<br>')}</div>
        <div class="inv-closing">${s.closing || tpl.closing || 'נשמח לראותכם!'}</div>
      </section>
    </article></div>`;
}

export const invitationsScreen = {
  async load() { return {}; },
  render() {
    ensureInvitationStyles();
    const formState = {
      course: COURSE_OPTIONS[0].key, type: INVITATION_TYPES[0].key,
      school: '', className: '', host: '', speaker: '', title: '', subtitle: '', schoolYear: '',
      day: '', date: '', time: '', location: '', body1: '', body2: '', participants: '', closing: '',
      backgroundCss: PRESET_BACKGROUNDS.soft, logos: { education: '', taasiyeda: '', school: '' }
    };
    return `<section class="inv-shell" data-invitations-root>
      <aside class="inv-panel">
        <h2 class="inv-title">מחולל הזמנות</h2><p class="inv-muted">טופס קומפקטי + תצוגת A4 מלאה.</p>
        <div class="inv-grid">${COURSE_OPTIONS.map((c) => `<button type="button" class="inv-chip ${formState.course === c.key ? 'active' : ''}" data-course="${c.key}">${c.icon} ${c.label}</button>`).join('')}</div>
        <div class="inv-grid" style="grid-template-columns:1fr;">${INVITATION_TYPES.map((t) => `<button type="button" class="inv-chip ${formState.type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}</div>
        ${[['schoolYear','שנת לימודים'],['className','כיתה / קהל יעד'],['school','בית ספר'],['title','כותרת אירוע'],['day','יום'],['date','תאריך'],['time','שעה'],['location','מיקום'],['participants','משתתפים / נציגים'],['closing','משפט סיום']].map(([k,l])=>`<label class=\"inv-field\"><span>${l}</span>${k==='participants'?`<textarea data-field=\"${k}\">${formState[k] || ''}</textarea>`:`<input data-field=\"${k}\" value=\"${formState[k] || ''}\"/>`}</label>`).join('')}
        <div data-host-field class="inv-field" style="display:none"><span>חברה מארחת</span><input data-field="host" value=""/></div>
        <div data-speaker-field class="inv-field" style="display:none"><span>שם מרצה / אורח</span><input data-field="speaker" value=""/></div>
        <label class="inv-field"><span>רקע מובנה</span><select data-background-preset><option value="soft">רקע עדין</option><option value="clean">רקע בהיר</option><option value="aqua">רקע טורקיז</option></select></label>
        <label class="inv-field"><span>העלאת תמונת רקע</span><input type="file" accept="image/*" data-background-upload /></label>
        ${['education','taasiyeda','school'].map((k)=>`<label class="inv-field"><span>לוגו ${k === 'education' ? 'משרד החינוך' : k === 'taasiyeda' ? 'תעשיידע' : 'בית ספר'}</span><input type="file" accept="image/*" data-logo-upload="${k}" /></label>`).join('')}
        <div class="inv-actions"><button type="button" class="inv-btn print" data-print>הפק / הדפס / שמור כ־PDF</button></div>
      </aside>
      <div class="inv-preview-wrap" data-inv-preview>${invitationPreviewHtml(formState)}</div>
    </section>`;
  },
  bind({ root }) {
    const host = root?.querySelector('[data-invitations-root]'); if (!host) return;
    const formState = { course: COURSE_OPTIONS[0].key, type: INVITATION_TYPES[0].key, school: '', className: '', host: '', speaker: '', title: '', subtitle: '', schoolYear: '', day: '', date: '', time: '', location: '', body1: '', body2: '', participants: '', closing: '', backgroundCss: PRESET_BACKGROUNDS.soft, logos: { education: '', taasiyeda: '', school: '' } };
    const repaint = () => {
      host.querySelectorAll('[data-course]').forEach((el) => el.classList.toggle('active', el.dataset.course === formState.course));
      host.querySelectorAll('[data-type]').forEach((el) => el.classList.toggle('active', el.dataset.type === formState.type));
      const p = host.querySelector('[data-inv-preview]'); if (p) p.innerHTML = invitationPreviewHtml(formState);
      const h=host.querySelector('[data-host-field]'); if (h) h.style.display = showHostField(formState) ? '' : 'none';
      const sp=host.querySelector('[data-speaker-field]'); if (sp) sp.style.display = showSpeakerField(formState) ? '' : 'none';
    };
    host.querySelectorAll('[data-course]').forEach((el) => el.addEventListener('click', () => { formState.course = el.dataset.course || formState.course; repaint(); }));
    host.querySelectorAll('[data-type]').forEach((el) => el.addEventListener('click', () => { formState.type = el.dataset.type || formState.type; repaint(); }));
    host.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', (e) => { const f = e.target?.dataset?.field; if (!f) return; formState[f] = e.target.value || ''; repaint(); }));
    host.querySelector('[data-background-preset]')?.addEventListener('change', (e) => { formState.backgroundCss = PRESET_BACKGROUNDS[e.target.value] || PRESET_BACKGROUNDS.soft; repaint(); });
    host.querySelector('[data-background-upload]')?.addEventListener('change', (e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { formState.backgroundCss = `url('${r.result}')`; repaint(); }; r.readAsDataURL(file); });
    host.querySelectorAll('[data-logo-upload]').forEach((input) => input.addEventListener('change', (e) => { const key = e.target.dataset.logoUpload; const file = e.target.files?.[0]; if (!key || !file) return; const r = new FileReader(); r.onload = () => { formState.logos[key] = String(r.result || ''); repaint(); }; r.readAsDataURL(file); }));
    host.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  }
};
