# חשבונות עסקה וגבייה — מימוש לסקירה

המימוש מחליף את כללי הסף וההפקה הידנית הישנים. הוא כולל את העדכון האחרון בקובץ המשתמש: תשלום מלא מראש מטופל בחשבון ידני המכסה את מלוא חלק המממן, ולא במנגנון מקדמות וקיזוזים.

## מקור אמת וזכאות

- `activities.date_1..date_35`, מספר המפגשים, מחיר הפעילות וחלוקת `activity_funding_sources` הם מקור הנתונים. נוכחות אינה תנאי לביצוע. ביטולים נלקחים מ־`course_meeting_cancellations`.
- תאריך היום נחשב רק לאחר שעת הסיום בישראל. זהות slot נשמרת גם במפגשים באותו יום ובהזזת מועדים.
- גפ״ן: מפגשים שבוצעו בחודש שהסתיים, גם מפגש יחיד. יתר המממנים: לאחר השלמת כל התכנון, עם חודש סיום לפי התאריכים המעודכנים.
- בכל לשונית יש בחירת חודש, ברירת מחדל לחודש האחרון שהסתיים וקבוצת יתרות מחודשים אחרים. שורה אינה נכללת גם בקבוצה וגם בסיכום החודש.
- מקור הנתונים המחייב לחשבונות העסקה הוא פעילויות תשפ״ז (`activity_season = school_2027`) כפי שמוצגות ב״כל הפעילויות״ / ״פעילויות תשפ״ז״. מחיר, מפגשים, מועדים וחלוקת מימון נלקחים מרשומות אלה בלבד.
- חלוקה חסרה/שאינה תואמת למחיר, זהות רשות חסרה וחשבונות היסטוריים ללא שיוך מממן מוצגים לבירור; אין חלוקת סכומים משוערת.

## זהות מממן ומניעת כפילות

כל חישוב נשען על מזהה המממן. רשות מקומית מזוהה לפי `authority_id` ושם מקטלוג הרשויות, בית ספר לפי מזההו וסמל המוסד, ושאר מממנים לפי מזהה קטלוג המימון. המפתח נשמר במסמך ובתקבולים; שמות תצוגה אינם מפתח לאיחוד רשויות.

תפיסת מפגשים היא לפי פעילות, מממן ו־slot, עם סכום ועם סימון כיסוי מלא. הסכומים מחושבים ונבדקים מחדש בשרת תחת נעילות הפעילות; גם שינוי ידני חלקי נשאר כפוף ליתרה הכספית. מפגש שכוסה במלואו לא נפתח מחדש אוטומטית בעקבות שינוי מחיר. תפיסות שנתקעו פגות לאחר 15 דקות.

## הפקה ידנית

המסלול הוא פעילות קיימת → מממן ובסיס חיוב → עריכת מסמך → PDF מקדים → אישור והפקה. העריכה משנה snapshots בלבד. תיאור, פרטי לקוח, כמות, שעות, מחיר וסכום נבדקים בשרת; שינוי מועדי מסמך מתנאי ברירת המחדל מחייב מנהל וסיבה מתועדת.

בבסיס ״מלוא חלק המממן״ ניתן להפיק לפני ביצוע. החשבון מכסה את מלוא יתרת אותו מממן, ללא סימון מפגשים עתידיים כמבוצעים. סכום זה צורך את מסגרת המימון ומונע חיוב אוטומטי נוסף; חלקי מממנים אחרים ממשיכים כרגיל. הפרש במסגרת לאחר כיסוי מלא מוצג לטיפול כספים ואינו משנה את המסמך ההיסטורי.

## חשבון מרוכז לגורם מממן (לא גפ״ן)

- גפ״ן נשאר במסלול חודשי לפי בית ספר ומפגשים שבוצעו; חשבונות של שני בתי ספר לא מאוחדים.
- יתר גורמי המימון מופקים בחשבון אחד לכל זהות משלם, גם כשהפעילויות מבוצעות בבתי ספר שונים. במסלול החיוב הרגיל האיחוד מתבצע במסגרת חודש סיום פעילות; במימון מראש אפשר לבחור פעילויות ממועדי סיום שונים ולהפיק חשבון ידני אחד.
- הפקה ידנית של יותר מפעילות אחת מחייבת בחירת גורם מימון, מציגה PDF אחד עם שורה וסכום לכל פעילות, ומבצעת שריון אטומי של החשבון כולו. אין הפקת 20 מסמכים עבור 20 פעילויות של אותו מממן.
- אימות בשרת אוסר ערבוב מממנים, ערבוב רשויות שונות, ערבוב גפ״ן, או סכומים גדולים מיתרת המימון המותרת. בחיוב מלא מראש כל שורה צורכת את מלוא חלקו של המממן בפעילות ומונעת חיוב נוסף.
- תקבול אחד נרשם מול החשבון המרוכז ומחולק לשורות הפעילויות לצורך מעקב גבייה ויתרת מימון. תקבול מחוץ לחשבון דורש שיוך מפורש.
- תצוגה מקדימה בלבד אינה יוצרת חוב. בזמן אישור השרת נועל מחדש את הפעילויות, מחשב את כל החיובים ומוודא שלא חל שינוי מאז התצוגה.

## גבייה ותקבולים

- חשבון שהופק הוא יחידת הגבייה, עם מזהה קבוע. `generating` אינו חוב שהופק; חשבון מבוטל נשמר בהיסטוריה ואינו חוב פעיל.
- שוטף + 30 לגפ״ן וליתר המממנים; שוטף + 45 לוויצו ולרשות. המועד נשמר בשרת ומוצג במסמך ובגבייה.
- תשלום נרשם עם סכום, תאריך בפועל, משלם, משתמש ואסמכתה אופציונלית. שיוך יכול להתחלק בין חשבונות של אותו משלם בלבד, בכפוף ליתרת התקבול והחשבון.
- פעולות רישום ושיוך אידמפוטנטיות. ניסיונות חוזרים אינם מקצים שוב את אותו סכום.
- יתרה חיובית נשארת בפתוח; יתרה אפס עוברת לארכיון כתצוגה בלבד. איחור נגזר ממועד הפירעון ומהיתרה. צפי והערה נשארים ניתנים לעריכה.
- תיקון תקבול מחייב סיבה ורושם התקבול או מנהל, משחרר את השיוכים ופותח מחדש את היתרות באופן אטומי. ביטול חשבון שהופק מחייב מנהל וסיבה, משמר את ה־PDF ואת היסטוריית התקבולים ומאפשר שיוך מפורש של תקבול לחשבון חלופי.
- אין טענה לאימות בנקאי אוטומטי. אין רישום אוטומטי של תקבול עקב סימון הפעילות כ״סגורה״.

## מסמך ומשלוח

שרת ההפקה נועל את ההפקה ובודק שוב זכאות וסכומים לפני יצירת המסמך ולפני finalize. ה־PDF כולל את פרטי המממן, בית הספר, תקופה או כיסוי מלא, כמות, שעות, סכום ומועד תשלום. ניסיון חוזר בחשבון שהופק משתמש בקובץ המקורי ובודק את ה־hash. שחזור טיוטת Outlook נעזר במזהה חשבון קבוע, ללא שליחת מייל.

כשל או תשובה שאבדה מ־finalize אינם מוחקים מסמך שכבר הופק. רק ביטול מאומת של reservation מאפשר ניקוי קובץ זמני. מספרי חשבונות אינם ממוחזרים.

## בדיקות ופריסה

נבדקו PostgreSQL מקומי חד־פעמי, כללי זכאות וסכומים, הקצאות מקבילות, תשלומים וחזרה לארכיון/ממנו, מלא/חלקי/מוקדם/מאוחר, עריכת חשבון, הפרדת רשויות, מקור פעילות עדכני, ממשק, PDF אמיתי ו־SharePoint/Outlook מדומים. לא הופקו מסמכי ייצור, לא נשלחו מיילים ולא נרשמו תקבולים בייצור.

שתי המיגרציות החדשות משלימות זו את זו ויש להחיל את שתיהן לפני הפעלת הקוד החדש. לאחר אישור בלבד: מיגרציות, Edge Function ואז Frontend. מסמכים ישנים ללא שיוך מממן/תקבולים מפורטים מחייבים בירור נתונים לפני חיוב נוסף או הצגתם כמשולמים מאומתים. rollback לאחר יצירת מסמכים חדשים צריך לשמר snapshots, שיוכים והיסטוריית ביקורת; אין למחוק טבלאות כספיות לשם חזרה לגרסה קודמת.

הענף `fix/finance-collection-activity-source-20261030` נבדק מול בסיס `b64678ea`; אומצו ממנו העדפת תאריכי מפגשים עדכניים וחישובי מעקב רלוונטיים בלבד.

### Account-only automatic Gefen billing (26 November 2026)

The automatic Gefen school account has one compact row per activity/funding group.
Meeting count, total billable hours and hourly rate are independently editable.
The line total is `round(hours × hourly rate, 2)`; count edits do not change hours.
Source activity values are defaults only. The extended completion form remains
available in its dedicated tab and is not embedded in automatic issuance.

`finance_billing_preview` returns `billingSourceRevision` for each untouched
monthly row. `finance_gefen_billing_quote(date,jsonb)` is the canonical PDF and
reservation quote. `reserve_finance_gefen_billing_account(uuid,date,jsonb,text)`
locks the source activities, verifies that quote and reuses the original slot
reservation/numbering machinery before atomically applying the account values.
Single-school and bulk issuance use these same APIs. Lost-response retries keep
the same request identity and quote; issued reservations are never repriced.

Monthly accounting lines split aggregate count (integer), hours (six decimals)
and amount (cents) deterministically, with sums equal to the user's group values.
`billing_override_snapshot` retains the untouched source row and the chosen group
values. Actual meeting rows and claims cover only the original eligible slots,
regardless of the invoice count. Those slots are settled to prevent duplicate
billing; claim amounts sum to the edited invoice amount. The funding ceiling
still applies across current and previous accounts. This does not create more
billable activity slots when invoice count increases or reduce their number when
it decreases. Existing activity/funding/order records are never updated.

Dispatch revalidates the original source revision and funding balance while
retaining the chosen account values. A changed source requires a refresh.
Previously issued accounts and non-Gefen paths retain their existing behavior.
Historical explicit account rate edits are excluded only from the prior-rate
mismatch rule; the other source/order eligibility checks remain active.

Deploy migration `20261126164927_finance_gefen_invoice_billing_overrides.sql`
first, then the full finance Edge sources, then the frontend (cache 2147).
The migration is backward compatible with existing clients; both new RPCs enforce
existing issue permissions and are not callable by anonymous clients. Do not run
`supabase config push` or unrelated migrations. Capture a fresh scoped financial
snapshot and the three replaced function definitions before application.
For recovery prefer a forward fix; do not remove account provenance or restore
financial rows over business activity recorded after the checkpoint. Once edited
accounts exist, preserve the new PDF renderer and dispatch validation on rollback.

Acceptance uses disposable PostgreSQL, synthetic local UI fixtures and mocked
Microsoft calls with real PDF generation. Never issue fictitious production
accounts or send test messages. A zero source-hour service stays zero until the
user supplies billable hours; no activity hours are fabricated.
