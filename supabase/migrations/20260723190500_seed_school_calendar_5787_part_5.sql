insert into public.school_calendar (
  external_key, title, category, start_date, end_date, resume_date, applies_to, day_status, school_day_end_time, hebrew_date, notes, date_status, source_discrepancy, discrepancy_note, source_url, show_on_main_calendar, blocks_scheduling, enforce_end_time, is_active
)
values
('ULP-INDEPENDENCE','יום העצמאות','חג','2027-05-12','2027-05-12',NULL,'עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'ה׳ באייר תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('DRUZE-EID-ADHA','חג הקורבן','חג','2027-05-16','2027-05-20',NULL,'עובדי הוראה דרוזים בבתי ספר יהודיים | דרוזי | בתי ספר יהודיים','חופשה',NULL,'ז׳–י״א באייר תשפ״ז','חמישה ימים: יום לפני החג וארבעת ימי החג','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-WEST-PENTECOST','שבועות','חג','2027-05-16','2027-05-17',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | קתולים, לטינים, אנגליקנים ומרונים','חופשה',NULL,'ט׳–י׳ באייר תשפ״ז','יומיים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-LAG-BAOMER','ל״ג בעומר','יום לימודים','2027-05-25','2027-05-25',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','יום לימודים',NULL,'י״ח באייר תשפ״ז','יום לימודים.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('ULP-LAG-BAOMER','ל״ג בעומר','חג','2027-05-25','2027-05-25',NULL,'עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'י״ח באייר תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-SHAVUOT','חג השבועות','חופשה','2027-06-10','2027-06-11','2027-06-13','לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','חופשה',NULL,'ה׳–ו׳ בסיוון תשפ״ז','הלימודים יתחדשו ביום ראשון, 13 ביוני 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,TRUE,FALSE,TRUE),
('ULP-SHAVUOT','חג השבועות ואסרו חג','חופשה','2027-06-10','2027-06-12','2027-06-13','עובדי הוראה באולפנים | יהודי | אולפנים','חופשה',NULL,'ה׳–ז׳ בסיוון תשפ״ז','הלימודים יתחדשו ביום ראשון, 13 ביוני 2027.','מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('CHR-EAST-ASCENSION','העלייה השמיימה','חג','2027-06-10','2027-06-10',NULL,'עובדי הוראה נוצרים בבתי ספר יהודיים | נוצרי | בתי ספר יהודיים | יוונים, אורתודוקסים וארמנים','חופשה',NULL,'ה׳ בסיוון תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',FALSE,FALSE,FALSE,TRUE),
('GEN-ASRU-SHAVUOT','אסרו חג שבועות','הערת לוח','2027-06-12','2027-06-12',NULL,'לוח כללי | יהודי | גני ילדים, יסודי, חטיבות ביניים, חינוך רשמי בחינוך הרגיל למעט חטיבות עליונות, וכל מוסדות החינוך המיוחד','אירוע מידע',NULL,'ז׳ בסיוון תשפ״ז','חל ביום שבת.','דורש אישור תיקון',TRUE,'השנה המודפסת 2026 אינה מתיישבת עם רצף חג השבועות תשפ״ז; התאריך התפעולי המוצע הוא 12 ביוני 2027.','https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE),
('SY5787-END-SEC','סיום שנת הלימודים – חטיבות ועל־יסודי','סיום שנת לימודים','2027-06-20','2027-06-20',NULL,'כלל מערכת החינוך | כללי | חטיבות ביניים, מפת״נים ומוסדות החינוך הרשמי בחטיבה העליונה','אירוע מידע',NULL,'ט״ו בסיוון תשפ״ז',NULL,'מופיע בחוזר',FALSE,NULL,'https://apps.education.gov.il/mankal/Hodaa.aspx?siduri=362#_Toc256000011',TRUE,FALSE,FALSE,TRUE)
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
