import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { state } from './state.js';

const STAFF_ROLES = new Set([
  'admin', 'operation_manager', 'authorized_user', 'finance',
  'activities_manager', 'domain_manager', 'instructor_manager', 'business_development_manager'
]);

function dateHe(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit'
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${part('day')}.${part('month')}.${part('year')}`;
}

function create(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

/** A stand-alone activity timeline; never modifies activities.notes or operational notes. */
export function enhanceActivityUpdateNotes(form) {
  if (!form || form.dataset.updateNotesBound === 'yes') return false;
  if (form.dataset.instructorLimited === 'yes') return false;
  const role = String(state?.user?.role || '').trim();
  if (!STAFF_ROLES.has(role)) return false;
  const activityId = String(form.dataset.rowId || '').trim();
  if (!activityId || !supabase) return false;
  form.dataset.updateNotesBound = 'yes';

  const doc = form.ownerDocument;
  // Keep the activity's primary fields in control of the drawer layout.
  // This stylesheet is scoped to the notes component; it does not resize
  // the drawer, its details grid, or unrelated activity sections.
  if (!doc.getElementById('activity-update-notes-compact-style')) {
    const style = create(doc, 'style');
    style.id = 'activity-update-notes-compact-style';
    style.textContent = `
      .activity-update-notes {
        box-sizing: border-box !important;
        display: block !important;
        flex: 0 0 auto !important;
        grid-column: 1 / -1 !important;
        order: 999 !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: 100% !important;
        margin: 12px 0 0 !important;
        padding: 10px 0 0 !important;
        border-top: 1px solid #dce4ed !important;
        background: transparent !important;
        box-shadow: none !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
        text-align: right !important;
        direction: rtl !important;
        overflow: visible !important;
      }
      .activity-update-notes .activity-update-notes__title {
        margin: 0 0 6px !important;
        padding: 0 !important;
        font-size: 15px !important;
        font-weight: 700 !important;
        line-height: 1.35 !important;
      }
      .activity-update-notes .activity-update-notes__items {
        display: block !important;
        flex: none !important;
        min-height: 0 !important;
        max-height: 192px !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      .activity-update-notes .activity-update-notes__line {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        max-width: 100% !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 5px 7px !important;
        color: #34455d !important;
        background: transparent !important;
        border: 0 !important;
        border-bottom: 1px solid #eef1f5 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        font-size: 12px !important;
        font-weight: 400 !important;
        line-height: 1.45 !important;
        text-align: right !important;
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
      }
      .activity-update-notes .activity-update-notes__line--latest {
        margin-bottom: 4px !important;
        padding: 7px 9px !important;
        border: 1px solid #dceaf2 !important;
        border-radius: 7px !important;
        background: #f4f9fc !important;
        color: #22374d !important;
      }
      .activity-update-notes .activity-update-notes__stamp {
        display: inline !important;
        margin: 0 !important;
        color: #213751 !important;
        font-size: inherit !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
      }
      .activity-update-notes .activity-update-notes__history {
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      .activity-update-notes .activity-update-notes__history-toggle {
        display: list-item !important;
        width: fit-content !important;
        max-width: 100% !important;
        margin: 3px 0 !important;
        padding: 3px 5px !important;
        border: 0 !important;
        background: transparent !important;
        color: #54718d !important;
        cursor: pointer !important;
        font-size: 12px !important;
        line-height: 1.4 !important;
      }
      .activity-update-notes .activity-update-notes__composer {
        display: block !important;
        min-height: 0 !important;
        margin: 7px 0 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
      }
      .activity-update-notes .activity-update-notes__input {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-height: 48px !important;
        height: 48px !important;
        max-height: 100px !important;
        margin: 0 !important;
        padding: 8px 10px !important;
        border: 1px solid #d6e0ea !important;
        border-radius: 7px !important;
        background: #fff !important;
        font-size: 13px !important;
        resize: vertical !important;
      }
      .activity-update-notes .activity-update-notes__actions {
        display: flex !important;
        justify-content: flex-start !important;
        margin: 5px 0 0 !important;
        padding: 0 !important;
      }
      .activity-update-notes .activity-update-notes__save {
        min-height: 30px !important;
        padding: 4px 12px !important;
        font-size: 12px !important;
      }
      /* Empty timeline: no title, blank-state text or decorative separator. */
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes[data-has-notes="no"] {
        border-top: 0 !important;
        margin-top: 0 !important;
        padding-top: 0 !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes[data-has-notes="no"] .activity-update-notes__title,
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes[data-has-notes="no"] .activity-update-notes__items {
        display: none !important;
      }
      /* The compose field must use the whole activity scroll-body width. */
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes,
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer,
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__input {
        inline-size: 100% !important;
        width: 100% !important;
        max-inline-size: none !important;
        max-width: none !important;
        box-sizing: border-box !important;
        align-self: stretch !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer {
        margin-top: 4px !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__input {
        min-inline-size: 0 !important;
        min-width: 0 !important;
      }
      /* 2027: the note composer is a single horizontal row. */
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 10px !important;
        margin: 7px 0 0 !important;
        min-width: 0 !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer > .activity-update-notes__input {
        flex: 1 1 0% !important;
        align-self: center !important;
        width: auto !important;
        min-width: 0 !important;
        min-height: 48px !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer > .activity-update-notes__actions {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex: 0 0 auto !important;
        align-self: center !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__composer .activity-update-notes__save {
        min-height: 34px !important;
        margin: 0 !important;
        white-space: nowrap !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__history-host {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 7px 0 0 !important;
        padding: 0 !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__history-host:empty {
        display: none !important;
      }
      .activity-drawer-inline-layout[data-activity-season="school_2027"] .activity-update-notes__history-host details[open] {
        max-height: 240px !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
      @media (max-width: 640px) {
        .activity-update-notes .activity-update-notes__items { max-height: 160px !important; }
        .activity-update-notes { margin-top: 9px !important; padding-top: 8px !important; }
      }
    `;
    (doc.head || doc.documentElement).append(style);
  }
  const is2027 = form.dataset.activitySeason === 'school_2027';
  const section = create(doc, 'section', 'activity-update-notes');
  section.dataset.activityUpdateNotes = 'yes';
  section.dataset.hasNotes = 'loading';
  section.append(create(doc, 'h3', 'activity-update-notes__title', 'הערות'));
  const output = create(doc, 'div', 'activity-update-notes__items');
  output.setAttribute('aria-live', 'polite');
  section.append(output);

  const editorAllowed = (state?.user?.can_edit_direct === true || state?.user?.can_request_edit === true
    || state?.user?.can_edit_direct === 'yes' || state?.user?.can_request_edit === 'yes')
    && form.dataset.activityReadOnly !== 'yes';
  const editor = create(doc, 'div', 'activity-update-notes__composer');
  if (editorAllowed) {
    const textarea = create(doc, 'textarea', 'activity-update-notes__input');
    textarea.placeholder = 'כתיבת הערה חדשה...';
    textarea.rows = 2;
    textarea.maxLength = 4000;
    textarea.setAttribute('aria-label', 'הוספת הערה');
    const actions = create(doc, 'div', 'activity-update-notes__actions');
    const button = create(doc, 'button', 'activity-update-notes__save', 'הוסף הערה');
    button.type = 'button';
    actions.append(button);
    editor.append(textarea, actions);
    button.addEventListener('click', async () => {
      const body = textarea.value.trim();
      if (!body || button.disabled) return;
      button.disabled = true;
      try {
        await waitForSupabaseAuthSession();
        const { error } = await supabase.from('activity_update_notes')
          .insert({ activity_row_id: activityId, body, author_name: String(state?.user?.full_name || state?.user?.name || 'משתמש') });
        if (error) throw error;
        textarea.value = '';
        await refresh();
      } catch (error) {
        output.textContent = 'שמירת ההערה נכשלה. ניתן לנסות שוב.';
        console.error('[activity-update-notes] insert failed', error);
      } finally {
        button.disabled = false;
      }
    });
    section.append(editor);
  }

  // History belongs below the composer for 2027; latest stays above it.
  const historyHost = is2027 ? create(doc, 'div', 'activity-update-notes__history-host') : null;
  if (historyHost) section.append(historyHost);

  // The timeline is part of the activity's SCROLLABLE content, not a flex
  // sibling of the body. Appending it to the form leaves a full-height body
  // above it, creating a large empty gap and hiding the notes below the footer.
  // Primary details and "מידע נוסף" remain first; fixed action bars stay
  // outside the scroller where the drawer's docking code placed them.
  const scrollBody = form.querySelector(':scope > .activity-drawer-inline__body');
  if (scrollBody) {
    scrollBody.append(section);
  } else {
    // The standard (non-inline) drawer keeps its original behavior.
    form.append(section);
  }

  async function refresh() {
    output.textContent = 'טוען הערות...';
    try {
      await waitForSupabaseAuthSession();
      const { data, error } = await supabase.from('activity_update_notes')
        .select('id,body,author_name,created_at,is_legacy,occurred_on,legacy_sequence,saved_at')
        .eq('activity_row_id', activityId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw error;
      output.replaceChildren();
      historyHost?.replaceChildren();
      const notes = Array.isArray(data) ? [...data] : [];
      section.dataset.hasNotes = notes.length ? 'yes' : 'no';
      const noteTime = (note) => note.is_legacy
        ? (note.saved_at ? Date.parse(note.saved_at) : (note.occurred_on ? Date.parse(note.occurred_on + 'T12:00:00Z') : 0))
        : (Date.parse(note.created_at) || 0);
      notes.sort((a, b) => {
        const delta = noteTime(b) - noteTime(a);
        if (delta) return delta;
        if (a.is_legacy && b.is_legacy)
          return (Number(a.legacy_sequence) || 0) - (Number(b.legacy_sequence) || 0);
        return Number(b.id) - Number(a.id);
      });
      if (!notes.length) {
        // Do not waste drawer height with a title or placeholder when empty.
        // The full-width new-note editor remains available.
        return;
      }
      const item = (note, latest) => {
        const line = create(doc, 'div', 'activity-update-notes__line' + (latest ? ' activity-update-notes__line--latest' : ''));
        const stamp = create(doc, 'strong', 'activity-update-notes__stamp', note.is_legacy
          ? (note.saved_at ? `${dateHe(note.saved_at)} · ${note.author_name}: ` : (note.occurred_on ? `${dateHe(note.occurred_on)} · ${note.author_name}: ` : `${note.author_name}: `))
          : `${dateHe(note.created_at)} · ${note.author_name}: `);
        line.append(stamp, doc.createTextNode(String(note.body || '')));
        return line;
      };
      output.append(item(notes[0], true));
      if (notes.length > 1) {
        const details = create(doc, 'details', 'activity-update-notes__history');
        const summary = create(doc, 'summary', 'activity-update-notes__history-toggle', `הערות קודמות (${notes.length - 1})`);
        details.append(summary);
        notes.slice(1).forEach((note) => details.append(item(note, false)));
        (historyHost || output).append(details);
      }
    } catch (error) {
      section.dataset.hasNotes = 'error';
      output.textContent = 'לא ניתן לטעון את ההערות כרגע.';
      console.error('[activity-update-notes] load failed', error);
    }
  }
  void refresh();
  return true;
}
