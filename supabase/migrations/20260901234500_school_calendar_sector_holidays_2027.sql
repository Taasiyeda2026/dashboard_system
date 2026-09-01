-- תשפ"ז 2026-2027: canonical school holiday ranges by sector.
-- Scheduling uses calendar_sector; shared calendars remain unfiltered.
-- Bedouin schools map to arab; Circassian schools map to druze.

-- Jewish calendar: align the main blocking rows with the approved holiday ranges.
update public.school_calendar
set title = 'סוכות',
    start_date = date '2026-09-25',
    end_date = date '2026-10-04',
    resume_date = date '2026-10-05',
    calendar_sector = 'jewish',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | יהודי | בתי ספר במגזר היהודי'
where external_key = 'GEN-SUKKOT';

-- 4.10 is already included in the Sukkot blocking range above; hide the old duplicate marker.
update public.school_calendar
set show_on_main_calendar = false,
    blocks_scheduling = false
where external_key = 'GEN-ASRU-SUKKOT';

-- Independence Day applies to all sectors in the supplied תשפ"ז calendar.
update public.school_calendar
set title = 'יום העצמאות',
    start_date = date '2027-05-12',
    end_date = date '2027-05-12',
    calendar_sector = 'general',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | כללי | כלל המגזרים'
where external_key = 'GEN-INDEPENDENCE';

-- Arabic-sector school holidays.
insert into public.school_calendar (
  id, external_key, title, category, start_date, end_date, resume_date,
  applies_to, day_status, blocks_scheduling, enforce_end_time,
  school_day_end_time, show_on_main_calendar, is_active, calendar_sector
) values
  (nextval('public.school_calendar_id_seq'), 'ARAB-WINTER-2027', 'חופשת חורף', 'חופשה', date '2026-12-24', date '2027-01-08', null,
   'לוח חופשות תשפ״ז | ערבי | בתי ספר במגזר הערבי והבדואי', 'חופשה', true, false, null, true, true, 'arab'),
  (nextval('public.school_calendar_id_seq'), 'ARAB-EID-FITR-2027', 'עיד אל־פיטר', 'חג', date '2027-03-09', date '2027-03-12', null,
   'לוח חופשות תשפ״ז | ערבי | בתי ספר במגזר הערבי והבדואי', 'חופשה', true, false, null, true, true, 'arab'),
  (nextval('public.school_calendar_id_seq'), 'ARAB-SPRING-2027', 'חופשת אביב', 'חופשה', date '2027-03-28', date '2027-04-13', null,
   'לוח חופשות תשפ״ז | ערבי | בתי ספר במגזר הערבי והבדואי', 'חופשה', true, false, null, true, true, 'arab'),
  (nextval('public.school_calendar_id_seq'), 'ARAB-EID-ADHA-2027', 'עיד אל־אדחא', 'חג', date '2027-05-16', date '2027-05-20', null,
   'לוח חופשות תשפ״ז | ערבי | בתי ספר במגזר הערבי והבדואי', 'חופשה', true, false, null, true, true, 'arab'),
  (nextval('public.school_calendar_id_seq'), 'ARAB-HIJRI-NEW-YEAR-2027', 'ראש השנה ההג׳רית', 'חג', date '2027-06-05', date '2027-06-06', null,
   'לוח חופשות תשפ״ז | ערבי | בתי ספר במגזר הערבי והבדואי', 'חופשה', true, false, null, true, true, 'arab')
on conflict (external_key) do update set
  title = excluded.title,
  category = excluded.category,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  resume_date = excluded.resume_date,
  applies_to = excluded.applies_to,
  day_status = excluded.day_status,
  blocks_scheduling = excluded.blocks_scheduling,
  enforce_end_time = excluded.enforce_end_time,
  school_day_end_time = excluded.school_day_end_time,
  show_on_main_calendar = excluded.show_on_main_calendar,
  is_active = excluded.is_active,
  calendar_sector = excluded.calendar_sector;

-- Druze-sector school holidays.
-- Reuse existing named holiday rows where they already exist.
update public.school_calendar
set title = 'חג הנביא סבלאן',
    start_date = date '2026-09-10',
    end_date = date '2026-09-10',
    calendar_sector = 'druze',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי'
where external_key = 'DRUZE-SABALAN';

update public.school_calendar
set title = 'חג הנביא אל־ח׳דר',
    start_date = date '2027-01-25',
    end_date = date '2027-01-25',
    calendar_sector = 'druze',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי'
where external_key = 'DRUZE-ELIJAH';

update public.school_calendar
set title = 'חג הנביא שועייב',
    start_date = date '2027-04-24',
    end_date = date '2027-04-30',
    calendar_sector = 'druze',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי'
where external_key = 'DRUZE-SHUAYB';

update public.school_calendar
set title = 'חג הקורבן / עיד אל־אדחא',
    start_date = date '2027-05-13',
    end_date = date '2027-05-22',
    calendar_sector = 'druze',
    category = 'חג',
    day_status = 'חופשה',
    blocks_scheduling = true,
    enforce_end_time = false,
    school_day_end_time = null,
    show_on_main_calendar = true,
    is_active = true,
    applies_to = 'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי'
where external_key = 'DRUZE-EID-ADHA';

insert into public.school_calendar (
  id, external_key, title, category, start_date, end_date, resume_date,
  applies_to, day_status, blocks_scheduling, enforce_end_time,
  school_day_end_time, show_on_main_calendar, is_active, calendar_sector
) values
  (nextval('public.school_calendar_id_seq'), 'DRUZE-WINTER-2027', 'חופשת חורף', 'חופשה', date '2026-12-23', date '2027-01-09', null,
   'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי', 'חופשה', true, false, null, true, true, 'druze'),
  (nextval('public.school_calendar_id_seq'), 'DRUZE-SPRING-2027', 'חופשת אביב', 'חופשה', date '2027-04-13', date '2027-04-23', null,
   'לוח חופשות תשפ״ז | דרוזי | בתי ספר במגזר הדרוזי והצרקסי', 'חופשה', true, false, null, true, true, 'druze')
on conflict (external_key) do update set
  title = excluded.title,
  category = excluded.category,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  resume_date = excluded.resume_date,
  applies_to = excluded.applies_to,
  day_status = excluded.day_status,
  blocks_scheduling = excluded.blocks_scheduling,
  enforce_end_time = excluded.enforce_end_time,
  school_day_end_time = excluded.school_day_end_time,
  show_on_main_calendar = excluded.show_on_main_calendar,
  is_active = excluded.is_active,
  calendar_sector = excluded.calendar_sector;

-- Ramadan is intentionally not inserted as a blocking holiday.
-- Shortened Ramadan hours can be added later only when an explicit time rule is supplied.
