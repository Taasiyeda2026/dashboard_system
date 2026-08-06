export const INSTRUCTOR_SENIORITY_MIN = 1;
export const INSTRUCTOR_SENIORITY_MAX = 20;

export function instructorSeniorityValues() {
  return Array.from(
    { length: INSTRUCTOR_SENIORITY_MAX - INSTRUCTOR_SENIORITY_MIN + 1 },
    (_, index) => INSTRUCTOR_SENIORITY_MIN + index
  );
}

export function normalizeInstructorSeniority(value) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < INSTRUCTOR_SENIORITY_MIN || numeric > INSTRUCTOR_SENIORITY_MAX) {
    throw new Error(`הוותק חייב להיות מספר שלם בין ${INSTRUCTOR_SENIORITY_MIN} ל-${INSTRUCTOR_SENIORITY_MAX}.`);
  }
  return numeric;
}

export function formatInstructorSeniority(value) {
  let numeric;
  try {
    numeric = normalizeInstructorSeniority(value);
  } catch {
    return 'לא הוגדר';
  }
  if (numeric == null) return 'לא הוגדר';
  return numeric === 1 ? '1 שנה' : `${numeric} שנים`;
}
