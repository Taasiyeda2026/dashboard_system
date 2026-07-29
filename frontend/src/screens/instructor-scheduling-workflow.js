import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { rankInstructors, deriveEducationLevel, adjacentActivities } from './instructor-matching-engine.js';
import { activityMeetings, projectedWeeklyLoad, averageWeeklyLoad } from './instructor-scheduling-load.js';
import { showToast } from './shared/toast.js';

const txt = (value) => String(value ?? '').trim();
const group = (rows, key = 'emp_id') => rows.reduce((out, row) => {
  const id = txt(row[key]);
  if (id) (out[id] ||= []).push(row);
  return out;
}, {});

let routeCapability = 'unknown';

async function route(origin, destination) {
  if (!txt(origin) || !txt(destination) || routeCapability === 'disabled') return null;
  try {
    const { data, error } = await supabase.functions.invoke('scheduling-route', { body: { origin, destination } });
    if (error) return null;
    if (!data?.calculated) {
      if (data?.reason === 'google_key_not_configured') routeCapability = 'disabled';
      return null;
    }
    routeCapability = 'available';
    return {
      distance_km: Number(data.distance_km),
      duration_minutes: Number(data.duration_minutes)
    };
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < source.length) {
      const index = nextIndex++;
      results[index] = await worker(source[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), source.length || 1) }, run));
  return results;
}

async function candidateTravel(instructor, activity, assigned) {
  const destination = activity.school_address || activity.school;
  const result = {
    home: await route(instructor.address, destination),
    transitions: {}
  };

  for (const meeting of activityMeetings(activity)) {
    const { previous, next } = adjacentActivities(assigned, meeting);
    result.transitions[meeting.date] = {
      previous: previous
        ? await route(previous.school_address || previous.school, destination)
        : null,
      next: next
        ? await route(destination, next.school_address || next.school)
        : null
    };
  }
  return result;
}

function neighborLine(label, item, leg) {
  if (!item) return `${label}: אין`;
  const travel = leg?.duration_minutes != null
    ? ` · ${leg.duration_minutes} דקות, ${Math.round(leg.distance_km)} ק״מ`
    : ' · זמן מעבר טרם חושב';
  return `${label}: ${item.activity_name || 'פעילות'} (${item.start_time}–${item.end_time})${travel}`;
}

function card(candidate, topId) {
  const instructor = candidate.instructor;
  const languages = (candidate.profile?.instruction_languages || ['he'])
    .map((value) => value === 'he' ? 'עברית' : 'ערבית')
    .join(', ');
  return `<article class="ds-card" style="padding:14px;display:grid;gap:7px">
    <div style="display:flex;justify-content:space-between">
      <strong>${escapeHtml(instructor.full_name || instructor.emp_id)}</strong>
      ${candidate.score == null ? '' : `<span class="ds-badge">ציון ${candidate.score}</span>`}
    </div>
    <span class="ds-muted">מזהה: ${escapeHtml(instructor.emp_id)} · שפות: ${escapeHtml(languages)}</span>
    <p style="margin:0">${escapeHtml(candidate.eligible ? candidate.explanation : candidate.failures.join(' · '))}</p>
    ${candidate.warnings.length ? `<p style="margin:0;color:#9a6700">⚠ ${escapeHtml(candidate.warnings.join(' · '))}</p>` : ''}
    ${candidate.eligible ? `<button type="button" class="ds-btn ds-btn--primary" data-select-scheduling-candidate="${escapeHtml(instructor.emp_id)}" data-top="${txt(instructor.emp_id) === topId ? 'yes' : 'no'}">בחירה</button>` : ''}
  </article>`;
}

function attachProfiles(results, profileMap) {
  [...results.recommended, ...results.exceptions, ...results.rejected].forEach((candidate) => {
    candidate.profile = profileMap[txt(candidate.instructor.emp_id)] || {};
  });
  return results;
}

export function bindInstructorScheduling(root, { ui, state, onAssigned, onCalculated } = {}) {
  const button = root?.querySelector('[data-find-instructor]');
  if (!button || button.dataset.bound) return;
  button.dataset.bound = 'yes';

  button.addEventListener('click', async () => {
    if (!['admin', 'operation_manager'].includes(txt(state?.user?.role))) {
      showToast('אין הרשאה לשמור שיבוץ', 'error');
      return;
    }

    const form = button.closest('[data-drawer-form]');
    let activity = {};
    try { activity = JSON.parse(form?.dataset.exportRow || '{}'); } catch { activity = {}; }
    activity.instruction_language = form?.querySelector('[name="instruction_language"]')?.value || activity.instruction_language || 'he';
    activity.required_instructor_gender = form?.querySelector('[name="required_instructor_gender"]')?.value || activity.required_instructor_gender || 'any';
    activity.education_level = form?.querySelector('[name="education_level"]')?.value || activity.education_level || deriveEducationLevel(activity.grade);

    button.disabled = true;
    button.textContent = 'בודק תנאי סף…';

    try {
      const [contacts, profiles, rules, exceptions, activities] = await Promise.all([
        supabase.from('contacts_instructors').select('*'),
        supabase.from('instructor_scheduling_profiles').select('*'),
        supabase.from('instructor_availability_rules').select('*'),
        supabase.from('instructor_availability_exceptions').select('*'),
        supabase.from('activities').select('*').neq('row_id', txt(activity.row_id || activity.RowID))
      ]);
      const error = [contacts, profiles, rules, exceptions, activities].find((response) => response.error)?.error;
      if (error) throw error;

      const profileMap = Object.fromEntries((profiles.data || []).map((profile) => [txt(profile.emp_id), profile]));
      const assignments = {};
      for (const assignedActivity of activities.data || []) {
        for (const id of [txt(assignedActivity.emp_id), txt(assignedActivity.emp_id_2)].filter(Boolean)) {
          for (const meeting of activityMeetings(assignedActivity)) {
            (assignments[id] ||= []).push({
              ...meeting,
              activity_name: assignedActivity.activity_name,
              school: assignedActivity.school,
              school_address: assignedActivity.school_address,
              authority: assignedActivity.authority
            });
          }
        }
      }

      const weeklyLoads = {};
      for (const instructor of contacts.data || []) {
        const id = txt(instructor.emp_id);
        weeklyLoads[id] = projectedWeeklyLoad(assignments[id] || [], activity);
      }
      const averageLoad = averageWeeklyLoad(weeklyLoads);
      const baseInput = {
        instructors: contacts.data || [],
        profiles: profileMap,
        rules: group(rules.data || []),
        exceptions: group(exceptions.data || []),
        assignments,
        weeklyLoads,
        averageWeeklyLoad: averageLoad,
        activity
      };

      const preliminary = rankInstructors({ ...baseInput, travel: {} });
      const preliminaryEligible = [...preliminary.recommended, ...preliminary.exceptions];
      const travel = {};

      if (preliminaryEligible.length) {
        button.textContent = `מחשב נסיעות ל־${preliminaryEligible.length} מועמדים…`;
        await mapWithConcurrency(preliminaryEligible, 4, async (candidate) => {
          const id = txt(candidate.instructor.emp_id);
          travel[id] = await candidateTravel(candidate.instructor, activity, assignments[id] || []);
        });
      }

      const results = attachProfiles(rankInstructors({ ...baseInput, travel }), profileMap);
      const eligible = [...results.recommended, ...results.exceptions];
      const top = eligible[0];
      onCalculated?.({
        activityId: txt(activity.row_id || activity.RowID),
        ready: eligible.length > 0,
        candidateCount: eligible.length,
        topName: top?.instructor?.full_name || '',
        reason: eligible.length ? '' : 'לא נמצאו מדריכים שעברו את תנאי הסף'
      });

      const section = (title, rows) => `<section style="display:grid;gap:9px">
        <h3>${title} <span class="ds-badge">${rows.length}</span></h3>
        ${rows.map((candidate) => card(candidate, txt(top?.instructor.emp_id))).join('') || '<p class="ds-muted">אין מועמדים בקבוצה זו.</p>'}
      </section>`;

      ui.openDrawer({
        title: 'איתור ושיבוץ מדריך',
        content: `<div dir="rtl" style="display:grid;gap:16px">
          <header>
            <h2>${escapeHtml(activity.activity_name || 'פעילות')}</h2>
            <p>${escapeHtml(activity.school || '—')} · ${escapeHtml(activity.authority || '—')} · ${escapeHtml(activity.education_level || 'שכבה לא הוגדרה')} · ${activity.instruction_language === 'ar' ? 'ערבית' : 'עברית'} · ${escapeHtml(activity.start_time || '')}–${escapeHtml(activity.end_time || '')}</p>
            <strong>${eligible.length ? 'מוכן לשיבוץ' : 'אין מועמדים מתאימים'}</strong>
          </header>
          ${section('מומלצים', results.recommended)}
          ${section('מתאימים עם חריגה', results.exceptions)}
          ${section('לא מתאימים', results.rejected)}
        </div>`,
        onOpen: (drawer) => {
          drawer.querySelectorAll('[data-select-scheduling-candidate]').forEach((select) => select.addEventListener('click', () => {
            const candidate = eligible.find((item) => txt(item.instructor.emp_id) === select.dataset.selectSchedulingCandidate);
            if (!candidate) return;
            const exception = candidate.warnings.length > 0;
            const override = select.dataset.top !== 'yes';
            const schedule = candidate.schedule.map((item) => `<li>
              <strong>${escapeHtml(item.date)}</strong><br>
              ${escapeHtml(neighborLine('פעילות קודמת', item.previous, item.previous_travel))}<br>
              ${escapeHtml(neighborLine('פעילות הבאה', item.next, item.next_travel))}
            </li>`).join('');

            ui.openModal({
              title: 'אישור שיבוץ',
              content: `<div dir="rtl">
                <h3>${escapeHtml(candidate.instructor.full_name)}</h3>
                <p>כל המפגשים בשעות ${escapeHtml(activity.start_time || '')}–${escapeHtml(activity.end_time || '')}:</p>
                <ul>${schedule}</ul>
                ${candidate.warnings.length ? `<p>חריגות: ${escapeHtml(candidate.warnings.join(' · '))}</p>` : ''}
                <label>${override || exception ? 'סיבה (חובה)' : 'הערה'}<textarea class="ds-input" data-assignment-reason></textarea></label>
                ${exception ? '<label><input type="checkbox" data-approve-exception> אני מאשר/ת את החריגה</label>' : ''}
                <p data-assignment-error></p>
              </div>`,
              actions: '<button class="ds-btn ds-btn--primary" data-confirm-assignment>אישור ושיבוץ</button><button class="ds-btn" data-ui-close-modal>ביטול</button>'
            });

            document.querySelector('[data-confirm-assignment]')?.addEventListener('click', async () => {
              const modal = document.querySelector('.ds-modal__content');
              const reason = txt(modal?.querySelector('[data-assignment-reason]')?.value);
              const errorElement = modal?.querySelector('[data-assignment-error]');
              if ((override || exception) && !reason) {
                if (errorElement) errorElement.textContent = 'חובה להזין סיבה.';
                return;
              }
              if (exception && !modal?.querySelector('[data-approve-exception]')?.checked) {
                if (errorElement) errorElement.textContent = 'חובה לאשר את החריגה.';
                return;
              }

              try {
                const decision = exception ? 'exception_approved' : override ? 'overridden' : 'approved';
                const { error: assignmentError } = await supabase.rpc('assign_activity_instructor', {
                  p_activity_id: txt(activity.row_id || activity.RowID),
                  p_emp_id: Number(candidate.instructor.emp_id),
                  p_instructor_name: candidate.instructor.full_name,
                  p_top_emp_id: top ? Number(top.instructor.emp_id) : null,
                  p_selected_score: candidate.score,
                  p_top_score: top?.score ?? null,
                  p_decision_type: decision,
                  p_reason: reason || null
                });
                if (assignmentError) throw assignmentError;
                ui.closeModal();
                ui.closeDrawer();
                showToast('המדריך שובץ בהצלחה', 'success');
                onAssigned?.();
              } catch (assignmentError) {
                if (errorElement) errorElement.textContent = `השמירה נכשלה: ${assignmentError.message}`;
              }
            });
          }));
        }
      });
    } catch (error) {
      showToast(`חישוב ההתאמות נכשל: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'איתור ושיבוץ מדריך';
    }
  });
}
