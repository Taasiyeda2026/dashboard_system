const COURSE_OPTIONS = [
  { key: 'english', label: 'אנגלית', icon: '📘' },
  { key: 'computers', label: 'מחשבים', icon: '💻' },
  { key: 'hebrew', label: 'עברית', icon: '📝' },
  { key: 'employability', label: 'כישורי תעסוקה', icon: '🧩' }
];

const INVITATION_TYPES = [
  { key: 'lecture', label: 'הרצאה' },
  { key: 'tour', label: 'סיור' },
  { key: 'graduation', label: 'מפגש סיום קורס' }
];

function ensureInvitationStyles() {
  if (document.getElementById('invitations-screen-style')) return;
  const style = document.createElement('style');
  style.id = 'invitations-screen-style';
  style.textContent = `
    .inv-shell{display:grid;grid-template-columns:320px 1fr;gap:20px;align-items:start;direction:rtl}
    .inv-panel{background:#fff;border:1px solid #dbe5ef;border-radius:18px;padding:16px;box-shadow:0 10px 26px rgba(15,23,42,.08)}
    .inv-title{margin:0 0 8px;font-size:24px}.inv-muted{color:#64748b;margin:0 0 14px}
    .inv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
    .inv-chip{border:1px solid #dbe5ef;background:#f8fafc;border-radius:12px;padding:10px;cursor:pointer;font-weight:700}
    .inv-chip.active{border-color:#14b8a6;background:#ecfeff}
    .inv-field{display:grid;gap:4px;margin-bottom:10px}.inv-field input,.inv-field textarea,.inv-field select{border:1px solid #cbd5e1;border-radius:10px;padding:9px;font:inherit}
    .inv-field textarea{min-height:80px;resize:vertical}
    .inv-preview{background:linear-gradient(135deg,#f0fdfa,#f8fafc);min-height:560px;border:1px solid #dbe5ef;border-radius:18px;padding:24px}
    .inv-card{max-width:760px;margin:0 auto;background:#fff;border-radius:20px;border:1px solid #dbe5ef;padding:30px}
    .inv-badge{display:inline-block;padding:6px 10px;background:#dcfce7;color:#166534;border-radius:999px;font-weight:800;font-size:12px}
    .inv-head{font-size:36px;margin:10px 0 4px}.inv-sub{color:#334155;font-size:18px}
    .inv-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:20px 0}.inv-meta div{background:#f8fafc;padding:10px;border-radius:10px}
    @media (max-width: 960px){.inv-shell{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function typeLabel(formState) {
  return INVITATION_TYPES.find((t) => t.key === formState.type)?.label || '';
}

function courseLabel(formState) {
  return COURSE_OPTIONS.find((c) => c.key === formState.course)?.label || '';
}

function invitationPreviewHtml(formState) {
  return `
    <article class="inv-card">
      <span class="inv-badge">${typeLabel(formState)}</span>
      <h1 class="inv-head">${formState.title || `הזמנה ל${typeLabel(formState)}`}</h1>
      <div class="inv-sub">קורס: <strong>${courseLabel(formState)}</strong></div>
      <div class="inv-meta">
        <div><strong>בית ספר</strong><br>${formState.school || '—'}</div>
        <div><strong>כיתה</strong><br>${formState.className || '—'}</div>
        <div><strong>חברה מארחת</strong><br>${formState.host || '—'}</div>
        <div><strong>מיקום</strong><br>${formState.location || '—'}</div>
        <div><strong>תאריך</strong><br>${formState.date || '—'}</div>
        <div><strong>שעה</strong><br>${formState.time || '—'}</div>
      </div>
      <p>${formState.notes || 'נשמח לראותכם באירוע.'}</p>
    </article>`;
}

export const invitationsScreen = {
  async load() {
    return {};
  },
  render() {
    ensureInvitationStyles();
    const formState = {
      course: COURSE_OPTIONS[0].key,
      type: INVITATION_TYPES[0].key,
      school: '', className: '', host: '', title: '', date: '', time: '', location: '', notes: ''
    };

    return `
      <section class="inv-shell" data-invitations-root>
        <aside class="inv-panel">
          <h2 class="inv-title">מחולל הזמנות</h2>
          <p class="inv-muted">בחירת קורס וסוג הזמנה + עריכת פרטי ההזמנה.</p>

          <div><strong>קורס</strong></div>
          <div class="inv-grid">${COURSE_OPTIONS.map((c) => `<button type="button" class="inv-chip ${formState.course === c.key ? 'active' : ''}" data-course="${c.key}">${c.icon} ${c.label}</button>`).join('')}</div>

          <div><strong>סוג הזמנה</strong></div>
          <div class="inv-grid" style="grid-template-columns:1fr;">${INVITATION_TYPES.map((t) => `<button type="button" class="inv-chip ${formState.type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}</div>

          ${[
            ['school', 'בית ספר'], ['className', 'כיתה'], ['host', 'חברה מארחת'], ['title', 'כותרת אירוע'], ['date', 'תאריך'], ['time', 'שעה'], ['location', 'מיקום']
          ].map(([k, label]) => `<label class="inv-field"><span>${label}</span><input data-field="${k}" value="${formState[k] || ''}"/></label>`).join('')}
          <label class="inv-field"><span>תיאור / הערות</span><textarea data-field="notes">${formState.notes || ''}</textarea></label>
        </aside>

        <div class="inv-preview" data-inv-preview>${invitationPreviewHtml(formState)}</div>
      </section>`;
  },
  bind({ root }) {
    if (!root) return;
    const host = root.querySelector('[data-invitations-root]');
    if (!host) return;

    const formState = {
      course: COURSE_OPTIONS[0].key,
      type: INVITATION_TYPES[0].key,
      school: '', className: '', host: '', title: '', date: '', time: '', location: '', notes: ''
    };

    const repaint = () => {
      host.querySelectorAll('[data-course]').forEach((el) => {
        el.classList.toggle('active', el.dataset.course === formState.course);
      });
      host.querySelectorAll('[data-type]').forEach((el) => {
        el.classList.toggle('active', el.dataset.type === formState.type);
      });
      const preview = host.querySelector('[data-inv-preview]');
      if (preview) preview.innerHTML = invitationPreviewHtml(formState);
    };

    host.querySelectorAll('[data-course]').forEach((el) => {
      el.addEventListener('click', () => {
        formState.course = el.dataset.course || formState.course;
        repaint();
      });
    });

    host.querySelectorAll('[data-type]').forEach((el) => {
      el.addEventListener('click', () => {
        formState.type = el.dataset.type || formState.type;
        repaint();
      });
    });

    host.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const field = e?.target?.dataset?.field;
        if (!field) return;
        formState[field] = e?.target?.value || '';
        repaint();
      });
    });
  }
};
