insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('GEN-PASSOVER','פסח','חופשה','2027-04-13','2027-04-28','2027-04-29','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'ו׳–כ״א בניסן תשפ״ז','הלימודים יתחדשו ביום חמישי, 29 באפריל 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-PASSOVER','פסח ואסרו חג','חופשה','2027-04-13','2027-04-29','2027-04-30','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'ו׳–כ״ב בניסן תשפ״ז','הלימודים יתחדשו ביום שישי, 30 באפריל 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('DRUZE-SHUAYB','חג הנביא שועייב','חג','2027-04-24','2027-04-27',NULL,'עובדי הוראה דרוזים בבתי ספר יהודיים | דרוזי | בתי ספר יהודיים','חופשה',NULL,'י״ז–כ׳ בניסן תשפ״ז','ארבעה ימים','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-ASRU-PASSOVER','אסרו חג פסח','יום לימודים','2027-04-29','2027-04-29',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','יום לימודים',NULL,'כ״ב בניסן תשפ״ז','יום לימודים.','דורש אישור תיקון',TRUE,'השנה המודפסת 2026 אינה מתיישבת עם חופשת פסח תשפ״ז; התאריך התפעולי המוצע הוא 29 באפריל 2027.','https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('CHR-EAST-GOOD-FRIDAY','יום שישי הגדול','חג','2027-04-30','2027-04-30',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'כ״ג בניסן תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-EAST-EASTER','פסחא','חג','2027-05-02','2027-05-04',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'כ״ה–כ״ז בניסן תשפ״ז','שלושה ימים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('MEM-HOLOCAUST','יום הזיכרון לשואה ולגבורה','יום זיכרון','2027-05-04','2027-05-04',NULL,'כלל מוסדות החינוך | כללי | מוסדות החינוך; ימים אלה אינם ימי חופשה','יום לימודים',NULL,'כ״ז בניסן תשפ״ז','המחנכים יקדישו חלק מהשיעורים לזכר הנפטרים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('CHR-WEST-ASCENSION','העלייה השמיימה','חג','2027-05-06','2027-05-06',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'כ״ט בניסן תשפ״ז',NULL,'דורש אישור תיקון',TRUE,'6 במאי 2027 חל בכ״ט בניסן תשפ״ז, ולא בכ״ט באייר; התאריך הלועזי נשמר ומועד עברי דורש תיקון.','https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('MEM-FALLEN','יום הזיכרון לחללי צה״ל','יום זיכרון','2027-05-11','2027-05-11',NULL,'כלל מוסדות החינוך | כללי | מוסדות החינוך; ימים אלה אינם ימי חופשה','יום לימודים מקוצר','12:00','ד׳ באייר תשפ״ז','המחנכים יקדישו חלק מהשיעורים לזכר הנפטרים. הלימודים יסתיימו בשעה 12:00.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,TRUE,TRUE),
('GEN-INDEPENDENCE','יום העצמאות','חג','2027-05-12','2027-05-12',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'ה׳ באייר תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE)
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
