# חשבונות עסקה — ממצאי investigation ומימוש מאושר

תאריך בדיקה: 21.08.2026.

מסמך זה מתעד את ההכרעות שעליהן מבוסס המימוש של חשבונות העסקה באזור הכספים. `activities` נשארת מקור האמת לפעילות; `finance_collection_tracking` נשארת שכבת מעקב גבייה נפרדת.

## מקור הנתונים וחוקי החישוב

- מפגשים נקראים מ־`activities.date_1..date_35` ונשמרת זהות **slot** (`date_1` = 1 וכו'). שני מפגשים באותו תאריך הם שני מפגשים נפרדים ואינם מתאחדים.
- מספר המפגשים המתוכנן לצורך מחיר לשעה נלקח מ־`activities.sessions` כאשר הוא מספר חיובי; בהיעדרו משתמשים במספר slots מתוזמנים.
- כל מפגש = 1.5 שעות.
- מחיר לשעה = `activities.price / (planned_meeting_count * 1.5)`.
- ביטולים נלקחים מ־`course_meeting_cancellations`; ביטול מוציא את המפגש מחיוב אך **אינו משנה את מכנה מחיר הפעילות**.
- מפגש נחשב שבוצע אם מועדו לפני cutoff. אם cutoff הוא היום, המפגש של היום נחשב רק לאחר `end_time`, לפי `Asia/Jerusalem`.
- במחזור הרגיל cutoff הוא היום האחרון של החודש הקודם.
- פחות משלושה מפגשים שבוצעו וטרם חויבו נדחים. שלושה ומעלה מחייבים את כל היתרה שבוצעה וטרם חויבה.
- closing bill מותר גם ל־1–2 מפגשים כאשר כל slots המתוכננים והלא־מבוטלים הסתיימו.
- מפגש שכבר נתפס בחשבון מזוהה לפי `(activity_row_id, meeting_slot)`, לא לפי תאריך בלבד.
- פעילות ללא סמל מוסד חסומה להפקה; אין איחוד לפי שם בית ספר בלבד.
- מספר הלקוח הוא סמל המוסד ושם הלקוח הוא שם בית הספר.
- כתובת נמען יכולה להגיע מהכתובת שנבחרה בתהליך ההפקה; אם אין כתובת כזו נשמר fallback של `activities.contact_email`. בהיעדר נמען החשבון נשמר אך טיוטת Outlook אינה נוצרת.

## מודל הנתונים

המיגרציה `20260821190000_finance_transaction_accounts.sql` מוסיפה:

1. `finance_transaction_account_number_seq`, החל מ־8525.
2. `finance_transaction_accounts` — snapshot של המסמך, הלקוח, סטטוס המסמך/גבייה/Outlook ומטא־דאטה של הקובץ.
3. `finance_transaction_account_lines` — snapshot של כל פעילות וסכום החיוב שלה.
4. `finance_transaction_account_meetings` — snapshot של slot, תאריך ו־1.5 שעות, עם unique על `(activity_row_id, meeting_slot)`.
5. `reserve_finance_transaction_account` — reservation אידמפוטנטי; השרת מחשב מחדש את כל slots הזכאים ודורש שהבחירה שקיבל תואמת בדיוק למקור האמת.
6. `finalize_finance_transaction_account` — מעבר ל־issued רק דרך backend/service role לאחר יצירת PDF והעלאה מוצלחת.
7. `mark_finance_transaction_outlook` — עדכון מצב הטיוטה דרך backend/service role בלבד.
8. `cancel_generating_finance_transaction_account` — שחרור reservation תקוע בלי למחזר את מספר החשבון.

רשומות `generating` הן claims זמניים ואינן מוצגות כהיסטוריית חיוב רגילה דרך RLS. הן עדיין תופסות את slot ברמת DB כדי למנוע שתי הפקות מקבילות על אותו מפגש.

Finance מקבל הרשאת קריאה לביטולי מפגשים כדי שה־UI והשרת ישתמשו באותה אמת.

## PDF

ה־Edge Function `finance-transaction-accounts` מייצר PDF A4 אמיתי באמצעות `pdf-lib`, `fontkit`, Arimo ו־`bidi-js`.

המסמך כולל:
- header קומפקטי עם פרטי תעשיידע ולוגו.
- תאריך הפקה.
- `חשבון עסקה | {NUMBER} | מקור`.
- שם בית ספר וסמל מוסד.
- `תוכניות חינוכיות – שנת תשפ"ז`.
- טבלה: תוכנית / פעילות, מס׳ גפ״ן, שעות לחיוב, מחיר לשעה, סכום.
- מתחת לכל פעילות: `פירוט ביצוע לחיוב` עם תאריך ושעות בלבד.
- סה"כ לתשלום.

הטקסט נשאר selectable/searchable; אין screenshot או canvas.

## SharePoint ו־Outlook

- ה־PDF נשמר בתיקיית SharePoint שנבחרה.
- ה־Edge Function מאמת שה־`driveId` הוא drive מאושר ומוודא ש־`folderItemId` הוא תיקייה באותו drive לפני upload.
- retry של אותו חשבון מחליף את אותו קובץ בעל שם ייחודי לפי מספר החשבון, במקום להיתקע על filename collision.
- לאחר finalize נוצרת טיוטת Outlook בלבד, עם ה־PDF מצורף וללא קישור SharePoint.
- טיוטה שכבר נוצרה אינה נוצרת שוב ב־retry.
- כשל Outlook אינו מבטל חשבון שכבר הופק ונשמר.

נוסח המייל:

```text
שלום,

מצורף חשבון עסקה מס׳ {NUMBER} עבור הפעילויות שבוצעו בתקופה הרלוונטית.

נשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.
```

## אבטחה ושלמות חשבונאית

- מספרים מוקצים בשרת מרצף גלובלי שמתחיל ב־8525.
- reservation משתמש ב־advisory lock וב־idempotency key.
- הפעילות ננעלת בזמן חישוב reservation והשרת מאמת מחדש סמל מוסד, cutoff, ביטולים, slots, מחיר ומספר מפגשים.
- `finalize` ו־`mark_outlook` אינם ניתנים להפעלה ישירה על ידי משתמש authenticated; הם backend-only דרך service role.
- SharePoint target מוגבל ל־drive המאושר.
- Snapshot שהופק אינו מחושב מחדש מנתוני פעילות עתידיים.

## גבולות המימוש הנוכחי

מסך בקרת הגבייה מציג את שכבת הביצוע והחיוב וה־API/backend קיימים. ממשק מלא לבחירת תיקיית SharePoint, מסך אישור סבב מפורט והיסטוריית חשבונות אינטראקטיבית הם שכבת UI נוספת ואינם חלק מה־diff הנוכחי.
