// Fake report data only — activity types, month summary and the reports list are not
// backed by any table yet. Instructor identity itself is real (see auth/identity.service.js).

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
