import { ACTIVITY_SEASON_SCHOOL_2027, normalizeActivitySeason } from './summer-activity.js';

function text(value) {
  return String(value ?? '').trim();
}

function contactPhone(contact = {}, activity = {}) {
  return text(contact.mobile) || text(contact.phone) || text(activity.contact_phone);
}

function activeContacts(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => text(row.active) !== 'לא פעיל');
}

function sameText(a, b) {
  return text(a) && text(a) === text(b);
}

export function isSchool2027Activity(activity = {}) {
  return normalizeActivitySeason(activity.activity_season ?? activity.activitySeason) === ACTIVITY_SEASON_SCHOOL_2027;
}

export function resolveSchool2027Contact(activity = {}, contacts = []) {
  if (!isSchool2027Activity(activity)) {
    return {
      name: text(activity.contact_name),
      phone: text(activity.contact_phone || activity.phone),
      email: text(activity.contact_email || activity.email),
      role: text(activity.contact_role),
      id: text(activity.school_contact_id),
      source: 'activity'
    };
  }

  const active = activeContacts(contacts);
  const savedId = text(activity.school_contact_id);
  let selected = null;
  let source = '';
  if (savedId) {
    selected = active.find((contact) => text(contact.id) === savedId) || null;
    source = selected ? 'school_contact_id' : '';
  }
  if (!selected) {
    const schoolId = text(activity.school_id);
    const matches = schoolId
      ? active.filter((contact) => sameText(contact.school_id, schoolId))
      : active.filter((contact) => sameText(contact.authority, activity.authority) && sameText(contact.school, activity.school));
    if (matches.length === 1) {
      selected = matches[0];
      source = schoolId ? 'single_school_id' : 'single_authority_school';
    }
  }

  if (!selected) {
    return {
      name: text(activity.contact_name),
      phone: text(activity.contact_phone),
      email: text(activity.contact_email),
      role: text(activity.contact_role),
      id: savedId,
      source: 'activity'
    };
  }

  return {
    name: text(selected.contact_name) || text(activity.contact_name),
    phone: contactPhone(selected, activity),
    email: text(selected.email) || text(activity.contact_email),
    role: text(selected.contact_role) || text(activity.contact_role),
    id: text(selected.id) || savedId,
    source
  };
}

export function withResolvedSchool2027Contact(activity = {}, contacts = []) {
  if (!isSchool2027Activity(activity)) return { ...activity };
  const resolved = resolveSchool2027Contact(activity, contacts);
  return {
    ...activity,
    resolved_school_2027_contact: resolved,
    resolved_contact_name: resolved.name,
    resolved_contact_phone: resolved.phone,
    resolved_contact_email: resolved.email,
    resolved_contact_role: resolved.role
  };
}
