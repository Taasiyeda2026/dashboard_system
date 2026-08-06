insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('SY5787-START','פתיחת שנת הלימודים תשפ״ז','פתיחת שנת לימודים','2026-09-01','2026-09-01',NULL,'כלל מערכת החינוך | כללי | גני ילדים, בתי ספר יסודיים, חטיבות ביניים וכל מוסדות החינוך הרשמי','יום לימודים',NULL,'י״ט באלול תשפ״ו','הלימודים יחלו בשעה הראשונה על־פי מערכת השעות הקבועה.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('DRUZE-SABALAN','יום הנביא סבלאן','חג','2026-09-10','2026-09-10',NULL,'עובדי הוראה דרוזים בבתי ספר יהודיים | דרוזי | בתי ספר יהודיים','חופשה',NULL,'כ״ח באלול תשפ״ו','יום אחד','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-ROSH-HASHANAH','ראש השנה','חופשה','2026-09-11','2026-09-13','2026-09-14','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'כ״ט באלול תשפ״ו עד ב׳ בתשרי תשפ״ז','הלימודים יתחדשו ביום שני, 14 בספטמבר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-ROSH-HASHANAH','ראש השנה','חופשה','2026-09-11','2026-09-13','2026-09-14','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'כ״ט באלול תשפ״ו עד ב׳ בתשרי תשפ״ז','הלימודים יתחדשו ביום שני, 14 בספטמבר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('FAST-GEDALIAH','צום גדליה','יום צום','2026-09-14','2026-09-14',NULL,'בתי ספר שבהם המורים והתלמידים צמים | יהודי | בתי ספר רלוונטיים','יום לימודים מקוצר','13:30','ג׳ בתשרי תשפ״ז','בבתי הספר שבהם המורים והתלמידים צמים, יום הלימודים יסתיים בשעה 13:30.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('GEN-YOM-KIPPUR','יום הכיפורים','חופשה','2026-09-20','2026-09-21',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'ט׳–י׳ בתשרי תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-YOM-KIPPUR','יום הכיפורים','חופשה','2026-09-20','2026-09-21','2026-09-22','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'ט׳–י׳ בתשרי תשפ״ז','הלימודים יתחדשו ביום שלישי, 22 בספטמבר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-BETWEEN-YK-SUKKOT','ימי חופשה בין יום הכיפורים לסוכות','חופשה','2026-09-22','2026-09-24',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'י״א–י״ג בתשרי תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('GEN-SUKKOT','חג הסוכות','חופשה','2026-09-25','2026-10-03','2026-10-04','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'י״ד–כ״ב בתשרי תשפ״ז','הלימודים יתחדשו ביום ראשון, 4 באוקטובר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-SUKKOT','חג הסוכות ואסרו חג','חופשה','2026-09-25','2026-10-04','2026-10-05','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'י״ד–כ״ג בתשרי תשפ״ז','הלימודים יתחדשו ביום שני, 5 באוקטובר 2026.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE)
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
