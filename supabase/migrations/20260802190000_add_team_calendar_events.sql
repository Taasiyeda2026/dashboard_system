create table if not exists public.team_calendar_events (
  external_key text primary key,
  event_date date not null,
  title text not null check (btrim(title) <> ''),
  owner_name text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_calendar_events enable row level security;
grant select on table public.team_calendar_events to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'team_calendar_events'
      and policyname = 'Authenticated users can view team calendar events'
  ) then
    create policy "Authenticated users can view team calendar events"
      on public.team_calendar_events for select to authenticated using (true);
  end if;
end $$;

insert into public.team_calendar_events (external_key, event_date, title, owner_name, display_order, is_active)
values
  ('team-20260802-01', '2026-08-02', 'מיפוי קורסים', 'עדן', 1, true),
  ('team-20260802-02', '2026-08-02', 'תזכורת למשוב קיץ לצוות החינוכי', 'עדן', 2, true),
  ('team-20260802-03', '2026-08-02', 'מיפוי מדריכים', 'עידן', 3, true),
  ('team-20260802-04', '2026-08-02', 'סגירת שנת תשפ״ו', null, 4, true),
  ('team-20260803-01', '2026-08-03', 'חופשה - גיל', 'גיל', 1, true),
  ('team-20260803-02', '2026-08-03', 'חופשה - עידן', 'עידן', 2, true),
  ('team-20260804-01', '2026-08-04', 'סיכום משוב קיץ של הצוות החינוכי', 'עידן', 1, true),
  ('team-20260805-01', '2026-08-05', 'איסוף ציוד קיץ וספירת מלאי', 'גיל', 1, true),
  ('team-20260805-02', '2026-08-05', 'ספירת מלאי ציוד קיץ', 'הילה', 2, true),
  ('team-20260805-03', '2026-08-05', 'הפצת אישורי גפ״ן', 'עדן', 3, true),
  ('team-20260806-01', '2026-08-06', 'חופשה - גיל', 'גיל', 1, true),
  ('team-20260806-02', '2026-08-06', 'חופשה - עידן', 'עידן', 2, true),
  ('team-20260809-01', '2026-08-09', 'חופשה - גיל', 'גיל', 1, true),
  ('team-20260809-02', '2026-08-09', 'חופשה - עידן', 'עידן', 2, true),
  ('team-20260810-01', '2026-08-10', 'חופשה - גיל', 'גיל', 1, true),
  ('team-20260810-02', '2026-08-10', 'חופשה - עידן', 'עידן', 2, true),
  ('team-20260811-01', '2026-08-11', 'חופשה - עדן', 'עדן', 1, true),
  ('team-20260812-01', '2026-08-12', 'חופשה - עדן', 'עדן', 1, true),
  ('team-20260813-01', '2026-08-13', 'חופשה - גיל', 'גיל', 1, true),
  ('team-20260813-02', '2026-08-13', 'חופשה - טוני', 'טוני', 2, true),
  ('team-20260813-03', '2026-08-13', 'חופשה - עידן', 'עידן', 3, true),
  ('team-20260816-01', '2026-08-16', 'חופשה - עדן', 'עדן', 1, true),
  ('team-20260816-02', '2026-08-16', 'חופשה - טוני', 'טוני', 2, true),
  ('team-20260817-01', '2026-08-17', 'חופשה - עדן', 'עדן', 1, true),
  ('team-20260817-02', '2026-08-17', 'חופשה - טוני', 'טוני', 2, true),
  ('team-20260818-01', '2026-08-18', 'חופשה - עדן', 'עדן', 1, true),
  ('team-20260819-01', '2026-08-19', 'תחילת התיאומים', 'עדן', 1, true),
  ('team-20260827-01', '2026-08-27', 'מנהלי פעילות שולחים גאנט לאישור', 'עידן', 1, true),
  ('team-20260830-01', '2026-08-30', 'נהלי עבודה', 'עידן', 1, true),
  ('team-20260830-02', '2026-08-30', 'תיק נהלים - עמותה', 'עידן', 2, true),
  ('team-20260901-01', '2026-09-01', 'גיוס מדריכים', 'גיל', 1, true),
  ('team-20260901-02', '2026-09-01', 'קטלוג תוכניות - למידה מלאה', 'גיל', 2, true),
  ('team-20260901-03', '2026-09-01', 'קטלוג תוכניות - למידה מלאה', 'הילה', 3, true),
  ('team-20260901-04', '2026-09-01', 'קטלוג תוכניות - היכרות וידע בסיסי', 'עדן', 4, true),
  ('team-20260901-05', '2026-09-01', 'ביצוע שיבוצים', 'עדן', 5, true),
  ('team-20260901-06', '2026-09-01', 'גיוס מדריכים', 'עידן', 6, true),
  ('team-20260906-01', '2026-09-06', 'ספירת מלאי דפוס', 'גיל', 1, true),
  ('team-20260906-02', '2026-09-06', 'בקרת מלאי אצל המדריכים - דפוס', 'עדן', 2, true),
  ('team-20260906-03', '2026-09-06', 'הרמת כוסית - התאחדות התעשיינים', null, 3, true),
  ('team-20260907-01', '2026-09-07', 'הצגת תוצרים במפעל אסם', null, 1, true),
  ('team-20260907-02', '2026-09-07', 'מערכת הגפ״ן - חפיפה לכולם', 'עידן', 2, true),
  ('team-20260915-01', '2026-09-15', 'הכשרת מדריכים', 'מנהלים', 1, true),
  ('team-20260916-01', '2026-09-16', 'הכשרת מדריכים', 'מנהלים', 1, true),
  ('team-20260917-01', '2026-09-17', 'הכשרת מדריכים', 'מנהלים', 1, true)
on conflict (external_key) do update set
  event_date = excluded.event_date,
  title = excluded.title,
  owner_name = excluded.owner_name,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  updated_at = now();
