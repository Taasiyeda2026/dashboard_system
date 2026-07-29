-- Synchronize the active תשפ"ז proposal price list with the approved course table.
-- Historical proposal_agreement_items and locked proposal snapshots are intentionally not changed.

with course_data (
  short_name,
  full_name,
  gefen_number,
  meetings_count,
  hourly_price,
  hours_count,
  total_price,
  sort_order
) as (
  values
    ('ביומימיקרי', 'ביומימיקרי – המצאות בהשראה מן הטבע', '6089', 11::numeric, 600::numeric, 16.5::numeric, 9900::numeric, 1),
    ('טכנולוגיות החלל', 'טכנולוגיות החלל - חדשנות טכנולוגית בהשראת החלל', '57651', 10::numeric, 633::numeric, 15::numeric, 9500::numeric, 2),
    ('בינה מלאכותית', 'סודות ויסודות הבינה המלאכותית - חשיבה ביקורתית', '9545', 8::numeric, 640::numeric, 12.5::numeric, 8000::numeric, 3),
    ('ביומימיקרי לחטיבה', 'ביומימיקרי – חדשנות סביבתית-טכנולוגית בהשראה מן הטבע', '53828', 10::numeric, 633::numeric, 15::numeric, 9500::numeric, 4),
    ('יישומי AI בשיתוף GOOGLE', 'יישומי AI במציאות טכנולוגית חדשנית', '53819', 10::numeric, 633::numeric, 15::numeric, 9500::numeric, 5),
    ('רוקחים עולם', 'רוקחים עולם - יזמות לתחום הפארמצבטיקה', '46091', 14::numeric, 571::numeric, 21::numeric, 12000::numeric, 6),
    ('פורצות דרך', 'פורצות דרך וצועדות קדימה', '3604', 14::numeric, 571::numeric, 21::numeric, 12000::numeric, 7),
    ('אופק פרימיום', 'אופק יזמות פרימיום בתעשייה', '52279', 14::numeric, 643::numeric, 21::numeric, 13500::numeric, 8),
    ('משחקי קופסה', 'פיתוח ופיצוח משחקי לוח', '27342', 12::numeric, 550::numeric, 18::numeric, 9900::numeric, 9),
    ('מנהיגות ירוקה', 'מנהיגות ירוקה', '67867', 10::numeric, 640::numeric, 15::numeric, 9600::numeric, 10),
    ('השמיים אינם הגבול', 'השמיים אינם הגבול - תוכנית חלל', '57646', 10::numeric, 640::numeric, 15::numeric, 9600::numeric, 11)
)
update public.proposal_activity_pricing as pricing
set
  activity_name = course_data.full_name,
  name = course_data.full_name,
  title = course_data.full_name,
  program_name = course_data.full_name,
  meetings_count = course_data.meetings_count,
  hourly_price = course_data.hourly_price,
  hours_count = course_data.hours_count,
  unit_price = course_data.total_price,
  sort_order = course_data.sort_order,
  updated_at = now()
from course_data
where pricing.proposal_group = 'שנה הבאה'
  and pricing.gefen_number = course_data.gefen_number;

insert into public.proposal_gefen_courses (
  short_name,
  full_name,
  gefen_number,
  meetings_count,
  hourly_price,
  hours_count,
  total_price,
  sort_order,
  is_active,
  updated_at
)
values
  ('ביומימיקרי', 'ביומימיקרי – המצאות בהשראה מן הטבע', '6089', 11, 600, 16.5, 9900, 1, true, now()),
  ('טכנולוגיות החלל', 'טכנולוגיות החלל - חדשנות טכנולוגית בהשראת החלל', '57651', 10, 633, 15, 9500, 2, true, now()),
  ('בינה מלאכותית', 'סודות ויסודות הבינה המלאכותית - חשיבה ביקורתית', '9545', 8, 640, 12.5, 8000, 3, true, now()),
  ('ביומימיקרי לחטיבה', 'ביומימיקרי – חדשנות סביבתית-טכנולוגית בהשראה מן הטבע', '53828', 10, 633, 15, 9500, 4, true, now()),
  ('יישומי AI בשיתוף GOOGLE', 'יישומי AI במציאות טכנולוגית חדשנית', '53819', 10, 633, 15, 9500, 5, true, now()),
  ('רוקחים עולם', 'רוקחים עולם - יזמות לתחום הפארמצבטיקה', '46091', 14, 571, 21, 12000, 6, true, now()),
  ('פורצות דרך', 'פורצות דרך וצועדות קדימה', '3604', 14, 571, 21, 12000, 7, true, now()),
  ('אופק פרימיום', 'אופק יזמות פרימיום בתעשייה', '52279', 14, 643, 21, 13500, 8, true, now()),
  ('משחקי קופסה', 'פיתוח ופיצוח משחקי לוח', '27342', 12, 550, 18, 9900, 9, true, now()),
  ('מנהיגות ירוקה', 'מנהיגות ירוקה', '67867', 10, 640, 15, 9600, 10, true, now()),
  ('השמיים אינם הגבול', 'השמיים אינם הגבול - תוכנית חלל', '57646', 10, 640, 15, 9600, 11, true, now())
on conflict (gefen_number) do update
set
  short_name = excluded.short_name,
  full_name = excluded.full_name,
  meetings_count = excluded.meetings_count,
  hourly_price = excluded.hourly_price,
  hours_count = excluded.hours_count,
  total_price = excluded.total_price,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

do $$
begin
  if (
    select count(*)
    from public.proposal_activity_pricing
    where proposal_group = 'שנה הבאה'
      and gefen_number in ('6089','57651','9545','53828','53819','46091','3604','52279','27342','67867','57646')
  ) <> 11 then
    raise exception 'Expected 11 active next-year pricing rows after synchronization';
  end if;

  if (
    select count(*)
    from public.proposal_gefen_courses
    where is_active = true
      and gefen_number in ('6089','57651','9545','53828','53819','46091','3604','52279','27342','67867','57646')
  ) <> 11 then
    raise exception 'Expected 11 active GEFEN course rows after synchronization';
  end if;
end
$$;