// Photo-consent documents remain owned by the activity they were uploaded for.
// This read-only projection makes them discoverable at the school level without
// copying or moving files, and keeps schools in different authorities distinct.
const normalizeSchoolPart = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('he');

export function photoConsentSchoolKey(activity) {
  const school = normalizeSchoolPart(activity?.school);
  if (!school) return '';
  return normalizeSchoolPart(activity?.authority) + '\u0000' + school;
}

export function photoConsentDocumentsBySchool(activities = [], files = []) {
  const activitiesById = new Map(activities.map((a) => [Number(a.id), a]));
  const bySchool = new Map();
  for (const file of files) {
    const owner = activitiesById.get(Number(file.activity_id));
    if (!owner) continue; // Exclude files from another school-year.
    const key = photoConsentSchoolKey(owner);
    if (!key) continue;
    if (!bySchool.has(key)) bySchool.set(key, []);
    bySchool.get(key).push({ ...file, ownerActivity: owner });
  }
  for (const documents of bySchool.values()) {
    documents.sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')));
  }
  return bySchool;
}

// Operational columns are based only on activities actually linked to documents.
// One school can have more than one instructor, activity manager or course date.
export function photoConsentSchoolOperationalSummary(documents = []) {
  const activities = [...new Map(documents.map((file) =>
    [Number(file.activity_id), file.ownerActivity])).values()].filter(Boolean);
  const unique = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
  const managers = unique(activities.map((activity) => activity.activity_manager));
  const instructors = unique(activities.map((activity) => activity.instructor_name));
  const dates = unique(activities.map((activity) => String(activity.start_date || '').slice(0, 10))).sort();
  return { managers, instructors, startDates: dates, firstStartDate: dates[0] || null };
}

export function photoConsentSchoolManagementGroups(activities = [], files = []) {
  const grouped = photoConsentDocumentsBySchool(activities, files);
  return Array.from(grouped, ([key, documents]) => {
    const activity = documents[0].ownerActivity;
    return {
      key,
      school: activity.school,
      authority: activity.authority,
      documents,
      operational: photoConsentSchoolOperationalSummary(documents),
      activityCount: new Set(documents.map((file) => Number(file.activity_id))).size,
      updatedAt: documents[0].uploaded_at
    };
  }).filter((group) => group.documents.length > 0)
    .sort((a, b) => String(a.school || '').localeCompare(String(b.school || ''), 'he') ||
      String(a.authority || '').localeCompare(String(b.authority || ''), 'he'));
}
