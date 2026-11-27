# חוזה עדכון חיצוני — מכרז גפ״ן 2027

ממשק העבודה הראשי: טבלת `public.gefen_tender_2027` (הרשאת מנהל בלבד, RLS).

## שכבות מידע

1. חומרי מקור ואסמכתאות — קישורים ל־SharePoint / Google Drive בתוך `payload`.
2. מידע עובדתי מצטבר — `payload.knowledge_items[]` (append-only).
3. טיוטות תשובות — שדות `details`, `associations[].questions[].answer`, מסמכים.
4. תשובות סופיות מאושרות — `payload.final_answers[question_key] = { text, token, approved_at }`.

מידע חדש במאגר **אינו** דורס תשובה מאושרת.

## RPC שמירה

`gefen_tender_2027_save(p_id text, p_expected_revision bigint, p_payload jsonb, p_mode text)`

מצבים:

| mode | שימוש |
|------|--------|
| `save_payload` | שמירת רשומה מלאה + יישוב אישורים |
| `set_answers` | עדכון טיוטות תשובות + יישוב אישורים |
| `append_knowledge` | הוספת פריטי ידע בלבד; לא נוגע ב־`final_answers` |

הגנות:

- רק `authenticated` עם `app_current_role() = 'admin'`.
- התאמת `revision` (optimistic concurrency).
- אישור תשובה מבוסס `token`; שינוי טקסט מבטל אישור; החזרת נוסח ישן **לא** מחזירה אישור.
- ידע מצטבר: פריטים קיימים לא נמחקים; כפילות לפי `id` נדחית.

## פריט ידע

```json
{
  "id": "uuid",
  "type": "עובדה",
  "content": "...",
  "source": "...",
  "source_url": "https://...",
  "source_date": "2026-11-27",
  "updated_at": "2026-11-27T00:00:00.000Z",
  "verification_status": "לא אומת",
  "related_questions": ["new.summary"],
  "notes": ""
}
```

## עדכון משיחת ChatGPT

1. להעתיק חבילת נתונים מהשאלה במסך ההגשה.
2. להכין תשובה / לחלץ עובדות חדשות.
3. להוסיף עובדות דרך הממשק או דרך `append_knowledge` עם `revision` עדכני.
4. להדביק טיוטה לשדה השאלה ולשמור; אישור סופי ידני בלבד.

אין להשתמש ב־service role מהדפדפן או משיחת ChatGPT ציבורית.
