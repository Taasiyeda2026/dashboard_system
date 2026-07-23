insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('GEN-ASRU-SUKKOT','אסרו חג סוכות','יום לימודים','2026-10-04','2026-10-04',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','יום לימודים',NULL,'כ״ג בתשרי תשפ״ז','יום לימודים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('MEM-OCT7','יום הזיכרון הלאומי לאירועי 7 באוקטובר','יום זיכרון','2026-10-05','2026-10-05',NULL,'כלל מוסדות החינוך | כללי | מוסדות החינוך; ימים אלה אינם ימי חופשה','יום לימודים',NULL,'כ״ד בתשרי תשפ״ז','המחנכים יקדישו חלק מהשיעורים לזכר הנפטרים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('MEM-RABIN','יום הזיכרון ליצחק רבין ז״ל','יום זיכרון','2026-10-22','2026-10-22',NULL,'כלל מוסדות החינוך | כללי | מוסדות החינוך; ימים אלה אינם ימי חופשה','יום לימודים',NULL,'י״א בחשוון תשפ״ז','המחנכים יקדישו חלק מהשיעורים לזכר הנפטרים. הוקדם.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('GEN-HANUKKAH','חנוכה','חופשה','2026-12-06','2026-12-12','2026-12-13','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'כ״ו בכסלו עד ב׳ בטבת תשפ״ז','הלימודים יתחדשו ביום ראשון, 13 בדצמבר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-HANUKKAH','חנוכה','חופשה','2026-12-06','2026-12-12','2026-12-13','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'כ״ו בכסלו עד ב׳ בטבת תשפ״ז','הלימודים יתחדשו ביום ראשון, 13 בדצמבר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('FAST-10-TEVET','עשרה בטבת','יום צום','2026-12-20','2026-12-20',NULL,'בתי ספר שבהם המורים והתלמידים צמים | יהודי | בתי ספר רלוונטיים','יום לימודים מקוצר','13:30','י׳ בטבת תשפ״ז','בבתי הספר שבהם המורים והתלמידים צמים, יום הלימודים יסתיים בשעה 13:30.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('CHR-WEST-CHRISTMAS','חג המולד','חג','2026-12-24','2026-12-26',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'י״ד–ט״ז בטבת תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-WEST-NEW-YEAR','ראשית השנה','חג','2027-01-01','2027-01-01',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'כ״ב בטבת תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-WEST-EPIPHANY','ההתגלות','חג','2027-01-06','2027-01-06',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'כ״ז בטבת תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-EAST-CHRISTMAS','חג המולד','חג','2027-01-06','2027-01-08',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'כ״ז–כ״ט בטבת תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE)
on conflict (external_key) do update set
  title = excluded.title,
  category = excluded.category,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  resume_date = excluded.resume_date,
  applies_to = excluded.applies_to,
  day_status = excluded.day_status,
  school_day_end_time = excluded.school_day_end_time,
  hebrew_date = excluded.hebrew_date,
  notes = excluded.notes,
  date_status = excluded.date_status,
  source_discrepancy = excluded.source_discrepancy,
  discrepancy_note = excluded.discrepancy_note,
  source_url = excluded.source_url,
  show_on_main_calendar = excluded.show_on_main_calendar,
  blocks_scheduling = excluded.blocks_scheduling,
  enforce_end_time = excluded.enforce_end_time,
  is_active = excluded.is_active,
  updated_at = now();
