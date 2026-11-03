# הפקת חשבון עסקה וטיוטת Outlook אוטומטית

Issue #2591. השינוי חל על כל מסלולי ההפקה: קורסים, סדנאות, חשבונות
חודשיים וחשבונות ידניים/מרוכזים. כללי הזכאות והחיוב, לרבות PR #2590,
אינם משתנים.

## תהליך

1. שריון החשבון והמפגשים ממשיך ב-RPC הקיים עם מניעת חיוב חוזר.
   טריגר שרת שומר `outlook_owner_id` ו־`outlook_owner_mailbox` לפי `auth.uid()`.
   הכתובת נלקחת מ־`public.users` המנוהלת על ידי מנהל, בהתאמה לכתובת Auth
   מאומתת בדומיין `think.org.il` ולהרשאת הפקה פעילה. אין שימוש ב־`profiles`,
   ב־`user_metadata`, בכתובת מהדפדפן או בתיבה קבועה.
2. פונקציית `finance-transaction-accounts` מייצרת PDF ושומרת אותו ב-SharePoint.
   העלאה אינה דורסת קובץ סופי. סיום החשבון שומר את מזהי הקובץ וה-hash.
3. טריגר מסד נתונים מוסיף עבודת Outlook באותה עסקה שבה החשבון מסומן `issued`.
4. אותה קריאת הפקה ממשיכה מיד לאיסוף נמענים וליצירת טיוטה, ללא `createDraft`.
   הסדר מבטיח שהקובץ נשמר לפני שהטיוטה משתמשת בו.
5. `resolve_finance_outlook_mailbox` פותר את תיבת המפיק המקורי תחת נעילת ההפצה,
   גם בניסיון חוזר של משתמש אחר או בעבודת רקע ללא סשן משתמש. זהות המפיק
   והכתובת השמורה אינן ניתנות להחלפה. כתובת חסרה ניתנת לתיקון עבור אותו מפיק
   בלבד; כתובת ששונתה, הרשאה שנשללה או טיוטה היסטורית בתיבה אחרת חוסמות יצירה.
   ההודעה נוצרת ב-Graph באמצעות `POST /users/{mailbox}/messages` בלבד.
   ה-PDF מצורף כ-`fileAttachment`; נושא ההודעה משתמש בחודש שורות החיוב.
   חשבון שכבר שולם אינו מבקש תשלום נוסף.
6. הטיוטה נבדקת מחדש ב-Outlook: `isDraft`, הנמענים, ושוויון SHA-256 בין
   קובץ ה-PDF המצורף למסמך שנשמר. רק לאחר מכן נשמר `draft_ready`.

אין קריאה ל-`send` או ל-`sendMail`.

## נמענים

`finance_transaction_recipients` היא פונקציית שרת המותרת ל-service_role בלבד.
היא קוראת את הנתונים המעודכנים בכל ניסיון, בלי לשנות את תמונת החשבון ההיסטורית.

- מוסד: אנשי קשר פעילים המשויכים למוסד, הכתובות הפעילות ב-`contact_emails`
  והנמען המפורש ב-`finance_school_invoice_recipients`.
- רשות: אנשי קשר מסוג `authority` עם `authority_id` תואם.
- מממן אחר: אנשי קשר מסוג `other` עם שם משלם תואם למקור המימון.
- כתובת משלם שנערכה בהפקה ידנית יכולה להתווסף. כתובת מוסד שהועתקה בדפדפן
  אינה משמשת אוטומטית כנמען של חשבון רשות או מממן אחר.
- כתובות לא תקינות, כתובות שהושבתו ואנשי קשר לא פעילים אינם נכללים.
  כתובות כפולות מאוחדות בלי תלות ברישיות. אין נמען תקין: `missing_recipient`.

## התאוששות ומניעת כפילויות

נעילת ההפצה הקיימת מגינה גם על שלב הדואר. החשבון נקרא מחדש לאחר קבלת הנעילה.
מזהי Graph נשמרים במצב ImmutableId, ולכל הודעה מתווסף `FinanceAccountId`.
לפני יצירה מחפשים הודעה קיימת, גם אם היא כבר נשלחה ידנית. אין יצירת טיוטה
חדשה להודעה שכבר נשלחה.

לפני POST נשמרת כוונת יצירה בבסיס הנתונים. דחיית לקוח מפורשת מאפשרת ניסיון
חוזר; שגיאת רשת, timeout או שגיאת שרת אחרי ה-POST נחשבות לתוצאה לא ודאית.
במקרה כזה מנסים לאתר את ההודעה לפי החשבון. אם לא ניתן להכריע, נרשם
`needs_review` ולא מבוצע POST נוסף. גם מספר הודעות תואמות מחייב בדיקה.

כשל בדואר אינו מבטל חשבון שהופק, משחרר חיוב או מייצר PDF חדש. בניסיון חוזר
מורידים את הקובץ המקורי מ-SharePoint ומאמתים hash. כשל בעדכון סטטוס לא מדווח
למשתמש כהצלחה. כתובות שהתעדכנו מתוקנות בטיוטה הקיימת ולא בהודעה חדשה.

`finance_private.outlook_jobs` היא תיבת עבודה פרטית עם RLS וללא גישת לקוחות.
משימת `pg_cron` כל שתי דקות מפעילה עד עשר עבודות שמועדן הגיע. היא משתמשת
ב-JWT הפרויקט מתוך Vault וביכולת זמנית, אקראית ונפרדת לכל חשבון; אין שמירת
מפתח service_role או JWT של משתמש בעבודה. אימות JWT ב-Edge נשאר פעיל,
והיכולת נבדקת בפונקציית שרת מוגבלת ל-service_role.

כשל רגיל נדחה לניסיון נוסף עם המתנה גדלה; חוסר נמען נבדק שוב לאחר שעה.
לאחר עשרה ניסיונות ברקע העבודה נחסמת והכשל מוצג. תוצאה לא ודאית ממתינה לבדיקה.
הממשק מציע השלמה חריגה לחשבון קיים בלבד; כפתור העברה נוסף אינו חלק מההפקה.
סבב חודשי ממשיך לחשבונות האחרים גם כאשר חשבון אחד נכשל, ומציג סיכום נפרד
למסמכים, טיוטות, חוסר נמענים וכשלים.

## תלויות ופריסה

- להחיל את `20261102202405_finance_automatic_outlook_drafts.sql`, ואז לפרוס
  את פונקציית ההפקה עם `verify_jwt=true` ואת הממשק המעודכן.
- משימת הרקע משתמשת בשמות Vault שכבר קיימים בפרויקט:
  `quote_signature_reminder_project_url` ו-`quote_signature_reminder_anon_key`.
  אלה URL ו-JWT פרויקט משותפים; אין שינוי במשימת התזכורות או בסודותיה.
- להחיל גם את `20261103191835_finance_original_issuer_outlook_mailbox.sql`
  לפני פריסת פונקציית ההפקה החדשה. המיגרציה משמרת מזהי טיוטות וקבצים קיימים.
- אין שימוש ב־`MS_MAIL_SENDER` בהפקת חשבונות עסקה. אין למחוק את הסוד אם
  אינטגרציות אחרות משתמשות בו. חוסר הרשאה לתיבת המפיק נרשם כשגיאה ברורה
  בהיסטוריה, ללא תיבה חלופית וללא ביטול ה־PDF או החיוב.
- דרושה הרשאת `Application Mail.ReadWrite` ב־Exchange Online, מוגבלת לתיבות
  המורשות בלבד. לפי הרשאות המערכת שנבדקו ב־3.11.2026 אלה
  `idann@think.org.il` ו־`toni@think.org.il`. אין צורך ב־`Mail.Send`.
  הגבלת Microsoft היא שכבה נפרדת מהרשאות המערכת; נדרש מנהל Microsoft 365.
- בהגדרת RBAC יש להסיר הרשאת Mail.ReadWrite רחבה ב־Entra אם הוענקה: הרשאות
  Entra ו־Exchange מצטברות, והגבלת RBAC לבדה אינה מצמצמת הרשאה רחבה קיימת.
  אין לשנות את הרשאות SharePoint של היישום.
- לא מתבצע מילוי אוטומטי של תור לכל החשבונות ההיסטוריים בעת המיגרציה.
  אפשר להשלים חשבון קיים בלי להפיקו מחדש.

ה-PDF הנוכחי כולל גופנים מלאים ובנתונים שנבדקו גודלו כ-270KB. קובץ של 3MB
ומעלה נחסם לפני יצירת הודעה ויישאר עם סטטוס כשל, משום שמסלול הצירוף הנוכחי
משתמש בקובץ מוטמע בבקשת Graph. החשבון והקובץ ב-SharePoint נשמרים.

## בדיקות

- `finance-automatic-draft-action.test.mjs`: אוטומציה, נמענים, PDF מקורי,
  ניסיון חוזר, 403, OAuth, כוונת יצירה, תוצאה לא ודאית, הודעה שנשלחה ואימות קובץ.
- `finance-automatic-outlook-postgres.test.mjs`: ניתוב נמענים לפי משלם,
  טריגר אטומי, הרשאות, עבודות רקע, יכולות זמניות, סטטוסים ושימור כלל גפ״ן.
- בדיקות ממוקדות בקובצי Edge, הפקה חודשית והפקה ידנית: PDF אמיתי לקורס ולסדנה,
  התאוששות מהפקה חלקית ושימוש חוזר בזהות הבקשה.
- בדיקות ייצור יוצרות טיוטות בלבד; אינן שולחות דוא״ל ואינן יוצרות חשבונות בדיקה פיקטיביים.

## הגדרת Microsoft בידי מנהל הארגון

היישום: `6982b128-75f4-4513-9b6e-90e7ca56209c`. המודל נשאר Application
כדי לאפשר השלמה ברקע. יש להשתמש ב־Object ID של **Enterprise Application**
בטננט, ולא ב־Object ID של App registration. לאחר התחברות מנהל באמצעות
`Connect-ExchangeOnline`, ובהיעדר הגדרה קיימת לאותו יישום:

```powershell
$appId = '6982b128-75f4-4513-9b6e-90e7ca56209c'
$enterpriseObjectId = '<Enterprise Application Object ID>'
New-ServicePrincipal -AppId $appId -ObjectId $enterpriseObjectId -DisplayName 'Taasiyeda invoice drafts'
New-ManagementScope -Name 'TaasiyedaInvoiceIssuers' -RecipientRestrictionFilter "(PrimarySmtpAddress -eq 'idann@think.org.il' -or PrimarySmtpAddress -eq 'toni@think.org.il')"
New-ManagementRoleAssignment -Name 'TaasiyedaInvoiceDrafts' -App $enterpriseObjectId -Role 'Application Mail.ReadWrite' -CustomResourceScope 'TaasiyedaInvoiceIssuers'
Test-ServicePrincipalAuthorization -Identity $enterpriseObjectId -Resource 'idann@think.org.il'
Test-ServicePrincipalAuthorization -Identity $enterpriseObjectId -Resource 'toni@think.org.il'
Test-ServicePrincipalAuthorization -Identity $enterpriseObjectId -Resource 'office@think.org.il'
```

יש לבדוק שהרשאת Mail.ReadWrite בתוך תחום הגישה לשתי התיבות הראשונות ומחוצה
לו לתיבה השלישית, ושאין הרשאות דואר רחבות/חלופיות ליישום. אם ההגדרות כבר
קיימות יש לבדוק ולעדכן אותן במקום ליצור כפילויות. שינוי Scope אינו מיידי;
לאחר התפשטות ההרשאות יש לבדוק Graph מול שתי התיבות. כשל Graph לא יגרום
לניסיון בתיבה אחרת. אין לבקש הרשאות שליחה.

מקורות: [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac),
[יצירת טיוטת Graph](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0).
