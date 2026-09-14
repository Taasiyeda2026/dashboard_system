-- Correct the general Jewish-school Sukkot 2026 calendar boundary.
-- 2026-10-04 is a school day; the holiday ends on 2026-10-03.
update public.school_calendar
set end_date = date '2026-10-03',
    resume_date = date '2026-10-04',
    notes = 'הלימודים יתחדשו ביום ראשון, 4 באוקטובר 2026.',
    updated_at = now()
where external_key = 'GEN-SUKKOT';
