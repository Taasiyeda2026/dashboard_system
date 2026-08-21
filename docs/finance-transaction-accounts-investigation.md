# חשבונות עסקה — ממצאי investigation ותכנית מימוש

תאריך הבדיקה: 21.08.2026. מסמך זה הוא שער האישור לפני יצירת migration או כתיבה
לסביבת production; הוא אינו משנה נתונים, סכמות או התנהגות אפליקטיבית.

## מצב repository

ה־checkout שסופק נמצא על branch מקומי בשם `work` וללא remote מוגדר. לכן לא ניתן
היה לבצע `fetch/pull` מ־`main`. הוקם ממנו branch ממוקד
`feat/finance-transaction-accounts`. לפני תחילת implementation יש לחבר את remote,
לבצע rebase על `origin/main`, ולפתור פערים אם קיימים.

## מה קיים וניתן למחזר

* מסך הכספים כבר מפריד בין נוכחות לבין גבייה, אוכף הרשאות
  `admin/finance/finance_access/view_finance`, טוען פעילויות דרך ה־API ושומר נתוני
  מעקב גבייה בלי לשנות את הפעילות.
* `finance-collection.js` מרכז normalization, זיהוי `row_id`, חלוקה לפי גורם
  מממן/בית ספר, חיפוש, סכומים וסטטוס פתוח/סגור. יש להרחיב את תצוגת הגבייה תוך
  שימוש בפונקציות האלה, ולא להחליפן.
* `finance-attendance-summary.js` הוא תחום נפרד; אין צורך לשנותו. כך נשמרת תאימות
  למסך הנוכחות.
* `finance_collection_tracking` היא בכוונה טבלה צרה: מפתח לפעילות, סטטוס גבייה,
  צפי והערה. ה־RLS והפונקציה `app_can_access_finance()` הם החוזה שיש למחזר.
* פעילויות הן מקור האמת: `activities.row_id`, `activity_name`, `activity_no`
  (מספר גפ״ן), `price`, `sessions`, `school`, `school_id`, `school_contact_id`,
  `start_date`, `end_date`, ו־`date_1..date_35`.
* קורא התאריכים המשותף `getActivityDateColumns` כבר מטפל בעמודות התאריכים
  הקנוניות ובווריאנטים ישנים. ביטולים נשמרים ב־`course_meeting_cancellations`
  לפי פעילות ותאריך, ו־`course-scheduling-meetings.js` כבר מצרף אותם לפעילות.
  חישובי כספים ישתמשו באותם מקורות אך לא ישנו קוד תפעולי.
* שפת העיצוב הטבלאית של הצעות המחיר קיימת ב־`proposals-agreements.js` ובתיקוני
  המסמך המאושר. ניתן למחזר את העקרונות החזותיים, אך לא את מנגנון ההדפסה של DOM.
* קיימת תשתית PDF אמיתי בצד Edge: `pdf-lib`, `fontkit`, פונטי Arimo ו־`bidi-js`.
  היא כבר יוצרת A4 עם טקסט מוטמע/selectable בעברית. זה הבסיס הנכון למסמך החדש.
* קיימת אינטגרציית Microsoft Graph בשני אופנים: client-credentials ב־Edge לשמירה
  ב־SharePoint, ו־MSAL delegated עם `Mail.ReadWrite` ליצירת טיוטה והוספת קובץ.
  מנגנון תיאום הפעילות כולל idempotency/retry לטיוטות וניתן למחזר את הדפוס שלו.

## מקורות נתונים וחוקי חישוב

1. מפגשים מתוכננים ייקראו מ־`activities.date_1..date_35`; `sessions` ישמש רק
   לבדיקת עקביות/כמות מתוכננת כאשר הוא מספר תקין.
2. מפגש שבוצע הוא תאריך ISO שאינו מאוחר מ־cutoff ואינו מופיע בטבלת הביטולים.
3. מפגש שכבר נמצא בטבלת snapshot של חשבון לא יהיה מועמד שוב. הגנה סופית תהיה
   unique DB על `(activity_row_id, meeting_date)`.
4. מחיר המקור הוא `activities.price`. הוא יומר ל־numeric באופן מפורש; ערך לא
   תקין יוצג כחריגה ולא יחויב בשקט.
5. `school_id` הוא מזהה פנימי ואינו בהכרח סמל מוסד. סמל המוסד ייקרא מ־`schools`
   או `contacts_schools.semel_mosad`; פעילות ללא סמל תסומן כחסומה ולא תאוחד לפי
   שם בלבד.
6. כתובת המייל תילקח מ־`school_contact_id` אל `contacts_schools` ומהמייל הראשי
   ב־`contact_emails`. בהיעדרה החשבון יישמר, אך טיוטה לא תיווצר.

כללי 1.5 שעות, סף שלושה מפגשים, צבירת מפגשים ישנים ו־closing bill יחושבו
בפונקציית preview משותפת. חישוב כספי יישמר ב־`numeric` בדיוק מלא; רק סכום השורה
והמסמך יעוגלו לאגורות. בשורת הסיום יותאם ההפרש כך שסך החיובים לפעילות יהיה בדיוק
מחיר הפעילות.

## תכנית migration (דורשת אישור לפני הפעלה)

Migration יחיד, הפיך לוגית וללא backfill של נתוני פעילות:

1. sequence גלובלי `finance_transaction_account_number_seq START 8525`; הקצאה
   תתרחש רק בתוך RPC ההפקה. מספר שבוטל לא יוחזר לרצף.
2. `finance_transaction_accounts`: מספר unique, תאריכי issue/cutoff, snapshot
   לקוח וסמל, total מדויק, סטטוס מסמך, סטטוס גבייה, שם/PDF, metadata של
   SharePoint, מצב/מזהה/error של Outlook, audit וביטול.
3. `finance_transaction_account_lines`: FK לחשבון, `activity_row_id` כהפניה
   בלבד, וכל שדות ה־snapshot הנדרשים למסמך.
4. `finance_transaction_account_meetings`: FK לשורה, פעילות, תאריך, `hours=1.5`
   ו־unique `(activity_row_id, meeting_date)` למניעת חיוב כפול גם בתחרות.
5. RLS לכל שלוש הטבלאות על בסיס `app_can_access_finance()`; כתיבת snapshot תהיה
   דרך RPC בלבד. עדכון סטטוס גבייה יהיה RPC נפרד ומצומצם.
6. RPC preview לקריאה בלבד ו־RPC finalize טרנזקציוני. finalize יבצע נעילה,
   יחשב מחדש מול מקור האמת, יקצה מספר לכל סמל מוסד, יכתוב account/lines/meetings
   וייכשל כולו במקרה collision. idempotency key של batch/manual ימנע הפקה כפולה.
7. אין שינוי או backfill ל־`finance_collection_tracking`, ואין תלות ב־
   `activity_completion_approval_uploads`.

ה־PDF והעלאת SharePoint יבוצעו ב־Edge function חדש וממוקד. ה־RPC ישמור תחילה
snapshot במצב `generating`; לאחר PDF והעלאה מוצלחים RPC finalize יסמן `issued`.
מפגשים יישמרו באותה טרנזקציה עם החשבון, אך preview יתעלם רק מחשבונות final;
רשומות generating תקועות ידרשו resume של אותו idempotency key, לא מספר חדש.
טיוטת Outlook תתרחש אחרי finalize וכשל בה יעדכן רק `outlook_status=failed`.

## PDF, SharePoint ו־Outlook

* PDF: Edge + `pdf-lib/fontkit/bidi-js`, A4, Arimo מוטמע, טקסט וקטורי בלבד,
  header קומפקטי, טבלה ראשית ופירוט תאריכים. בדיקה תוודא קיום font/text operators
  והיעדר עמוד שהוא XObject תמונה בלבד.
* SharePoint: בחירת התיקייה תספק `driveId/itemId/webUrl` שנפתרו דרך Graph. השרת
  יאמת שהיעד שייך ל־site המותר לפני upload. יישמרו מזהה item, תיקייה ושם קובץ;
  URL לא יופיע במסמך או במייל.
* Outlook: שימוש ב־`graph-mail.js` וב־MSAL הקיימים, יצירת draft בלבד וצירוף bytes
  של ה־PDF. retry יקבל `account_id`, יבדוק/יחליף רק טיוטה ולא יקצה מספר או יחייב
  מפגש.

## קבצים ממוקדים לשלב implementation

* migration חדש תחת `supabase/migrations/`.
* Edge function חדש `supabase/functions/finance-transaction-accounts/` (עם
  helpers קטנים משותפים רק אם חילוץ מתשתית ה־Graph הקיימת נדרש).
* מודול חישוב/תצוגה חדש תחת `frontend/src/screens/finance-transaction-accounts.js`.
* הרחבות נקודתיות ב־`frontend/src/screens/finance.js`, `frontend/src/api.js`
  וב־CSS הכספים הקיים.
* tests ממוקדים חדשים ללוגיקת החישוב, חוזה migration, PDF ו־failure/retry.
* בגלל שזה frontend deployable: marker חדש ב־`frontend/src/config.js`, העלאת
  `CACHE_VERSION` ב־`frontend/sw.js`, ועדכון query version רק אם entry ישיר
  מ־`index.html` ישתנה.

אין צורך לשנות את מסכי התפעול, `finance-attendance-summary.js`, רכיבי אישור
ביצוע או טבלאות פעילות.

## סיכונים וחסמים לאישור

* אין remote ב־checkout ולכן טרם אומתה התאמה ל־main העדכני.
* דרוש אישור להרצת migration; בשלב זה לא נוצרה ולא הורצה migration ולא בוצעה
  כתיבה לנתוני אמת.
* שמירת SharePoint דורשת secrets קיימים `MS_TENANT_ID`, `MS_CLIENT_ID`,
  `MS_CLIENT_SECRET` והרשאות application מתאימות ל־site/drive. בחירת תיקייה
  דינמית דורשת שהאפליקציה תהיה מורשית ליעד שנבחר.
* Outlook delegated דורש consent ל־`Mail.ReadWrite`; `Mail.Send` אינו נדרש
  ליצירת draft בלבד וניתן לצמצמו בכפוף להגדרת האפליקציה. אין ליצור auth חדש.
* יש להכריע האם “הפעילות הסתיימה” פירושו שכל התאריכים הלא־מבוטלים עד cutoff,
  או גם `end_date <= cutoff`. ההמלצה היא שכל המפגשים המתוכננים הלא־מבוטלים
  הגיעו ל־cutoff; `end_date` לבדו אינו אמין מספיק.
* יש לאשר את site/drive המורשים ואת זהות תיקיית היעד לפני הטמעת picker.

לאחר אישור מפורש של התכנית וההכרעות לעיל אפשר לבצע את ה־implementation, להריץ
רק את הבדיקות הממוקדות המפורטות בדרישה, ולמסור PR נוסף מוכן לבדיקה — ללא merge
וללא הפעלת migration ב־production.
