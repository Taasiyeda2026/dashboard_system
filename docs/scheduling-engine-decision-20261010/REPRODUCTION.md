# שחזור הבדיקה

קוד המוצר שנבדק: `e3ad085f704697ef1ec58423ea277f439b3fecaf`. אין שינוי במנוע או בממשק בענף הבקרה.

העתק הבדיקה האנונימי נשמר בסביבת העבודה ב־`work/scheduling-engine-decision-20261010/final`. הוא אינו נכנס למאגר. הקבצים הנדרשים: `anonymous-snapshot.json`, `anonymous-saved.json`, `anonymous-canonical.json`, `anonymous-routes.json`. יש להשוות את ה־SHA256 ל־`evidence/provenance.json` לפני שחזור. שאילתות יצירת ההעתק הן קריאה בלבד ומבצעות אנונימיזציה לפני החזרת הנתונים; אין להחליפן בייצוא רשומות גולמיות.

```sh
export DECISION_DIR=/path/to/isolated/anonymous-fixture
export DECISION_CANONICAL=1
export DECISION_PROFILE=fast
node --expose-gc scripts/acceptance/scheduling-engine-decision.mjs
node scripts/acceptance/scheduling-decision-audit.mjs
node scripts/acceptance/scheduling-decision-alternatives.mjs
node --test --test-isolation=none tests/scheduling-point-worker-representative.test.mjs
node scripts/acceptance/scheduling-decision-worker-delta-parity.mjs
node scripts/acceptance/scheduling-decision-recovery.mjs
DECISION_PLAN="$DECISION_DIR/recovered-valid-base.json" DECISION_AUDIT_FILE=recovered-base-audit.json node scripts/acceptance/scheduling-decision-audit.mjs
node scripts/acceptance/scheduling-decision-process-recovery.mjs
```

בדיקת ה־Worker המייצגת צפויה להיכשל בתרחיש חסימת התאריך; אין להפוך את הכשל ל־pass צפוי. ללא העתק מפורש הבדיקה מסומנת skip; CI בסיסי אינו בודק אותה.

לבדיקת חלופות שאין בהן הפרות חדשות, יש ליצור תיקיית עבודה נפרדת עם אותם ארבעה קובצי קלט, ולשמור בה את `recovered-valid-base.json` בשם `national-plan.json`. להריץ בה `scheduling-decision-alternatives.mjs`, ואחריו `scheduling-decision-witness-audit.mjs`. רק שדה `independentNewAssignmentsPass` מתאר בדיקה עצמאית; `legalAlternative` בסריקה הראשונה הוא סיווג פנימי של המנוע בלבד. ממצאים בשיבוצים מוגנים עדיין דורשים בירור ואינם מאושרים מחדש.

בדיקות PostgreSQL מוגבלות ל־`127.0.0.1:55439/codex_engine_decision` ולסיסמת בדיקה מקומית. `scheduling-decision-postgres.mjs` **מוחק את סכמות מסד הבדיקה הזה** ומקים fixture מינימלי. אסור לשנות את הכתובת לשרת אמיתי. הוא מפעיל migrations רק במסד המבודד; אינו מדמה פריסת Supabase Auth מלאה.

```sh
node scripts/acceptance/scheduling-decision-postgres.mjs
node scripts/acceptance/scheduling-decision-storage-restart.mjs
# Restart only the disposable local PostgreSQL container, then:
DECISION_RESTART_AFTER=1 node scripts/acceptance/scheduling-decision-storage-restart.mjs
node scripts/acceptance/scheduling-decision-save-recovered-base.mjs
```

בדיקת התהליך מפסיקה תהליך Node מבודד באמצעות `SIGKILL`, שומרת checkpoint רץ לקובץ ומחדשת באמצעות רשומות שלא הושלמו ופתיחת רשומות לא משובצות לפי helper המוצר. אין commit של תוצאה חלקית. זהו ניסוי תהליך מקומי, לא שירות חישוב חדש ולא המשך עבודה אחרי סגירת דפדפן.

ריצות אבחון מוקדמות לא שימרו את כתובות בתי הספר הקנוניות, סדר מזהים או כל נתוני המחליפים; הן לא נכללו במדידות הסופיות. בדיקות האודיט והבסיס שוחזרו כאשר תוקנו הקלט או תנאי הקבלה מול המסמך שהמשתמש בחר. לא הורצה חבילת legacy מלאה ולא הורצו בדיקות שכבר עברו רק כדי להגדיל מספר בדיקות.
