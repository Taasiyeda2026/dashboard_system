insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('CHR-EAST-NEW-YEAR','ראשית השנה','חג','2027-01-14','2027-01-14',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'ו׳ בשבט תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-EAST-EPIPHANY','ההתגלות','חג','2027-01-19','2027-01-19',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'י״א בשבט תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-TU-BISHVAT','ט״ו בשבט','יום לימודים','2027-01-23','2027-01-23',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','יום לימודים',NULL,'ט״ו בשבט תשפ״ז','חל ביום שבת.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('ULP-TU-BISHVAT','ט״ו בשבט','יום לימודים','2027-01-23','2027-01-23',NULL,'עובדי הוראה באולפנים | יהודי | אולפנים','יום לימודים',NULL,'ט״ו בשבט תשפ״ז','יום לימודים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('DRUZE-ELIJAH','חג הנביא אליהו – עיד אל חד׳ר','חג','2027-01-25','2027-01-25',NULL,'עובדי הוראה דרוזים בבתי ספר יהודיים | דרוזי | בתי ספר יהודיים','חופשה',NULL,'י״ז בשבט תשפ״ז','יום אחד','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-TAANIT-ESTHER','תענית אסתר','יום צום','2027-03-22','2027-03-22',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','יום לימודים מקוצר','13:30','י״ג באדר ב׳ תשפ״ז','יום לימודים. בבתי ספר שבהם המורים והתלמידים צמים, יום הלימודים יסתיים בשעה 13:30.','דורש אישור תיקון',TRUE,'בהערת פורים נכתב 2026, אך בסעיף ימי צום ובמבנה שנת תשפ״ז מופיע 22 במרס 2027.','https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,TRUE,TRUE),
('ULP-PURIM','תענית אסתר ופורים','חופשה','2027-03-22','2027-03-24','2027-03-25','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'י״ג–ט״ו באדר ב׳ תשפ״ז','הלימודים יתחדשו ביום חמישי, 25 במרס 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-PURIM','פורים','חופשה','2027-03-23','2027-03-24','2027-03-25','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'י״ד–ט״ו באדר ב׳ תשפ״ז','הלימודים יתחדשו ביום חמישי, 25 במרס 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('CHR-WEST-GOOD-FRIDAY','יום שישי הגדול','חג','2027-03-26','2027-03-26',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'י״ז באדר ב׳ תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-WEST-EASTER','פסחא','חג','2027-03-28','2027-03-30',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'י״ט–כ״א באדר ב׳ תשפ״ז','שלושה ימים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE)
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
