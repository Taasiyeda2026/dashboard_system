-- Fix existing active one-day activities that were accidentally stored as programs.
-- Do not rely on created_at (not present in every production database).
UPDATE public.activities
SET activity_family = 'one_day'
WHERE COALESCE(status, '') <> 'נמחק'
  AND COALESCE(activity_family, '') <> 'one_day'
  AND lower(replace(replace(btrim(COALESCE(activity_type, '')), '-', '_'), ' ', '_')) IN (
    'tour',
    'tours',
    'סיור',
    'סיורים',
    'workshop',
    'workshops',
    'סדנה',
    'סדנאות',
    'escape_room',
    'escaperoom',
    'חדר_בריחה',
    'חדרי_בריחה'
  );
