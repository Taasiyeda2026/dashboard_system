// Prototype-only fake data. No Supabase, no network calls — replaced in a later phase.

export const ACTIVITY_TYPES = [
  'ביטול זמן',
  'הכשרה',
  'חדר בריחה',
  'סדנה',
  'סדנאות קיץ',
  'סיור',
  'קורס',
  'תפעול'
];

export const mockInstructor = {
  name: 'דנה כהן',
  empId: '1502'
};

export const mockMonthSummary = {
  monthLabel: 'אוגוסט 2026',
  reportsCount: 5,
  totalHours: 20,
  pendingCount: 1
};

export const mockReports = [
  { id: 1, date: '2026-08-14', activityType: 'קורס', place: 'בית ספר הרצל', hours: 4, status: 'אושר' },
  { id: 2, date: '2026-08-12', activityType: 'סדנה', place: 'מרכז נוער דרום', hours: 3, status: 'ממתין לאישור' },
  { id: 3, date: '2026-08-10', activityType: 'תפעול', place: 'משרד ראשי', hours: 2, status: 'אושר' },
  { id: 4, date: '2026-08-07', activityType: 'סיור', place: 'בית ספר יסודי גורדון', hours: 5, status: 'טיוטה' },
  { id: 5, date: '2026-08-03', activityType: 'הכשרה', place: 'קמפוס תעשיידע', hours: 6, status: 'אושר' }
];
