const MAX_MEETINGS = 35;

export const COORDINATION_STATUS = Object.freeze({
  MISSING_DETAILS: 'missing_details',
  NOT_SENT: 'not_sent',
  READY: 'ready',
  DRAFT: 'draft',
  SENT: 'sent',
  CHANGED_SINCE_SENT: 'changed_since_sent'
});

const HEBREW_DAYS = Object.freeze(['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת']);

function text(value) {
  return String(value ?? '').trim();
}

function normalizedTime(value) {
  const match = text(value).match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function normalizedDate(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

export function parseSessionCount(value) {
  const raw = text(value);
  if (!/^\d+$/.test(raw)) return null;
  const count = Number(raw);
  return Number.isInteger(count) && count >= 1 && count <= MAX_MEETINGS ? count : null;
}

export function hebrewDayForDate(value) {
  const date = normalizedDate(value);
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  return HEBREW_DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || '';
}

export function displayDate(value) {
  const date = normalizedDate(value);
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function readinessForActivity(activity = {}) {
  const sessions = parseSessionCount(activity.sessions);
  const missing = [];
  if (!sessions) missing.push('sessions');
  if (sessions) {
    for (let meeting = 1; meeting <= sessions; meeting += 1) {
      if (!normalizedDate(activity[`date_${meeting}`])) missing.push(`date_${meeting}`);
    }
  }
  if (!normalizedTime(activity.start_time)) missing.push('start_time');
  if (!normalizedTime(activity.end_time)) missing.push('end_time');
  if (!text(activity.emp_id) && !text(activity.instructor_name)) missing.push('instructor');
  return { ready: missing.length === 0, missing, sessions };
}

function preparationIndex(syllabusRows = []) {
  const index = new Map();
  for (const row of syllabusRows || []) {
    const programNumber = text(row?.program_number);
    const meetingOrder = Number(row?.meeting_order);
    if (!programNumber || !Number.isInteger(meetingOrder)) continue;
    index.set(`${programNumber}:${meetingOrder}`, text(row?.school_preparation));
  }
  return index;
}

export function meetingRowsForActivity(activity = {}, syllabusRows = []) {
  const sessions = parseSessionCount(activity.sessions);
  if (!sessions) return [];
  const syllabus = preparationIndex(syllabusRows);
  const programNumber = text(activity.activity_no);
  const start = normalizedTime(activity.start_time);
  const end = normalizedTime(activity.end_time);
  const grade = text(activity.grade);
  const classGroup = text(activity.class_group);
  const gradeAndClass = [grade, classGroup].filter(Boolean).join(' / ');
  return Array.from({ length: sessions }, (_, index) => {
    const meetingNumber = index + 1;
    const rawDate = normalizedDate(activity[`date_${meetingNumber}`]);
    return {
      meeting_number: meetingNumber,
      date: displayDate(rawDate),
      day: hebrewDayForDate(rawDate),
      grade_class: gradeAndClass,
      hours: start && end ? `${start}–${end}` : '',
      school_preparation: programNumber ? (syllabus.get(`${programNumber}:${meetingNumber}`) || '') : ''
    };
  });
}

export function buildActivityDocumentSnapshot({
  activity = {},
  syllabusRows = [],
  school = {},
  contact = {},
  instructor = {},
  activityManager = {}
} = {}) {
  return {
    school: {
      name: text(school.name ?? activity.school),
      semel_mosad: text(school.semel_mosad ?? activity.semel_mosad),
      authority: text(school.authority ?? activity.authority)
    },
    contact: {
      name: text(contact.name ?? activity.contact_name),
      role: text(contact.role ?? activity.contact_role),
      phone: text(contact.phone ?? activity.contact_phone)
    },
    program: {
      name: text(activity.activity_name ?? activity.program_name),
      activity_no: text(activity.activity_no),
      gefen_number: text(activity.gefen_number),
      sessions: parseSessionCount(activity.sessions),
      meetings: meetingRowsForActivity(activity, syllabusRows)
    },
    instructor: {
      name: text(instructor.name ?? activity.instructor_name),
      phone: text(instructor.phone ?? instructor.mobile)
    },
    activity_manager: {
      name: text(activityManager.name ?? activity.activity_manager),
      phone: text(activityManager.phone)
    }
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function documentDataHash(snapshot) {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeRecipientEmail(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

export function groupActivitiesForDispatch(items = []) {
  const groups = new Map();
  for (const item of items) {
    const email = normalizeRecipientEmail(item.recipient_email);
    const key = `${text(item.activity_season)}\u0000${text(item.school_id)}\u0000${email}`;
    if (!groups.has(key)) {
      groups.set(key, {
        activity_season: text(item.activity_season),
        school_id: text(item.school_id),
        recipient_email: email,
        activities: []
      });
    }
    groups.get(key).activities.push(item);
  }
  return Array.from(groups.values());
}

export function coordinationStatus({ readiness, currentHash = '', latestSent = null, activeDraft = null } = {}) {
  if (latestSent?.document_data_hash) {
    return latestSent.document_data_hash === currentHash
      ? COORDINATION_STATUS.SENT
      : COORDINATION_STATUS.CHANGED_SINCE_SENT;
  }
  if (activeDraft?.document_data_hash && activeDraft.document_data_hash === currentHash) return COORDINATION_STATUS.DRAFT;
  if (readiness && !readiness.ready) return COORDINATION_STATUS.MISSING_DETAILS;
  if (readiness?.ready) return COORDINATION_STATUS.READY;
  return COORDINATION_STATUS.NOT_SENT;
}

export function sanitizePdfFilenamePart(value) {
  return text(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 100) || 'ללא שם';
}

export function coordinationPdfFilename(snapshots = []) {
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];
  const schoolName = sanitizePdfFilenamePart(safeSnapshots[0]?.school?.name);
  if (safeSnapshots.length === 1) {
    return `סיכום תיאום - ${sanitizePdfFilenamePart(safeSnapshots[0]?.program?.name)} - ${schoolName}.pdf`;
  }
  return `סיכום תיאום פעילויות - ${schoolName}.pdf`;
}

export function coordinationMailContent(snapshots = []) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const school = list[0]?.school?.name || '';
  if (list.length === 1) {
    const program = list[0]?.program?.name || '';
    return {
      subject: `פרטי הפעילות ומועדי המפגשים – ${program} | ${school}`,
      body: `שלום רב,\n\nמצורף סיכום התיאום עבור תוכנית "${program}" בבית הספר ${school}.\n\nבנוסף, מצורף אישור צילום, תיעוד ופרסום. נבקש להחזירו חתום על ידי הגורם המוסמך בבית הספר.`
    };
  }
  return {
    subject: `פרטי הפעילויות ומועדי המפגשים – ${school}`,
    body: `שלום רב,\n\nמצורף סיכום התיאום עבור הפעילויות המתוכננות בבית הספר ${school}.\n\nבנוסף, מצורף אישור צילום, תיעוד ופרסום. נבקש להחזירו חתום על ידי הגורם המוסמך בבית הספר.`
  };
}
