import { withTravelDeadline } from './travel-request-guard.js';

// Confirmation reads are bounded too. A caller must retain a stable create ID
// across retries: an aborted HTTP request can still commit on the server.
export async function confirmedMutation(write, confirm) {
  try {
    return await withTravelDeadline(write, {timeoutMs:20000, action:'שמירת השינויים'});
  } catch (error) {
    try {
      const found = await withTravelDeadline(confirm, {action:'בדיקת מצב השמירה'});
      if (found !== null) return found;
    } catch {
      throw new Error('לא ניתן לאמת את תוצאת הפעולה. הנתונים נשארו בטופס. בדקו חיבור ונסו שוב; ניסיון חוזר לא ייצור רשומה נוספת.');
    }
    throw error;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key=>[key,canonical(value[key])])
  );
  return value;
}
export function recordMatchesPayload(record, payload) {
  const comparable = (key,value) => {
    // Postgres serializes time as HH:MM:SS; form pickers submit HH:MM.
    if (['start_time','end_time'].includes(key) && /^\d{2}:\d{2}(?::\d{2})?$/.test(String(value))) {
      return String(value).length===5 ? value+':00' : value;
    }
    return canonical(value ?? null);
  };
  return Boolean(record) && Object.entries(payload).every(([key,value]) =>
    JSON.stringify(comparable(key,record[key])) === JSON.stringify(comparable(key,value))
  );
}
