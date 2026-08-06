insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('CHR-EAST-PENTECOST','שבועות','חג','2027-06-20','2027-06-21',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'ט״ו–ט״ז בסיוון תשפ״ז','יומיים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('SY5787-END-ELEM','סיום שנת הלימודים – גנים ויסודי','סיום שנת לימודים','2027-06-30','2027-06-30',NULL,'כלל מערכת החינוך | כללי | גני ילדים ובתי ספר יסודיים','אירוע מידע',NULL,'כ״ה בסיוון תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('FAST-17-TAMMUZ','שבעה עשר בתמוז','יום צום','2027-07-22','2027-07-22',NULL,'בתי ספר שבהם המורים והתלמידים צמים | יהודי | בתי ספר רלוונטיים','יום לימודים מקוצר','13:30','י״ז בתמוז תשפ״ז','בבתי הספר שבהם המורים והתלמידים צמים, יום הלימודים יסתיים בשעה 13:30.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('FAST-9-AV','תשעה באב','יום צום','2027-08-12','2027-08-12',NULL,'בתי ספר שבהם המורים והתלמידים צמים | יהודי | בתי ספר רלוונטיים','יום לימודים מקוצר','13:30','ט׳ באב תשפ״ז','בבתי הספר שבהם המורים והתלמידים צמים, יום הלימודים יסתיים בשעה 13:30.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('SY5788-START','פתיחת שנת הלימודים תשפ״ח','פתיחת שנת לימודים','2027-09-01','2027-09-01',NULL,'כלל מערכת החינוך | כללי | גני ילדים, בתי ספר יסודיים, חטיבות ביניים וכל מוסדות החינוך הרשמי','יום לימודים',NULL,'כ״ט באב תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('MUS-MAWLID','יום הולדת הנביא מוחמד','חג',NULL,NULL,NULL,'עובדי הוראה מוסלמים בבתי ספר יהודיים | מוסלמי | בתי ספר יהודיים','חופשה',NULL,NULL,'יום אחד. התאריכים המדויקים יישלחו על־ידי מנהלת אגף חינוך בחברה הערבית.','ממתין לפרסום רשמי',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,FALSE),
('MUS-EID-ADHA','עיד אל־אדחא','חג',NULL,NULL,NULL,'עובדי הוראה מוסלמים בבתי ספר יהודיים | מוסלמי | בתי ספר יהודיים','חופשה',NULL,NULL,'ארבעה ימים. התאריכים המדויקים יישלחו על־ידי מנהלת אגף חינוך בחברה הערבית.','ממתין לפרסום רשמי',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,FALSE),
('MUS-EID-FITR','עיד אל־פיטר','חג',NULL,NULL,NULL,'עובדי הוראה מוסלמים בבתי ספר יהודיים | מוסלמי | בתי ספר יהודיים','חופשה',NULL,NULL,'שלושה ימים. התאריכים המדויקים יישלחו על־ידי מנהלת אגף חינוך בחברה הערבית.','ממתין לפרסום רשמי',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,FALSE),
('MUS-MUHARRAM','ראשון למוחרם – ראש השנה ההג׳רית','חג',NULL,NULL,NULL,'עובדי הוראה מוסלמים בבתי ספר יהודיים | מוסלמי | בתי ספר יהודיים','חופשה',NULL,NULL,'יום אחד. התאריכים המדויקים יישלחו על־ידי מנהלת אגף חינוך בחברה הערבית.','ממתין לפרסום רשמי',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,FALSE)
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
