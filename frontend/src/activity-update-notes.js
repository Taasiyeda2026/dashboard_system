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
  const section = create(doc, 'section', 'activity-update-notes');
  section.dataset.activityUpdateNotes = 'yes';
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

  // The timeline belongs at the very end, after existing view/edit action rows.
  form.append(section);

  async function refresh() {
    output.textContent = 'טוען הערות...';
    try {
      await waitForSupabaseAuthSession();
      const { data, error } = await supabase.from('activity_update_notes')
        .select('id,body,author_name,created_at,is_legacy')
        .eq('activity_row_id', activityId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw error;
      output.replaceChildren();
      const notes = Array.isArray(data) ? data : [];
      if (!notes.length) {
        output.append(create(doc, 'p', 'activity-update-notes__empty', 'עדיין לא נוספו הערות.'));
        return;
      }
      const item = (note, latest) => {
        const line = create(doc, 'div', 'activity-update-notes__line' + (latest ? ' activity-update-notes__line--latest' : ''));
        const stamp = create(doc, 'strong', 'activity-update-notes__stamp', note.is_legacy
          ? `${note.author_name} · הערות היסטוריות: `
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
        output.append(details);
      }
    } catch (error) {
      output.textContent = 'לא ניתן לטעון את ההערות כרגע.';
      console.error('[activity-update-notes] load failed', error);
    }
  }
  void refresh();
  return true;
}
