# PR #3 — Worker נקודתי קבוע: דוח קבלה

## השינוי בפועל

האלגוריתם v36 ואילוציו לא שונו. החישוב הנקודתי, האופטימיזציה שלו, אימות התוצאה ושחזור הצעה שמורה חוקית פועלים בתוך Worker קבוע. אין fallback לחישוב נקודתי ב־Main Thread. ה־Worker אינו מבצע כתיבה למסד ואינו מקבל session או מפתחות; בקשות מסלול מועברות ל־Main ונשלחות דרך הלקוח המורשה הקיים.

הקשר ממוספר לפי משתמש, תקופה, מחוז, גרסת מנוע, גרסאות מקור וסביבת תכנון, תאריך וטביעות אצבע. ההעברה הראשונה מחולקת למנות עם אישורים והזדמנויות לרינדור; בהמשך נשלחים רק שדות ששונו. committedRows ו־existingRows זהים משתפים את אותו snapshot. רשומות תכנון ומסלולים מוקפאים ונשמרת הסריאליזציה שלהם בין גרסאות; פעילות וזמינות חיות נבדקות מחדש. לאחר commit נקודתי, נטענת הקרנה טרייה ורק הרשומות המלאות שנכתבו, עם בדיקת revision נוספת. אין הזנת הקרנה חסרה למנוע.

מועבר חיווי קטן עד ארבע פעמים בשנייה. ביטול משתף פעולה, ובמקרה של קוד חוסם ה־Worker מושמד לאחר 500ms. תוצאה שמגיעה לאחר ביטול, איבוד בעלות או שינוי גרסה נדחית. לפני שליחת RPC אטומי לשמירה כפתור הביטול מנוטרל: RPC שכבר נשלח אינו ניתן לביטול בדפדפן.

פתיחת פרטי קורס ועריכת חלופת טיוטה מחליפות את החלונית או הכרטיס הרלוונטיים, תוך שמירת שאר הרשימה והפוקוס. סימון needs_recalc משכפל רשומת תצוגה מוקפאת במקום לשנות את הקשר החישוב. אין קידום סמוי של עדכון נקודתי לחישוב מלא; מקור לא מאומת דורש חישוב תחזוקה מלא מפורש.

## קבצים ופונקציות

| קובץ | תפקיד |
|---|---|
| `course-scheduling-point.worker.js` | snapshot אטומי, run, broker, progress, אימות ושחזור קיימים |
| `course-scheduling-worker-client.js` | SchedulingPointWorker: sync/run/dispose; דלתאות, מטמון סריאליזציה, בעלות וביטול |
| `course-scheduling-worker-protocol.js` | planningRowPatches/applyPlanningRowPatches; שמירת זהות חלופות שלא השתנו |
| `course-scheduling-point-workspace.js` | reusablePointWorkspace/refreshCommittedPointWorkspace; קריאה נקודתית ובדיקת גרסאות |
| `course-scheduling.js` | מסלול runCoursePlanning, broker, קבלת תוצאה ושמירה קיימת; partial details/card binding וביטול |
| `course-scheduling-planning-store.js` | שגיאות Worker ושכפול needs_recalc לתצוגה מוקפאת |
| `course-scheduling-travel.js` | import עצל של הלקוח בברירת המחדל; Worker משתמש ב־broker |
| `vite.config.js` | Worker מסוג ES module, לתמיכה בפיצול קוד |
| `config.js`, `frontend/sw.js` | release marker ו־CACHE_VERSION 1981; root sw ללא שינוי |
| `tests/scheduling-point-worker*.test.mjs` | בדיקות Worker אמיתי דרך adapter, דלתאות, ביטול, גרסאות וממשק |
| `scripts/benchmarks/scheduling-point-worker-*.mjs` | מדידות ידניות מבודדות וניתנות לשחזור |

## שיטת המדידה

253 פעילויות, 49 מדריכים, 9,900 מסלולים. קובץ סינתטי זהה בגודל 8,867,991 bytes, SHA256 `b1c075c4e6c56017324f3e9f622856012fc9c00917d6439a0b2bd9aaf90d37e1`. בסיס ההשוואה fd3f6a8, כולל PR2213 ו־PR2222. הענף עודכן ל־main e95cf33; ההפרש ביניהם נוגע למשובים בלבד, ללא שינוי במנוע או במסך הנבדק.

Chromium headless 151 על אותה מכונה, CSS ו־render/bind של המסך האמיתי. דסקטופ 1440×900, מובייל מדומה 390×844 עם CDP CPU×4 בדף. כל כתובת שאינה loopback נחסמה; RPC/Auth הוחלפו ב־stubs מקומיים. אלה אינם נתוני ייצור, בדיקות RLS אמיתיות או זמני SQL. זמן החישוב כולל sync/העתקה/חישוב/דלתא, אך אינו כולל טעינת מסד ושמירה. 20 ריצות חמות לכל תרחיש ולכל תצורה, ועוד 20 יצירות Worker קרות לכל תצורה; מטמון מודולי הדפדפן חם בסדרת היצירה הקרה.

**CDP עשוי להאט את Main בלבד, בלי להאט את isolate של ה־Worker.** אין להסיק מנתוני מובייל אלה p95 פיזי במכשיר חלש. היעד דורש אישור נוסף על מכשיר מייצג לפני שחרור.

טבלת המדידות הסופית והקבצים הגולמיים מצורפים בהמשך. p95 חושב לפי nearest-rank. חישוב נקודתי במדידה הישירה מכוון לפעילות אחת; מסלול כפתור הריצה שומר על סגירת התלויות האמיתית: בתרחיש הסינתטי הצפוף היא מגיעה ל־253 פעילויות. זו ריצה incremental עם target מפורש ו־allowGlobalRepair=false, ולא שדרוג ל־forceFull. אין לצמצם סגירת תלויות כדי לשפר מספר.

## תוצאות מדודות

| תרחיש (p95, 20 ריצות לכל תצורה) | דסקטופ לפני → אחרי | מובייל מדומה לפני → אחרי |
|---|---:|---:|
| נקודתי חם, תכנון שמור | 240.3 → 223.2ms | 4045.8 → 314.4ms |
| נקודתי חם, חסימת תאריכי מדריך | 452.6 → 430.1ms | 6879.3 → 547.7ms |
| חיווי התחלה, לפני/אחרי תיקון ציור, מסך יציב | 34.0 → 33.6ms | 182.5 → 47.8ms |

שינוי גרסה עם תוכן שמור זהה: p95 248.2/482.0ms. יצירת Worker קרה: 798.3/6724.4ms. אין יעד 800ms ליצירה קרה; האתחול במובייל איטי ויש לשמר את הקשר הפעיל.

80/80 פעולות ממשק בכל תצורה תחת עומס CPU מוזרק: trusted input-to-paint p95 37.7/77.0ms; selectOption סינתטי 35.9/42.8ms. ביטול Worker לא משתף פעולה: 566.2/787.5ms. היעדים נצפו בסביבת הבדיקה הזו, בכפוף למגבלות האטת Worker ומדד הציור.

Node באותה מכונה, 20 ריצות חמות לכל גרסה: wall p95 404.0 → 417.6ms, CPU p95 543.4 → 468.4ms; RSS כולל שני isolates, שיא מדוגם כל 10ms: 257.4 → 527.0MiB. אין הוכחת קיצור אלגוריתמי, ויש עלות זיכרון משמעותית. heap ראשי בדפדפן החם: 71.1/69.3MiB; זה אינו זיכרון דפדפן כולל או זיכרון Worker.

איכות בדפדפן לפני ואחרי זהה: 252 פעילויות מכוסות, 1,008 שעות, ללא failures/warnings; בחסימת הזמינות: 251 פעילויות, 1,004 שעות בשתי הגרסאות. Node: 253/1,012 בשתי הגרסאות ודיג׳סט קנוני זהה לכל שורות התוצאה. תוצאות Node והדפדפן אינן מאוחדות: אלה runtimes/תזמון callbacks שונים; ההשוואה נעשית בתוך כל runtime.

בקשות מסד בזמן המדידה הישירה: 0, כי הנתונים טעונים מראש. ספירת RPC של מסלול הכפתור מצורפת ב־browser-after.json; SQL/רשת/שמירה אמיתיים לא נמדדו מחדש. עלות preprocessing אינה מוסתרת כזמן שרת. במדידת שינוי גרסאות לא נשלחו entries נוספים מעבר לטעינה הראשונית; unit test מאמת שינוי exception יחיד בלבד.

[מדדים מרוכזים](METRICS.json), [לפני](browser-before.json), [אחרי](browser-after.json), [שינוי זמינות לפני](browser-availability-before.json), [שינוי זמינות אחרי](browser-availability-after.json), [שינוי גרסאות](browser-revisions.json), [אתחול קר](browser-cold.json), [ממשק תחת עומס](browser-interactions.json), [קריסה ופתיחה מחדש](browser-faults.json), [ניתוק וחיבור](browser-network.json), [חיווי לפני](browser-start-feedback-before-fix.json), [חיווי אחרי](browser-start-feedback.json), [CPU וזיכרון](node-cpu-memory.json).

מדידת חיווי מוקדמת כללה רינדור מחדש יזום ממש לפני הקליק ונתנה 324ms במובייל. לצורך השוואה תקפה, שתי הגרסאות נמדדו מחדש לאחר התייצבות אותו מסך; קודם ל־yield: 182.5ms, אחריו: 47.8ms. מדידת desktop availability נערכה מחדש לבדה לאחר זיהוי הרצת build במקביל למדידה הראשונה. CPU/RSS נמדדו שוב לאחר סיום בדיקות הדפדפן. המדידות הראשונות המושפעות לא משמשות לטבלת ההשוואה.

בדיקת רשת נוספת משתמשת בפעילות סינתטית אחת ובתשובת מסלול סינתטית 5km/10min, עם Worker הבנוי לייצור: במצב offline הייתה בקשה כושלת בפועל ולא נבחר מדריך; ב־online התקבלה הצעה חוקית. היא בודקת transport ושחזור בקשה, אינה מדידת ביצועים של fixture253 או בדיקת Supabase. תרחיש ראשוני שלא יצר בקשות מסלול נכשל בבדיקת harness ותוקן; לא הוכרז כהצלחה.

## תקינות, בדיקות וראיות

- 10/10 בדיקות Worker סופיות, כולל הצעה קודמת עם תאריך רשמי שנבדקת מחדש לאחר חסימת מדריך והסרת כל המדריכים. תאריך רשמי ונתוני המקור אינם משתנים; אין הצעה בלתי חוקית.
- 3/3 בדיקות DOM: החלפת כרטיס יחיד, פתיחת קורס ושמירת פוקוס; אישור טיוטה נקשר פעם אחת לפעילות שנבחרה, גם בזמן ריצה; ביטול בזמן ההמתנה לציור מונע preflight/lease/חישוב.
- 19/19 בדיקות invalidation/self-invalidation לאחר שינוי הטיפול ברשומות מוקפאות. 41/41 בדיקות רלוונטיות חוזרות לחידוש ותצוגה מיושנת לאחר השינוי האחרון במסלול הריצה.
- בדיקות preflight/cooperative runtime הורצו שוב לאחר תיקון חיווי ההתחלה; מספר המקרים בפועל מופיע ב־final-preflight.log.
- 122/122 בדיקות UI/תקינות מוקדמות. חזרה על subset נדרשה בגלל שינוי משותף רלוונטי, לא לצורך ספירת הצלחות.
- בדיקות המנוע והקבלה הקיימות כוללות מעברים בין בתי ספר, גבולות נסיעה, חפיפות, תלויות דרך שיבוצים מוגנים, מעבר לגרסת v36, checkpoint ישן/פגום, ו־optimizer failure ששומר בסיס חוקי. קוד המנוע לא שונה; פירוט מקרי הבדיקה בלוגים.
- במסך בפועל: 80 פעולות בכל תצורה בזמן Worker עם עומס CPU מוזרק; אפס שגיאות דף ואפס commits. זמן ציור הוא אירוע עד שני requestAnimationFrame, מדד מקורב ולא INP תקני. אירועי Playwright selectOption אינם trusted ומדווחים בנפרד; זמן automation כולל IPC ומספר פעולות ולכן אינו מוצג כזמן תגובת הממשק.
- קריסת Worker ממשית באמצעות exception בתוך thread, מקור לא מאומת, דחיית הרשאה 42501, וסגירת לשונית ופתיחה מחדש נבדקו בדפדפן. התכנון השמור כולל 253 רשומות נשמר, אין commit, אין חישוב אוטומטי בפתיחה מחדש. דחיית ההרשאה היא stub, אינה הוכחת RLS לפי תפקיד.
- קיימות שלוש בדיקות source-text ישנות שנכשלות גם ב־main fd3f6a8: auto-refresh/label/route-concurrency. לוג בסיס מצורף. לא שונו כדי להסתיר כשל, ואינן הוכחת רגרסיה ב־Worker.
- Build ראשון נכשל בגלל פורמט IIFE; לאחר תיקון worker.format ל־es הבנייה עברה. אזהרות xlsx/chunks קיימות מפורטות בלוג. לא הוכנסו assets/archives לרשימת precache.

## מגבלות והחלטת ביקורת

ה־Worker אינו שורד סגירת לשונית, קריסת דפדפן או כיבוי מכשיר. הנתונים השמורים נשמרים וניתן להתחיל מחדש; אין טענה להמשך ריצה נקודתית לאחר סגירה. checkpoints ותכנון קודמים אינם נמחקים בבדיקות.

הכנת planning context פנימי עדיין מתבצעת במנוע בכל ריצה, בתוך ה־Worker: האינדקסים הווירטואליים שלו משתנים במהלך חיפוש ולכן אינם משותפים בצורה לא בטוחה. נחסכו העברות נתונים וסריאליזציה חוזרת של רשומות בלתי משתנות, לא כל עבודת ההקשר.

שירות ארצי מתמשך, תור, שחזור תהליך/שרת, תשלום, אירוח ו־commit מהימן חדש בצד השרת שייכים לשלב ב׳. חישוב תחזוקה מלא מפורש עדיין משתמש במסלול הישן ב־Main; גם מסלול המלצות ידני ישן אינו מועבר כולו ב־PR זה. אין להציג את שלב א׳ כאילו פתר ריצה ארצית או שרידות שרת.

הרשאות SQL/RLS, נתוני ייצור, migrations, תאריכים, נעילות, אישורים ומנוע לא שונו. בדיקות מסד הקיימות רצות ב־CI מבודד; לא בוצעה בדיקת כניסה מלאה ל־Supabase עבור שלושה תפקידים בממשק. אין לראות stubs כאישור הרשאות בסביבה אמיתית. המדידות הן base-only, בלי לטעון שכל אופטימיזציה אפשרית עומדת ב־800ms.

מומלץ לביקורת קוד על שלב א׳ בלבד. לפני שחרור: בדיקה על מכשיר פיזי מייצג ובסביבת Auth/RLS מבודדת, ומדידת מסלול שמירה מלא עם נתוני מקור מייצגים. אין אישור למיזוג או לפריסה בדוח זה.

## שחזור

```bash
node --test --test-isolation=none tests/scheduling-point-worker.test.mjs tests/scheduling-point-worker-ui.test.mjs
WORKER_RESULT=/tmp/worker-after.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_UI_ONLY=1 WORKER_RESULT=/tmp/worker-ui.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_FAULT_ONLY=1 WORKER_RESULT=/tmp/worker-faults.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_NETWORK_ONLY=1 WORKER_RESULT=/tmp/worker-network.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_START_ONLY=1 WORKER_RESULT=/tmp/worker-start.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_CHURN=1 WORKER_RESULT=/tmp/worker-revisions.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_AVAILABILITY=1 WORKER_RESULT=/tmp/worker-availability.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_COLD_ONLY=1 WORKER_RESULT=/tmp/worker-cold.json node scripts/benchmarks/scheduling-point-worker-browser.mjs
WORKER_RESULT=/tmp/worker-node.json node --expose-gc scripts/benchmarks/scheduling-point-worker-node.mjs
npm run build
```

למדידת לפני: WORKER_REPO מצביע ל־worktree של fd3f6a8 ו־WORKER_VARIANT=before. Chromium נדרש ב־/usr/bin/chromium; הסקריפט אינו מחובר ל־CI אוטומטי ואינו משתמש בסודות.
