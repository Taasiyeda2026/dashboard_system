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
