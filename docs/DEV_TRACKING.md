# מעקב פיתוח — AVI.APP

מסמך חי אחד לניהול באגים ופעולות פיתוח, עם טבלת דחיפות שקובעת מה עושים הבא.
מתעדכן לאורך זמן — לא היסטוריה קפואה. פריטים שהושלמו עוברים ל"הושלמו" ולא נמחקים,
כדי לשמור הקשר (מה נעשה, מתי, למה).

## איך להשתמש במסמך הזה

- כל פריט חדש (באג או רעיון פיתוח) נכנס ל"טבלת הדחיפות" עם מזהה ייחודי (`DEV-XXX`).
- לפני שמתחילים לעבוד על פריט כלשהו — בודקים כאן קודם מה הכי דחוף.
- כשפריט מטופל, מעדכנים סטטוס ומוסיפים שורה ל"היסטוריית שינויים" בתחתית.
- קובץ זה חי ב-Git (`docs/DEV_TRACKING.md`) ונגיש לצפייה דרך GitHub — כתובת קבועה, גרסאות
  עוקבות אחר כל שינוי.

## מקרא

**דחיפות:**
- `P0` — קריטי, חוסם משתמשים / דליפת נתונים / משהו שבור ב-Production עכשיו
- `P1` — גבוה, לטפל בקרוב (השפעה משמעותית על משתמשים אבל לא חוסם)
- `P2` — בינוני, ראוי לתכנן אבל לא דחוף
- `P3` — נמוך, נחמד-להיות, אין לחץ זמן

**סטטוס:** ממתין · לתכנון · בתהליך · הושלם · נדחה (מתועד אבל לא מתקדם כרגע)

---

## טבלת דחיפות

| מזהה | פריט | סוג | דחיפות | סטטוס | נוסף בתאריך | הערות |
|---|---|---|---|---|---|---|
| DEV-001 | הפעלת דגלי ניהול תפקידים מותאמים (R1 קריאה / R2 כתיבה) | פיתוח | P3 | נדחה | 2026-07-06 | ראה פירוט מלא למטה. תשתית ה-DB כבר קיימת ומאומתת ב-Production (מיגרציות 0015-0017), 100% דורמנטית. Liran בחר לעצור בשלב הזה ולא להפעיל. |
| DEV-002 | לחצן "מצאת תקלה?" בתוכנה + פופ-אפ דיווח + לוגים | פיתוח | P2 | **הושלם** | 2026-07-06 | [PR #41](https://github.com/Liran-Raz/AVI.APP1/pull/41) ממוזג (`ca0ba6b`), מיגרציה 0018 חיה ב-Production, `BUG_REPORT_NOTIFY_EMAIL` מוגדר, deploy אומת (2026-07-07). כפתור גלוי בכל מסכי הדשבורד. |
| DEV-003 | Authoritative Cutover — שיוך תפקידים מותאמים בפועל לעובדים | פיתוח גדול | לא מדורג | נדחה | 2026-07-06 | פרויקט נפרד מ-DEV-001. דורש שינוי ב-Decision A (שנעל כרגע שתפקיד מותאם לא ניתן לשיוך), UI חדש במסך "צוות", מעבר מנוע ההרשאות ל-DB, RLS policies. לא תוכנן, לא התחיל. |
| DEV-004 | `RESEND_API_KEY`/`MAIL_FROM` לא קיימים ב-Vercel Production — כל שליחת מייל אמיתית נכשלת | באג (תשתית) | P1 | **הושלם** | 2026-07-07 | **נפתר 2026-07-09.** דומיין `aviapp1.com` נרכש (Cloudflare) וחובר: Vercel primary=`www.aviapp1.com`, Resend Verified (שליחה דרך `send.aviapp1.com`). שורש הבעיה = ENV, לא קוד: `RESEND_API_KEY` חסר/שבור ב-runtime → הדבקה מחדש + אימות `MAIL_FROM` + **Redeploy**. אומת בפרודקשן: דיווח-תקלה + הזמנת-צוות — שני המיילים מגיעים בפועל, `From: AVI.APP <noreply@aviapp1.com>`. ראה פירוט מלא למטה. |
| DEV-005 | תיקון `reset-password` → `confirm_failed` (זרימת אימות קישור) | באג | P1 | **הושלם** | 2026-07-09 | **אומת בפרודקשן 2026-07-09** (קליק על קישור-איפוס אמיתי → מסך "הגדרת סיסמה חדשה" → סיסמה עודכנה → סיסמה ישנה כבר לא עובדת). הפתרון: (א) `/auth/confirm` מטפל כעת גם ב-`?code=` (PKCE) וגם ב-`token_hash` ([PR #43](https://github.com/Liran-Raz/AVI.APP1/pull/43)); (ב) עודכנה תבנית Reset Password ב-Supabase לפורמט `token_hash`; (ג) אימות ידני מקצה-לקצה. ראה פירוט למטה. |
| DEV-006 | Supabase Auth Custom SMTP דרך Resend (מיילי Auth + מגבלת 429) | תשתית | P2 | **הושלם** | 2026-07-09 | **אומת בפרודקשן 2026-07-09.** חובר דרך אינטגרציית Resend↔Supabase הרשמית (Sender `noreply@aviapp1.com`). הוכחה: מייל איפוס-סיסמה הגיע כעת מ-`AVI.APP <noreply@aviapp1.com>` (לא מ-`supabase.io`) + `POST /emails → 200` ב-Resend Logs. עבודת Dashboard בלבד, ללא קוד. כל מיילי ה-Auth יוצאים כעת מ-`aviapp1.com`, מגבלת ה-429 בוטלה. |
| DEV-007 | חיווי ויזואלי כשמזינים באיפוס את אותה סיסמה נוכחית | UX/באג | P2 | **הושלם** | 2026-07-09 | **אומת בפרודקשן 2026-07-09** ([PR #44](https://github.com/Liran-Raz/AVI.APP1/pull/44)). Supabase דוחה סיסמה זהה, ועד עכשיו זה הוצג כ-toast חולף באנגלית. תוקן: השרת מסמן `details.reason="same_password"`, והטופס מציג חיווי אדום קבוע בעברית ("הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית") + מסגרת אדומה + ניקוי בעריכה. +5 בדיקות. |
| DEV-008 | עיצוב "Liquid Glass" (Calm) ל-UI הפנימי + תיקון רספונסיביות נייד | עיצוב/פיתוח | P2 | **הושלם** | 2026-07-10 | **חי בייצור** ([PR #49](https://github.com/Liran-Raz/AVI.APP1/pull/49), main `8fc343c`, Vercel deploy=success, GET smoke ירוק). שלד זכוכית (sidebar/topbar דביק/mobile-nav) + כל עמודי הדשבורד. **תיקון באג:** טבלאות צוות+לקוחות נחתכו בנייד → פריסה כפולה (טבלה בדסקטופ / כרטיסים בנייד). אף טוקן צבע לא שונה; בידוד `.mkt` מוכח (`:root --accent` = `#e6e8ea`). Round 1 מתוך redesign פנימי מתמשך. |
| DEV-009 | מסך הגדרות (`/settings`) — פרופיל · אבטחה · משרד · התראות | פיתוח | P2 | **הושלם** | 2026-07-10 | **חי בייצור — שני החלקים.** חלק 1 ([PR #51](https://github.com/Liran-Raz/AVI.APP1/pull/51), `59177d2`): פרופיל (שם/טלפון), אבטחה (סיסמה **עם אימות נוכחית**), משרד (עריכה לבעלים + קוד) — ללא מיגרציה (RLS קיים). סוגר את באג ה-404 (`/settings`→307). חלק 2 ([PR #52](https://github.com/Liran-Raz/AVI.APP1/pull/52), `24412cd`): טאב התראות + מיגרציה **0019** (`profiles.notification_prefs jsonb`) — **הוחלה+אומתה ע"י Liran ב-Dashboard**; טוגל "מייל בשיוך משימה" מצומד ל-`sendAssignmentEmailIfNeeded`. GET smoke ירוק. (הערת דפלוי: build המיזוג נכשל אצל Vercel בשלב clone — חולף; retrigger ב-`670f671` = success.) |
| DEV-010 | תרגום שדות טפסים ל-EN (login/signup/onboarding) | UX/i18n | P3 | ממתין | 2026-07-11 | כרגע רק מסגרת השיווק דו-לשונית; תוויות שדות הטפסים העובדים נשארות עברית גם ב-EN. **ללא מיגרציה** — עבודת i18n זהירה על טפסים חיים (לא לשבור פונקציונליות). |
| DEV-011 | בלוק ציטוט לקוח אמיתי בנחיתה | שיווק/תוכן | P3 | ממתין | 2026-07-11 | תלוי-תוכן: דורש ציטוט אמיתי ממשרד השותף של Liran. מיקום מוכן בעיצוב הנחיתה. ללא מיגרציה. |
| DEV-012 | לוגו + ח.פ./מספר עוסק למשרד (בהגדרות) | פיתוח | P3 | ממתין | 2026-07-11 | הרחבת טאב "משרד" ב-`/settings`. **דורש מיגרציה** (עמודות חדשות ב-`organizations`: `logo_url`, `business_number`) + העלאת קובץ ללוגו (Supabase Storage — משטח חדש). |
| DEV-013 | אימות דו-שלבי (2FA) | אבטחה | P3 | ממתין | 2026-07-11 | רלוונטי-אבטחה (נתונים פיננסיים — יכול לעלות ל-P2). דרך Supabase Auth MFA (TOTP) + UI הרשמה/אימות בטאב "אבטחה". קונפיג Supabase + קוד. |
| DEV-014 | השתקת התראות בפעמון (in-app) לפי העדפה | פיתוח | P3 | ממתין | 2026-07-11 | משלים את DEV-009 חלק 2 (שם רק המייל ניתן לכיבוי). התראות הפעמון נוצרות ע"י trigger ב-DB → **דורש מיגרציה** (עדכון `notify_on_task_assignment` לבדוק `notification_prefs`) או סינון בקריאה. |
| DEV-015 | סביבת staging (Vercel Preview עם env משלה) | תשתית/DevX | P3 | ממתין | 2026-07-11 | לבדוק מיילים/Auth/מיגרציות בלי לגעת ב-Production. ערכה התחדד ב-DEV-009 (QA של חלק 2 דרש להחיל מיגרציה על prod-DB לפני בדיקה) + כשל build ה-Vercel. קונפיג Vercel/Supabase, בלי קוד מהותי. |
| DEV-016 | `<noscript>` fallback לנחיתה | תשתית/נגישות | P3 | ממתין | 2026-07-11 | ה-`.reveal`/hero מתחילים מוסתרים ונחשפים ב-JS → בלי JS הדף כמעט ריק. Google מריץ JS (SEO תקין), אבל fallback חסין יותר. ללא מיגרציה. |
| DEV-017 | הפעלת Google OAuth (קונפיג בלבד) | תשתית | P3 | **הושלם** | 2026-07-11 | **חי בפרודקשן.** קונפיג בלבד ב-Google Cloud + Supabase (אפס שינוי קוד). משתמש קיים נבדק חי (הגיע ל-`/tasks`); משתמש חדש מאומת בקוד בלבד (אותו שער onboarding כמו הרשמה רגילה). |
| DEV-018 | באגים בטאב "התראות" (`/settings`) — רגרסיות מ-DEV-009 חלק 2 | באג | P2 | **הושלם** | 2026-07-11 | **חי בייצור** ([PR #53](https://github.com/Liran-Raz/AVI.APP1/pull/53), main `36b725d`, Vercel success, QA ע"י Liran). (א) הטוגל "מתאפס" → מקור-האמת הורם ל-`SettingsPage` (לא מתפרק במעבר טאבים); הטופס controlled. (ב) ה-thumb יוצא מהמסגרת ב-RTL → translate מכוון-כיוון (`ltr:translate-x-[18px]` / `rtl:-translate-x-[18px]`) ב-`ui/switch.tsx`; אומת דטרמיניסטית (מדידת DOM: 0 overflow). |

*(פריטים נוספים ייכנסו כאן עם `DEV-XXX` חדש.)*

---

## פירוט פריטים

### DEV-001 — הפעלת דגלי ניהול תפקידים מותאמים

**רקע:** ב-2026-07-06 הוחלו ואומתו ב-Production שלוש מיגרציות (`0015_audit_events`,
`0016_role_management_rpcs`, `0017_membership_role_id_sync`) שמוסיפות תשתית מלאה לניהול
תפקידים מותאמים (Custom Roles) — אבל **במצב דורמנטי לחלוטין**: אף role (כולל
`service_role`) לא יכול להריץ אף אחד מ-5 ה-RPCs, ואין מדיניות RLS. כל 4 הדגלים
(`ROLES_MANAGEMENT_UI`, `ROLES_MANAGEMENT_WRITE`, `DB_ROLE_RESOLVER_SHADOW`,
`DB_ROLE_AUTHORITATIVE`) כבויים ב-Vercel.

**מה כבר קיים בקוד (ממוזג, מגודר-דגל, לא פעיל):**
- מסך `/roles` מלא (`web/src/components/roles/roles-page.tsx`) — טבלת תפקידים + דיאלוג
  יצירה/עריכה עם בורר הרשאות מקובץ לפי קטגוריה (`permission-catalog.ts`).
- API routes: `web/src/app/api/roles/*` — list/create/update/delete/duplicate.
- 5 RPCs ב-DB (`create_org_role`, `update_org_role`, `delete_org_role`,
  `duplicate_org_role`, `list_org_roles`) — כתובים, מאומתים, אבל דורמנטיים.

**מה נדרש כדי להפעיל בפועל (4 צעדים, כל אחד הפיך בנפרד):**

| שלב | פעולה | היקף |
|---|---|---|
| 1 | מיגרציה קטנה: `grant execute on function list_org_roles(uuid) to authenticated` | RPC אחד, קריאה בלבד |
| 2 | דגל `ROLES_MANAGEMENT_UI=1` ב-Vercel + redeploy | קונפיג בלבד |
| 3 | מיגרציה קטנה: `grant execute` על 4 ה-RPCs של כתיבה ל-`authenticated` | 4 RPCs |
| 4 | דגל `ROLES_MANAGEMENT_WRITE=1` ב-Vercel + redeploy | קונפיג בלבד |

אפשר לעצור אחרי שלב 2 (Owner/Manager רואים רשימת תפקידים לקריאה בלבד, בלי יכולת יצירה)
— זה השלב הכי בטוח אם רוצים להראות ללקוח "יש לנו את זה" בלי לפתוח משטח כתיבה.

**מגבלה קריטית שחשוב לזכור:** גם אחרי כל 4 השלבים — **אי אפשר לשייך תפקיד מותאם לאף
עובד**. Decision A (חוקי הטריגר ב-0017) חוסם את זה במפורש ברמת ה-DB, ללא קשר לדגלים.
Owner יכול רק **להגדיר** תפקידים (סטים של הרשאות) — לא לתת אותם למישהו. שיוך בפועל =
DEV-003, פרויקט נפרד וגדול יותר.

**מה זה כן נותן:** Owner יכול ליצור למשל תפקיד "מנהל חשבונות בכיר" עם סט הרשאות מדויק,
לערוך/לשכפל/למחוק אותו. שימושי כתשתית והדגמה, אבל **אין השפעה תפקודית על שום עובד קיים**
— מסך "צוות" והתפקידים הקבועים (Owner/Manager/Employee) ממשיכים לעבוד בדיוק כמו היום,
ללא תלות בזה.

**החלטה נוכחית:** Liran בחר לעצור ולא להפעיל, כי הצורך המיידי (יוזרים, פירמידת הרשאות,
כתיבה/שליחת משימות בין הצוות) כבר מכוסה במלואו ע"י מסך "צוות" הקיים (Owner יכול כבר
היום להפוך עובד למנהל ולהפך, דרך תפריט הפעולות בשורת החבר).

---

### DEV-002 — לחצן "מצאת תקלה?" + פופ-אפ דיווח + לוגים

**הבקשה המקורית:** כפתור גלוי בתוכנה שאומר "מצאת תקלה?" — לחיצה עליו פותחת פופ-אפ שבו
המשתמש מתאר במה נתקל. הצוות מקבל את התיאור **יחד עם לוגים של המערכת** כדי לדעת מה
המשתמש ניסה לעשות ואיפה הוא נתקע.

**החלטות נעולות (2026-07-06) — ההיקף סגור, מוכן למימוש:**

1. **מי יכול להגיש דיווח:** רק משתמשים מחוברים, בכל מסכי הדשבורד (לא מסכי login/signup הציבוריים).
2. **מי רואה את הדיווחים:** התראת מייל בכל דיווח חדש + קריאה ידנית בטבלה ב-Supabase
   Dashboard. אין מסך ניהול פנימי בשלב הזה.
3. **אילו לוגים נאספים — צד-לקוח בלבד, אין רכיב שרת:**
   - שגיאות קונסולה + בקשות רשת (API) שנכשלו.
   - **שביל פעולות/לחיצות** — היסטוריית מסכים/כפתורים שהמשתמש עבר לפני שנתקע (זה החלק
     החדש: דורש בניית "רושם פעולות" קליינטי קל-משקל — ring buffer בזיכרון של N הפעולות
     האחרונות, לא קיים היום, צריך לבנות).
   - הקשר בסיסי: משתמש, ארגון, דף נוכחי, דפדפן, timestamp.

   **הוחלט במפורש: אין צורך בלוגים מצד השרת (Vercel/DB) — ההיסטוריה הקליינטית מספיקה.**
   זה גם מפשט את הבנייה (לא צריך Vercel Pro / Log Drain / טבלת-לוגים-שרת נפרדת).

**נבנה 2026-07-07 (`feat/bug-report-button`, PR ממתין ל-Liran). `tsc`/`lint`/308
בדיקות/`build` — כולם ירוקים.**

**מה נבנה:**
- מיגרציה `supabase/migrations/0018_bug_reports.sql` — טבלת `bug_reports`
  (org-scoped, RLS-on, **INSERT-only** policy — כמו clients/tasks, לא כמו ה-RPC-only
  pattern של תפקידים). **✅ הוחלה ואומתה ב-Production ב-2026-07-07** (`rls_on=true`,
  `policy_count=1`, 0 שורות).
- `lib/bug-report-tracker.ts` — "רושם פעולות" קליינטי: עוטף `console.error`
  ו-`window.fetch` (בלי לשבש את ההתנהגות המקורית), מאזין ללחיצות על כפתורים/קישורים,
  ורושם ניווטים בין דפים. שלושה ring buffers מוגבלים (20/20/30 אחרונים).
  שום דבר לא נשלח לשום מקום עד שליחה מפורשת של דיווח.
- כפתור + חלונית `components/bug-report/report-bug-button.tsx`, מוצב פעם אחת ב-
  `app-shell.tsx` כך שמופיע בכל מסכי הדשבורד.
- שכבות שרת מלאות (validator עם תקרות גודל מפורשות · repository · service ·
  API route) לפי מבנה הפרויקט הרגיל, כולל מייל התראה best-effort
  (`emails.service.ts` → `sendBugReportNotificationEmail`) שלא מפיל את הבקשה אם
  השליחה נכשלת.

**מה נשאר — 2 צעדים ידניים של Liran (שום דבר מזה אני יכול לעשות, אין לי הרשאות
Vercel/אין לי אישור למזג בעצמי):**
1. ~~להחיל את מיגרציה 0018~~ ✅ **בוצע 2026-07-07.**
2. **להוסיף ב-Vercel:** `BUG_REPORT_NOTIFY_EMAIL=liran995@gmail.com` (best-effort —
   הפיצ'ר עובד גם בלעדיו, רק בלי מייל התראה). `RESEND_API_KEY`/`MAIL_FROM` כבר
   מוגדרים מהעבר.
3. **למזג את [PR #41](https://github.com/Liran-Raz/AVI.APP1/pull/41).**

**עדיפות:** פיצ'ר עצמאי, לא תלוי ב-DEV-001/DEV-003.

---

### DEV-003 — Authoritative Cutover (שיוך תפקידים מותאמים בפועל)

**מה זה:** הפרויקט ה"אמיתי" מאחורי הרעיון של תפקידים מותאמים — Owner בונה תפקיד ומשייך
אותו לעובד ספציפי, וההרשאות של אותו עובד נגזרות מהתפקיד המותאם ולא רק מ-3 התפקידים
הקבועים.

**מה זה דורש (scope גס, לא מתוכנן ברמת ביצוע):**
1. שינוי חוקי Decision A עצמם (כרגע ה-DB דוחה בפירוש כל שיוך של תפקיד מותאם — `sync_membership_role_id`
   trigger, מיגרציה 0017) — צריך להחליט על מודל חדש: מתי מותר, אילו הגנות (למשל Owner
   תמיד נשאר Owner, לא ניתן לשלול הרשאות קריטיות).
2. UI חדש במסך "צוות" — לאפשר לבחור תפקיד מותאם בנוסף ל-3 הקבועים בתפריט "שינוי תפקיד".
3. מעבר מנוע ההרשאות (`web/src/server/auth/authorization.ts`) מקריאה מ-`ROLE_GRANTS`
   הסטטי לקריאה מה-DB בזמן אמת — יש כבר resolver "צל" מוכן ולא-פעיל (`db-role-resolver.ts`)
   משלבים קודמים, כולל שלב "צל" מבוקר להשוואה לפני מעבר מלא.
4. RLS policies אמיתיות על טבלאות `roles`/`role_permissions` (כרגע fail-closed לגמרי —
   נגישות רק דרך ה-RPCs).

**סטטוס:** לא תוכנן ברמת ביצוע, לא נקבע timeline. פרויקט נפרד לחלוטין מ-DEV-001 —
דורש שיחת תכנון משלו לפני שמתחילים.

---

### DEV-004 — `RESEND_API_KEY`/`MAIL_FROM` לא מוגדרים ב-Production (באג תשתית)

**איך התגלה:** Liran שלח דיווח-תקלה אמיתי דרך הכפתור החדש (DEV-002) ולא קיבל מייל
התראה. אבחון: הדיווח **כן נשמר** בטבלת `bug_reports` (הוכיח שהקוד/RLS/validator
תקינים), אבל לוג ה-Runtime ב-Vercel הראה `[bug-reports.service] notification email
send failed { category: 'config_error' }`. `category: 'config_error'` הוא
`EmailConfigError` — נזרק **רק** כש-`RESEND_API_KEY`/`MAIL_FROM` חסרים/ריקים בסביבה
פרוסה (`web/src/server/email/email.ts`, `makeUnconfiguredEmailAdapter`). אושר סופית:
חיפוש ישיר ב-Vercel → Environment Variables עבור `RESEND` ו-`MAIL_FROM` — **אפס
תוצאות לשניהם**.

**היקף הפגיעה — לא רק DEV-002:**
- **הזמנות צוות** (`team.service.ts inviteMember`) — עוברות **דרך אותו מנגנון שליחה
  בדיוק** (`getEmailAdapter()`). כל הזמנה עד עכשיו כנראה נכשלה בשליחת המייל בפועל.
  יש כאן belt-and-suspenders מכוון מעבודת האבטחה הקודמת (F7, "email fail-loud"): ה-UI
  **כן** מציג אזהרה כתומה "ההזמנה נוצרה אך המייל לא נשלח — העתק/י את הקישור ושלח/י
  ידנית" — כלומר שום הזמנה לא אבדה, אבל יכול להיות שאף מייל הזמנה אמיתי לא יצא
  מעולם והמנהלים תמיד העתיקו קישור ידנית מבלי לשים לב לסיבה.
- **דיווחי תקלה** (DEV-002) — נכשל **בשקט מוחלט** (best-effort בכוונה, לא חוסם את
  המשתמש) — אין שום אזהרה גלויה, רק הדיווח עצמו שנשמר.

**זה לא באג בקוד.** שני מסלולי השליחה עובדים בדיוק כמו שתוכננו (fail-loud בפנים,
best-effort/מוצג-בכנות כלפי חוץ) — זה פשוט צעד תשתית (חשבון Resend + אימות דומיין +
2 משתני סביבה) שמעולם לא הושלם ב-Production. **היה כבר מתועד כ"פתוח" בעבודת
F7/Stage 4 של האבטחה** (בדיקת-שמות-בלבד ב-Vercel לפני כמה שבועות) — ועכשיו יש אישור
התנהגותי ישיר שהוא עדיין פתוח.

**איך לתקן (Liran, לא קוד):**
1. חשבון ב-[Resend](https://resend.com).
2. אימות דומיין שליחה (Resend נותן רשומות DNS להוספה).
3. יצירת API key ב-Resend.
4. ב-Vercel → Environment Variables → Production: להוסיף `RESEND_API_KEY` (המפתח)
   ו-`MAIL_FROM` (כתובת מהדומיין המאומת, למשל `AVI.APP <noreply@yourdomain.com>`).
5. לבדוק מחדש: לשלוח הזמנת-צוות בדיקה + דיווח-תקלה בדיקה, לוודא ששניהם מגיעים בפועל.

**עדיפות:** P1 — יש עקיפה ידנית להזמנות (קישור להעתקה), אז זו לא תקלה חוסמת-לגמרי,
אבל זו פונקציונליות ליבה (מיילים אמיתיים) שלא עובדת מאז ומעולם ב-Production.

**✅ פתרון (2026-07-09):**
1. נרכש דומיין `aviapp1.com` ב-Cloudflare. חובר ל-Vercel: primary =
   `https://www.aviapp1.com`, שורש `aviapp1.com` → 308 → `www`, כתובת ה-Vercel
   הישנה (`avi-app-1.vercel.app`) נשמרה בכוונה.
2. Supabase Auth → Site URL עודכן ל-`https://www.aviapp1.com`; ה-Redirect URLs
   כוללים כעת גם את הדומיין החדש (root + www) לצד הישן.
3. Resend → דומיין `aviapp1.com` במצב **Verified** (שליחה בפועל דרך תת-הדומיין
   `send.aviapp1.com`; `Signed by: aviapp1.com`).
4. Vercel Production env: `NEXT_PUBLIC_SITE_URL=https://www.aviapp1.com`,
   `MAIL_FROM=AVI.APP <noreply@aviapp1.com>`, `RESEND_API_KEY=re_…`.
5. **שורש הבעיה היה ENV, לא קוד** (הקוד עבד בדיוק כמתוכנן — fail-loud כש-
   `RESEND_API_KEY`/`MAIL_FROM` חסרים ב-runtime; הסימפטום `config_error` הוכיח
   ערך **נעדר**, לא מעוות). התיקון: הדבקה מחדש של `RESEND_API_KEY` ב-Vercel +
   אימות `MAIL_FROM` + **Redeploy** (הזרקת ה-env נכנסת לתוקף רק בדפלוי חדש — זה
   הצעד שהכי קל לפספס).

**אימות בפרודקשן:**
- **דיווח-תקלה:** Resend Logs `POST /emails → 200`; המייל הגיע ל-Gmail;
  `From: AVI.APP <noreply@aviapp1.com>`.
- **הזמנת-צוות:** המייל הגיע בפועל; `From: AVI.APP <noreply@aviapp1.com>`;
  קישור ההזמנה מצביע ל-`https://www.aviapp1.com/invite/accept`.

שני מסלולי המיילים הקריטיים (bug reports + team invitations) עובדים ב-Production.

---

### DEV-005 — תיקון `reset-password` → `confirm_failed`

**הבעיה:** קליק על קישור איפוס-סיסמה הוביל ל-`aviapp1.com/login?error=confirm_failed`
במקום למסך "הגדרת סיסמה חדשה" — כלומר משתמש ששכח סיסמה לא יכל לאפס אותה.

**שורש הבעיה (מאושר מבנית):** `@supabase/ssr` עובד ב-**PKCE flow** כברירת מחדל, אז
קישור האיפוס חוזר ל-`/auth/confirm` עם `?code=`. אבל הראוט ידע לטפל **רק** ב-
`token_hash` (`verifyOtp`), לא מצא אותו, וקפץ מיד ל-`confirm_failed`. הראוט התאום
`/auth/callback` כבר טיפל ב-`?code=` (OAuth) — הייתה כאן אי-עקביות בין השניים.

**✅ תוקן בקוד (2026-07-09):**
- `web/src/app/auth/confirm/route.ts` — מטפל כעת ב-**שני** הפורמטים: `?code=`
  (PKCE → `exchangeCodeForSession`) **וגם** `token_hash`+`type` (OTP → `verifyOtp`,
  ללא שינוי). + לוג אבחון בטוח בנתיב הכשל (בלי ערכי token/code).
- `web/src/server/services/auth.service.ts` — פונקציה `exchangeEmailLinkCode`
  (provider-agnostic).
- `web/src/app/auth/confirm/route.test.ts` — 8 בדיקות (code/token_hash/כשלים/
  ברירת-מחדל/חסימת open-redirect). מכלול: tsc/lint/316 בדיקות/build ירוקים.

**⚠️ מגבלת PKCE + המלצה משלימה:** PKCE דורש שהקליק על הקישור יהיה מאותו דפדפן שבו
התבקש האיפוס (cookie זמני) — עובד "אותו מכשיר", **נכשל cross-device**. הפתרון
היציב יותר (ללא קוד, ב-Dashboard): לשנות את **תבנית מייל האיפוס** ב-Supabase
לפורמט `token_hash` שמצביע ל-`/auth/confirm` — הראוט **כבר תומך בזה** (הנתיב השני),
אז זה עובד גם cross-device ללא שינוי קוד נוסף.

**סטטוס:** ✅ **הושלם ואומת בפרודקשן (2026-07-09).** בוצע: (א) קוד `/auth/confirm`
ממוזג (PR #43); (ב) תבנית Reset Password ב-Supabase הוחלפה לפורמט `token_hash`
(`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`);
(ג) אימות ידני מקצה-לקצה — קישור-איפוס אמיתי → מסך "הגדרת סיסמה חדשה" → הסיסמה
עודכנה → כניסה עם החדשה → הסיסמה הישנה כבר לא עובדת.

---

### DEV-006 — Supabase Auth Custom SMTP דרך Resend

**רקע:** אחרי DEV-004, מיילי ה-**אפליקציה** (דיווח-תקלה, הזמנת-צוות) יוצאים דרך
Resend מהדומיין המאומת. אבל מיילי ה-**Auth** של Supabase (אימות הרשמה, איפוס סיסמה)
עדיין נשלחים דרך ה-SMTP המובנה של Supabase (`noreply@mail.app.supabase.io`),
שכפוף ל-rate limit נמוך מאוד — נצפה `429 email rate limit exceeded` בבדיקות.

**הפתרון:** לחבר **Supabase Auth → Custom SMTP → Resend** (Dashboard, ללא קוד):
מעביר את כל מיילי ה-Auth לדומיין `aviapp1.com` (במקום `supabase.io`), מבטל את
ה-rate limit, ומאפשר גם תבניות מייל בעברית.

**פרטי SMTP של Resend** (לשימוש בהגדרות Supabase):
- Host: `smtp.resend.com` · Port: `465` · Username: `resend` (מחרוזת מילולית) ·
  Password: מפתח API של Resend (`re_…`).
- Sender email: `noreply@aviapp1.com` (חייב מהדומיין המאומת) · Sender name: `AVI.APP`.
- קיצור דרך: אינטגרציית **Resend↔Supabase** הרשמית ממלאת את הכל אוטומטית.

**סטטוס:** ✅ **הושלם ואומת בפרודקשן (2026-07-09).** חובר דרך אינטגרציית
Resend↔Supabase הרשמית (Project=AVI.APP1, domain=aviapp1.com, API key
"Supabase Integration", Sender=`noreply@aviapp1.com`). **הוכחה:** מייל
איפוס-סיסמה הגיע מ-`AVI.APP <noreply@aviapp1.com>` (במקום `supabase.io`), ו-Resend
Logs הראה `POST /emails → 200` על אותו מייל. כל מיילי ה-Auth (אימות הרשמה, איפוס
סיסמה) יוצאים כעת מהדומיין `aviapp1.com`, ומגבלת ה-429 של Supabase בוטלה.

**נלווה (P3):** סביבת **staging** נפרדת עתידית (Vercel Preview עם env משלו) לבדיקת
מיילים/Auth בלי לגעת ב-Production.

---

### DEV-007 — חיווי ויזואלי בהזנת אותה סיסמה נוכחית באיפוס

**הבעיה:** במסך "הגדרת סיסמה חדשה", אם המשתמש מזין סיסמה **זהה** לנוכחית, Supabase
דוחה את הבקשה (`same_password`) — אז המערכת "לא נותנת להמשיך", אבל לא הסבירה **למה**:
ההודעה הופיעה כ-toast חולף באנגלית ("New password should be different…"), שמשתמש
דובר-עברית לא בהכרח קלט או הבין.

**הפתרון (2 שכבות):**
- **שרת** (`web/src/server/auth/supabase-auth.adapter.ts`, `updatePassword`): מזהה את
  שגיאת ה-`same_password` (לפי `error.code` או הודעת הספק) ומחזיר `ValidationError`
  עם `details.reason = "same_password"` — סימון יציב וקריא-מכונה (לא טקסט אנגלי גולמי).
- **לקוח** (`web/src/app/reset-password/reset-password-form.tsx`): מזהה את הסימון
  ומציג **חיווי אדום קבוע בעברית** מתחת לשדה הסיסמה — "הסיסמה החדשה חייבת להיות שונה
  מהסיסמה הנוכחית" — + `aria-invalid` על השדה + toast. החיווי נמחק ברגע שהמשתמש משנה
  את הסיסמה.
- **בדיקות** (`supabase-auth.adapter.test.ts`): 5 בדיקות — זיהוי לפי code, זיהוי לפי
  הודעה, 422 אחר (בלי הסימון), 401→Unauthorized, הצלחה.

**הערה:** רק השרת (Supabase) יודע מהי הסיסמה הנוכחית, לכן "אותה סיסמה" ניתן לזהות
**רק אחרי** שליחה — לא ב-client-side pre-check. `tsc`/`lint`/321 בדיקות/`build` ירוקים.

**סטטוס:** ✅ **הושלם ואומת בפרודקשן (2026-07-09).** הזנת אותה סיסמה נוכחית באיפוס
מציגה מסגרת אדומה על השדה + ההודעה בעברית, כמצופה.

---

### DEV-008 — עיצוב "Liquid Glass" (Calm) ל-UI הפנימי + רספונסיביות נייד

**רקע:** אחרי שעיצוב ה"Liquid Glass" עלה לשיווק (נחיתה/login/signup, PR #47), נוצר
פער בין השיווק היפה לאפליקציה הפנימית. המטרה: להביא את אותה שפה ל-UI הפנימי (דשבורד)
— **בלי לשבור פונקציונליות**, על נתונים פיננסיים חיים של ~300 עסקים.

**מודל עבודה:** preview-first, approval-gated (כמו בשיווק). נבנתה תצוגה מקדימה סטטית
של מסך המשימות (`.claude/design-preview/dashboard.html`, gitignored, פורט 4173) עם
מתג Calm⇄Ambient. **Liran בחר "Calm"** (רקע סטטי רך, זכוכית על השלד בלבד, כרטיסי תוכן
כמעט-אטומים לקריאוּת — מתאים לכלי-עבודה יומיומי) ואישר את המראה.

**מה נבנה (Round 1) — 8 קבצים:**
- **יסוד גלובלי** (`globals.css`): רקע-דף Calm (גרדיאנט נייבי+כחול **סטטי**, בלי
  aurora נע) + מחלקות זכוכית (`glass-sidebar/topbar/mobilenav/column/card`,
  `nav-active-glow`). אף טוקן צבע קיים לא שונה → בידוד `.mkt` נשמר (`:root --accent`
  עדיין `#e6e8ea`, מאומת חי).
- **שלד** (`app-shell.tsx`): sidebar נייבי-זכוכית, topbar מט **דביק-בגלילה**,
  mobile-nav מט, פריט ניווט פעיל זוהר בכחול. תיקון קריאוּת אגבי: טקסט המותג/שם-משרד
  בסיידבר (היה כהה-על-נייבי, גבולי) → לבן.
- **תיקון רספונסיביות (הבאג שדווח):** מסכי **צוות + לקוחות** רונדרו כטבלאות רחבות
  בתוך `overflow-hidden` → בנייד נחתכו (תפריט הפעולות מחוץ למסך). תוקן לפריסה כפולה:
  `<Table>` בדסקטופ (`hidden md:block`) + **כרטיסים מוערמים בנייד** (`md:hidden`), עם
  תפריט-פעולות משותף (התנהגות/הרשאות זהות בשני המצבים). בלקוחות: טלפון/אימייל בנייד =
  קישורי `tel:`/`mailto:` לחיצים.
- **פוליש עקביות:** עמודות/כרטיסי משימות, לוח-שבועי, פרטי-לקוח → אותה זכוכית.

**אימות:** `tsc`/`lint`/`build` ירוקים; אפס שגיאות קונסול; בידוד מוכח חי (`/login`
מרונדר עם `.mkt`, `:root --accent` לא נגע). ה-QA הוויזואלי של המסכים המאומתים = Liran
(Claude לא מחובר). **Liran אישר: "נראה טוב — אישור להמשיך לייצור" (2026-07-10).**

**נדחה (אופציונלי, Round הבא):** תרגום שדות טפסים ל-EN; מסך `/settings` (קיים בניווט
אך אין ראוט תואם — פער קדום, מחוץ להיקף); עמוד `/roles` (דורמנטי מאחורי דגל).

**סטטוס:** ✅ **הושלם + חי בייצור (2026-07-10).** [PR #49](https://github.com/Liran-Raz/AVI.APP1/pull/49)
squash-merged (main `8fc343c`), Vercel deploy=success, GET smoke ירוק (health/login/signup
200, tasks/clients/team 307-לא-מאומת). ה-QA הוויזואלי המאומת נעשה ע"י Liran. **זהו Round 1**
— אפשר להמשיך לעמודים/מרכיבים נוספים ולפריטים הנדחים בהמשך.

---

### DEV-009 — מסך הגדרות (`/settings`)

**רקע:** הניווט (sidebar + תפריט משתמש) קישר ל-`/settings` אבל לא היה ראוט כזה → 404
(סומן ב-DEV-008). Liran בחר היקף **מלא** למסך: פרופיל · אבטחה · משרד · התראות.

**ממצא ארכיטקטוני מפתח:** מדיניות RLS לעדכון-עצמי כבר הוכנו מראש ב-DB — `"users update
own profile"` (0009, עם הערה *"settings: name/avatar/phone"*) ו-`"owner can update own
org"` (0003/0009). לכן עריכת פרופיל ומשרד דורשות רק שכבת-אפליקציה, **בלי מיגרציה**. רק
העדפות התראות דורשות מיגרציה (אין היום אחסון העדפות).

**חלק 1 — נבנה + אושר ב-QA (2026-07-10), ללא מיגרציה:**
- **טאב פרופיל:** עריכת שם + טלפון (אימייל ותפקיד לקריאה) + התנתקות.
  `updateProfileSchema` (whitelist שם/טלפון בלבד) → `profile.repository.updateOwnProfile`
  → `profile.service` → `PATCH /api/me/profile` → `apiClient.me.updateProfile`.
- **טאב אבטחה:** שינוי סיסמה **עם אימות סיסמה נוכחית** — `auth.service.changePassword`
  מאמת מחדש (`signIn`) לפני `updatePassword`; סיסמה נוכחית שגויה → `ValidationError
  {reason:"wrong_current_password"}`. `POST /api/auth/change-password`. הטופס במתכונת
  `reset-password-form` (חיוויים inline).
- **טאב משרד:** בעלים עורך שם/אימייל/טלפון/כתובת (`org_code` לא ניתן לעריכה, עם העתקה);
  לא-בעלים רואה לקריאה. `updateOrganizationSchema` → `organization.repository.update` →
  `organization.service` (assert owner) → `PATCH /api/organization`.
- UI: `(dashboard)/settings/page.tsx` (+`loading.tsx`) + `components/settings/*`
  (`settings-page` Tabs + 3 טפסים), זכוכית Calm, RTL. **אימות:** tsc/lint/build ירוקים;
  `/settings`→307 (404 נעלם); 3 ה-API→401 unauth; אפס שגיאות שרת. QA ידני ע"י Liran.

**חלק 2 — נבנה (ענף `feat/settings-notifications`), ממתין להחלת מיגרציה 0019:** טאב **התראות**
— עמודת `profiles.notification_prefs jsonb` (מיגרציה `0019_notification_prefs.sql`; additive,
NOT NULL DEFAULT `'{}'`; **מדיניות `"users update own profile"` הקיימת מכסה עדכון-עצמי — בלי
policy חדש**). שכבת אפליקציה: `updateNotificationPrefsSchema` · `profile.service`
(`NotificationPrefs`/`readNotificationPrefs`/`getNotificationPrefs`/`updateMyNotificationPrefs`,
merge חלקי, ברירת מחדל ON) · `GET+PATCH /api/me/notification-prefs` · `apiClient.me.
notificationPrefs`/`updateNotificationPrefs` · טוגל `Switch` (רכיב `ui/switch.tsx` חדש מ-
`radix-ui`, בלי dependency, עם RTL) · **הצמדה:** `tasks.service.sendAssignmentEmailIfNeeded`
מדלג על המייל כש-`emailOnTaskAssignment===false` (הפיד/פעמון נשאר always-on). +עמודת
`notification_prefs` נוספה לטיפוס ה-hand-written `database.types.ts`. tsc/lint/build ירוקים;
`/api/me/notification-prefs`→401 unauth. **⚠️ Liran מריץ 0019 ידנית ב-Dashboard (role postgres)
לפני מיזוג — PATCH ייכשל עד אז (העמודה חסרה). לא ממזגים עד שהמיגרציה מוחלת + QA.**

**נדחה:** תרגום שדות ל-EN; לוגו/ח.פ. למשרד; 2FA/ניתוק-מכשירים; מעבר-משרד בתוך המסך;
השתקת התראות בפעמון (trigger-level).

**סטטוס:** ✅ **הושלם — שני החלקים חיים בייצור (2026-07-10).** חלק 1
([PR #51](https://github.com/Liran-Raz/AVI.APP1/pull/51), `59177d2`) + חלק 2
([PR #52](https://github.com/Liran-Raz/AVI.APP1/pull/52), `24412cd`); מיגרציה 0019
הוחלה+אומתה ע"י Liran ב-Dashboard; GET smoke ירוק. **הערת דפלוי:** build המיזוג של חלק 2
נכשל אצל Vercel בשלב ה-clone (תקלת תשתית חולפת, "try rebuilding") — הקוד תקין (build
מקומי + כל בדיקות ה-CI כולל `validate-migrations` היו ירוקים); retrigger ע"י empty commit
`670f671` → build תקין. **לקח:** כשל Vercel בשלב clone = חולף, redeploy — לא לחפש בקוד.

---

### DEV-010 — תרגום שדות טפסים ל-EN

מסגרת השיווק (נחיתה/login/signup) כבר דו-לשונית EN⇄HE עם i18n אמיתי, אבל תוויות
**שדות הטפסים** (`LoginForm`/`SignupForm`/onboarding) נשארות עברית גם במצב EN — הן הטפסים
החיים והעובדים. המשימה: i18n לתוויות/placeholders/הודעות-שגיאה שלהם, **בזהירות לא לשבור**
את הזרימות. ללא DB.

### DEV-011 — בלוק ציטוט לקוח אמיתי

בעיצוב הנחיתה מוכן מקום ל"מה לקוחות אומרים". דרוש **ציטוט אמיתי** ממשרד השותף של Liran
(שם, תפקיד, משפט). תלוי-תוכן — קוד מינימלי אחרי שיש טקסט.

### DEV-012 — לוגו + ח.פ. למשרד

הרחבת טאב "משרד" ב-`/settings`: לוגו המשרד (העלאה) + מספר ח.פ./עוסק של המשרד עצמו.
**דורש מיגרציה** (`organizations.logo_url` + `organizations.business_number`) + Supabase
Storage bucket ללוגו (משטח חדש — כולל RLS על storage). בעלים בלבד (כמו שאר עריכת המשרד,
DEV-009).

### DEV-013 — אימות דו-שלבי (2FA)

דרך Supabase Auth MFA (TOTP/authenticator). UI בטאב "אבטחה": הרשמה (QR + אימות), ניהול
factors, אתגר בכניסה. קונפיג Supabase (Enable MFA) + קוד לא-טריוויאלי. **רלוונטי-אבטחה
לנתונים פיננסיים — שקול להעלות ל-P2.**

### DEV-014 — השתקת התראות בפעמון (in-app)

DEV-009 חלק 2 נתן כיבוי **מייל** בלבד. התראות ה-**פעמון** נוצרות ע"י trigger
`notify_on_task_assignment` (מיגרציה 0002) ברמת DB. כדי לכבד העדפה: **מיגרציה** שמעדכנת
את ה-trigger לבדוק `profiles.notification_prefs`, או סינון בשכבת הקריאה. מפתח pref חדש
ב-JSONB הקיים (לא צריך עמודה נוספת).

### DEV-015 — סביבת staging (Vercel Preview)

env נפרד (Supabase project/branch נפרד) לבדיקת מיילים/Auth/מיגרציות בלי לגעת ב-Production.
ערכה התחדדה כש-QA של DEV-009 חלק 2 חייב להחיל את מיגרציה 0019 על prod-DB לפני בדיקה, וכש-
build ה-Vercel נכשל. קונפיג בלבד (Vercel env scope + Supabase), בלי קוד מהותי.

### DEV-016 — `<noscript>` fallback לנחיתה

אלמנטי `.reveal` וה-hero בנחיתה מתחילים מוסתרים ונחשפים ב-JS (scroll-reveal) → בלי JS
הדף כמעט ריק. Google מריץ JS (SEO תקין), אבל fallback (`<noscript>` שמציג את התוכן, או
ברירת-מחדל גלויה ב-CSS) חסין יותר. שינוי מקומי ב-`marketing`, ללא DB.

### DEV-017 — הפעלת Google OAuth (קונפיג בלבד)

**רקע:** הקוד היה כתוב ומוכן מזמן (`/api/auth/oauth/google`, PKCE server-side,
`/auth/callback`) אבל ה-provider היה כבוי ב-Supabase. השגיאה "Unsupported provider"
שנצפתה בעבר = קונפיג חסר, לא באג. המשימה: קונפיג בלבד, אפס שינוי קוד.

**אימות קוד לפני קונפיג (2026-07-11):** מעבר על כל השרשרת חוליה-חוליה — `login-form.tsx`
(כפתור "המשך עם Google", ללא import supabase) → `apiClient.auth.startOAuthGoogle` →
`POST /api/auth/oauth/google` (`withErrorHandler`) → `auth.service.startOAuth` (בונה
`redirectTo` מוגן open-redirect דרך `sanitizeNextPath`) → `supabase-auth.adapter.startOAuth`
(`signInWithOAuth` + PKCE + `skipBrowserRedirect`) → `/auth/callback`
(`exchangeCodeForSession`). נבדק גם נתיב משתמש-חדש: `(dashboard)/layout.tsx` מזהה
`!session.activeOrg` ומנתב ל-`/onboarding` (אותו שער שכל הרשמת אימייל/סיסמה כבר עוברת
בו ב-Production) — כולל מילוי-מראש של השם מ-metadata של Google. **ממצא צדדי:** כפתור
Google קיים כרגע רק ב-`/login`, לא ב-`/signup` (לא חוסם — OAuth יוצר חשבון ממילא; נשאר
פריט פתוח אופציונלי אם ירצה עקביות ויזואלית בעתיד).

**קונפיג שבוצע (Liran, 2026-07-11):**
1. Google Cloud Console → פרויקט `aviapp-1` → OAuth consent screen: App name AVI.APP,
   External, Publishing status **In production** (scopes לא-רגישים → אין דרישת אימות
   Google, אין מסך "unverified").
2. Credentials → OAuth client (Web application) → Authorized redirect URI:
   `https://xsuvwihfcxinorzutbve.supabase.co/auth/v1/callback`.
3. Supabase Dashboard → Authentication → Providers → Google → Enable + הדבקת
   Client ID/Secret. **אומת קובץ-מול-קובץ** מול ה-JSON שהוריד Liran מ-Google Cloud —
   `client_id`/`client_secret`/`redirect_uris` תואמים במדויק, אפס טעויות הקלדה.

**אימות בפרודקשן (2026-07-11):**
- ✅ **משתמש קיים** — נבדק חי: לחיצה על "המשך עם Google" → הגיע ישירות ל-`/tasks`.
  מוכיח את השרשרת המלאה מקצה-לקצה.
- ⚪ **משתמש חדש** — לא נבדק חי (אין חשבון Google פנוי לבדיקה בזמינות); לחיצה על הכפתור
  פותחת נכון את חלון ההתחברות של Google (מוכיח את שלב ההפעלה). נתיב הנחיתה ב-`/onboarding`
  מאומת בקוד בלבד, דרך אותו שער-onboarding שמוכח יומיומית בהרשמות אימייל/סיסמה רגילות.

**סטטוס:** ✅ **הושלם + חי בייצור (2026-07-11).** אפס שינוי קוד — כל העבודה הייתה קונפיג
(Google Cloud + Supabase Dashboard).

---

### DEV-018 — באגים בטאב "התראות" (`/settings`)

שני באגים שדיווח Liran בטאב "התראות" של מסך ההגדרות — **רגרסיות מ-DEV-009 חלק 2**:

**(א) הבחירה מתאפסת / לא נשמרת (פונקציונלי, P2).** המשתמש מדליק/מכבה את הטוגל אבל
הבחירה חוזרת לברירת המחדל. חשדות (לאמת בזמן התיקון):
1. **Radix `TabsContent` מפרק (unmount) את תוכן הטאב הלא-פעיל** → `NotificationPrefsForm`
   נטען מחדש בכל חזרה לטאב עם ה-prop `initial` שנקבע ב**טעינת השרת** (הדף לא רוענן) → מציג
   את הערך הישן. תיקון אפשרי: להרים את ה-state מעל ה-`Tabs` / למשוך `GET` במאונט /
   `forceMount` על ה-content.
2. ייתכן שה-`PATCH /api/me/notification-prefs` **נכשל** (ואז rollback אופטימי + toast
   שגיאה). פחות סביר — אותו נתיב כתיבת-RLS של עריכת פרופיל (חלק 1) כבר עובד — אבל לאמת
   שהכתיבה מצליחה ונשמרת ב-DB.

**(ב) העיגול הלבן יוצא מהמסגרת שמאל כשדלוק (ויזואלי, P3, RTL).** ב-
`web/src/components/ui/switch.tsx` הטרנספורם ל-RTL (`rtl:data-[state=checked]:-translate-x-4`)
לא נכון — או שמרחק ה-thumb/track לא תואם, או שיש התנגשות בין ה-base
`data-[state=checked]:translate-x-4` ל-`rtl:...-translate-x-4`. תיקון: מרחק thumb נכון
ב-RTL כך שיישאר בתוך המסגרת (למשל טרנספורם מבוסס-אחוזים/logical, או התאמת המידות).

**תוקן (2026-07-11, ענף `fix/settings-notifications-tab`):**
- **(א)** מקור-האמת של העדפת ההתראה הורם ל-`SettingsPage` (מעל ה-`Tabs`, לא מתפרק במעבר
  טאבים); `NotificationPrefsForm` הפך ל-controlled (`value`/`onChange`) עם optimistic +
  rollback. הבחירה שורדת מעבר-טאבים. *(אימות persistence מלא ב-DB = QA של Liran: לכבות +
  F5 → נשאר כבוי.)*
- **(ב)** `ui/switch.tsx`: הוחלף ל-translate **מכוון-כיוון** —
  `ltr:data-[state=checked]:translate-x-[18px]` + `rtl:data-[state=checked]:-translate-x-[18px]`
  (18px = מרחק ה-thumb המדויק בטרק w-9). **אומת דטרמיניסטית** ע"י מדידת DOM בראוט-בדיקה
  זמני (נמחק): RTL → OFF thumb בימין (inset 1px), ON thumb בשמאל (inset 1px), **0 overflow**.

**סטטוס:** ✅ **הושלם + חי בייצור (2026-07-11).** [PR #53](https://github.com/Liran-Raz/AVI.APP1/pull/53)
מוזג (main `36b725d`), Vercel success, אושר ב-QA ע"י Liran ("תקין"). שני הבאגים תוקנו.

---

## היסטוריית שינויים

- **2026-07-06** — יצירת המסמך. תיעוד ראשוני של 3 פריטים: DEV-001 (הפעלת דגלים,
  נדחה בהחלטת Liran), DEV-002 (לחצן דיווח תקלות, לתכנון), DEV-003 (Authoritative
  Cutover, נדחה). רקע: אותו יום הוחלו ואומתו ב-Production מיגרציות 0015-0017
  (תשתית תפקידים מותאמים, דורמנטית לחלוטין).
- **2026-07-06** — DEV-002: נעלו 3 החלטות (רק משתמשים מחוברים / התראת מייל + קריאה
  ידנית ב-Supabase / לוגים משני הצדדים).
- **2026-07-06** — DEV-002: היקף סופי נעול — **אין רכיב שרת** (Liran ויתר עליו במפורש);
  צד-לקוח בלבד: שגיאות+בקשות שנכשלו + שביל פעולות/לחיצות (חדש, דורש בניית "רושם
  פעולות" קליינטי) + הקשר בסיסי. מוכן למימוש בכל שלב.
- **2026-07-07** — DEV-002: **נבנה במלואו** (`feat/bug-report-button`, PR #41) — מיגרציה
  0018 + רושם-פעולות קליינטי + כפתור/חלונית + validator/repository/service/route +
  מייל התראה best-effort. `tsc`/`lint`/308 בדיקות/`build` ירוקים.
- **2026-07-07** — DEV-002: Liran **החיל את מיגרציה 0018 ב-Production** ואימת
  (`rls_on=true`, `policy_count=1`). נשאר: `BUG_REPORT_NOTIFY_EMAIL` ב-Vercel +
  מיזוג PR #41.
- **2026-07-07** — DEV-002: **הושלם.** `BUG_REPORT_NOTIFY_EMAIL` הוגדר ב-Vercel;
  PR #41 מוזג (`ca0ba6b`); Vercel Production deploy אומת (health/login 200,
  tasks 307-לא-מאומת, ללא 5xx). הכפתור חי בכל מסכי הדשבורד.
- **2026-07-07** — **DEV-004 נפתח.** Liran דיווח שלא קיבל מייל על דיווח-תקלה אמיתי
  ששלח. אבחון משותף (טבלת `bug_reports` → יש שורה, תקין; Vercel Runtime Logs →
  `category: 'config_error'`; חיפוש ב-Environment Variables → `RESEND`/`MAIL_FROM`
  אפס תוצאות) גילה ש-`RESEND_API_KEY`/`MAIL_FROM` מעולם לא הוגדרו ב-Production —
  משפיע גם על הזמנות צוות, לא רק דיווחי-תקלה. P1, ממתין ל-Liran (חשבון Resend +
  אימות דומיין + 2 משתני סביבה).
- **2026-07-09** — **DEV-004 הושלם.** נרכש דומיין `aviapp1.com` (Cloudflare),
  חובר ל-Vercel (`www.aviapp1.com` primary, root→www 308), Supabase Site URL +
  Redirect URLs עודכנו, Resend Verified (שליחה דרך `send.aviapp1.com`).
  שורש הבעיה היה ENV ולא קוד: הדבקה מחדש של `RESEND_API_KEY` + אימות `MAIL_FROM`
  + **Redeploy**. אומת בפרודקשן — דיווח-תקלה + הזמנת-צוות: שני המיילים מגיעים
  בפועל (`From: AVI.APP <noreply@aviapp1.com>`, קישור הזמנה → `www.aviapp1.com`).
  בסשן זה נוסחו ואז שוחזרו (revert) שני לוגים אבחוניים ב-`email.ts` +
  `auth/confirm/route.ts` — לא נדרשו בסוף (הבעיה הייתה ENV); עץ העבודה נותר נקי,
  ללא commit/push של קוד.
- **2026-07-09** — **DEV-005 נפתח.** לאחר סגירת DEV-004: מיילי ה-Auth של
  Supabase עדיין מ-`supabase.io` (rate limit 429) + באג `reset-password`
  `confirm_failed` (אבחון: חוסר `token_hash` בקישור / template ברירת-מחדל).
  הפתרון = Supabase Custom SMTP דרך Resend + תיקון confirm-flow. נדחה ע"י Liran
  כמשימה נפרדת. P2 (אולי P1 אם איפוס-סיסמה שבור לחלוטין).
- **2026-07-09** — **DEV-005 תוקן בקוד + פוצל.** אושר שזה חשוד A (מבני): `/auth/confirm`
  טיפל רק ב-`token_hash`, בעוד PKCE (ברירת-המחדל של `@supabase/ssr`) מחזיר `?code=`.
  תיקון: הראוט מטפל כעת בשני הפורמטים (`code` + `token_hash`), + `exchangeEmailLinkCode`
  בשירות + 8 בדיקות route. הועלה ל-P1 (איפוס-סיסמה חוסם משתמש). ממתין לאימות ידני
  בפרודקשן + המלצה להחליף תבנית מייל ל-`token_hash` (חוסן cross-device). חלק ה-Custom
  SMTP פוצל ל-**DEV-006** (נדחה), יחד עם הערת ה-staging (P3).
- **2026-07-09** — **DEV-005 הושלם ואומת בפרודקשן.** בוצע: החלפת תבנית Reset Password
  ב-Supabase ל-`token_hash` + בדיקה ידנית מקצה-לקצה (קישור אמיתי → מסך סיסמה חדשה →
  עדכון → הסיסמה הישנה כבר לא עובדת). איפוס-סיסמה עובד מלא ב-Production.
- **2026-07-09** — **DEV-007 נפתח + תוקן בקוד.** התגלה בזמן אימות DEV-005: הזנת סיסמה
  זהה לנוכחית נחסמת ע"י Supabase אבל בלי הסבר ברור (toast חולף באנגלית). תיקון: השרת
  (`updatePassword`) מסמן `details.reason="same_password"`, והטופס מציג חיווי אדום קבוע
  בעברית ליד השדה + מנקה אותו בעריכה. +5 בדיקות. `tsc`/`lint`/321 בדיקות/`build` ירוקים.
  ממתין לאימות ידני בפרודקשן.
- **2026-07-09** — **DEV-007 הושלם ואומת בפרודקשן** (PR #44 `91cb868`). הזנת אותה
  סיסמה נוכחית מציגה מסגרת אדומה + הודעה בעברית, כמצופה. אושר ע"י Liran.
- **2026-07-09** — **DEV-006 הועבר ל"בתהליך".** Liran ביקש להתחיל בו. סופק מדריך
  Dashboard מלא (אינטגרציית Resend↔Supabase / הזנת SMTP ידנית: `smtp.resend.com:465`,
  user `resend`, pass = מפתח Resend, sender `noreply@aviapp1.com`) + העלאת rate limits
  + בדיקה. ללא קוד. ממתין לביצוע ידני של Liran + אימות (מייל Auth מגיע מ-`aviapp1.com`).
- **2026-07-09** — **DEV-006 הושלם ואומת בפרודקשן.** Liran חיבר Custom SMTP דרך
  אינטגרציית Resend↔Supabase הרשמית. אומת: מייל איפוס-סיסמה הגיע מ-`AVI.APP
  <noreply@aviapp1.com>` (לא `supabase.io`) + `POST /emails → 200` ב-Resend Logs.
  **כל מיילי המערכת (אפליקציה + Auth) יוצאים כעת מ-`aviapp1.com`; מגבלת 429 בוטלה.**
  סיפור המיילים הושלם במלואו.
- **2026-07-10** — **DEV-008 נפתח + נבנה Round 1.** עיצוב "Liquid Glass" (Calm) ל-UI
  הפנימי + תיקון רספונסיביות נייד. preview-first: נבנתה תצוגה מקדימה של מסך המשימות
  (מתג Calm⇄Ambient), Liran בחר Calm ואישר את המראה. שונו 8 קבצים (globals + shell +
  tasks/clients/team/calendar/client-detail): שלד זכוכית (sidebar/topbar/mobile-nav) +
  פריסה כפולה טבלה/כרטיסים לצוות+לקוחות (תיקון החיתוך בנייד) + פוליש עקביות. אף טוקן
  צבע לא שונה, בידוד `.mkt` מוכח. `tsc`/`lint`/`build` ירוקים. אושר ע"י Liran ("נראה
  טוב — אישור להמשיך לייצור"). ענף `feat/glass-internal-ui`, ממתין מיזוג + דפלוי.
- **2026-07-10** — **DEV-008 הושלם + חי בייצור.** [PR #49](https://github.com/Liran-Raz/AVI.APP1/pull/49)
  squash-merged ל-main (`8fc343c`), Vercel deploy=success, GET smoke ירוק (health/login/signup
  200, tasks/clients/team 307). המיזוג בוצע ע"י Claude לפי אישור מפורש של Liran
  ("יש לך אישור למזג בשמי"). זיכרון הפרויקט עודכן. Round 1 של ה-redesign הפנימי סגור.
- **2026-07-10** — **DEV-009 נפתח + חלק 1 נבנה ואושר.** מסך `/settings` (סוגר את באג ה-404
  בניווט). תוכנן ב-plan mode; Liran בחר היקף מלא (פרופיל/אבטחה/משרד/התראות). ממצא מפתח:
  מדיניות RLS לעדכון-עצמי כבר קיימות → עריכת פרופיל+משרד בלי מיגרציה. חלק 1 (ללא מיגרציה):
  עריכת פרופיל, שינוי סיסמה עם אימות-נוכחית, עריכת משרד לבעלים + התנתקות. ~18 קבצים בתבנית
  השכבתית. `tsc`/`lint`/`build` ירוקים, `/settings`→307, API→401, אפס שגיאות. QA ידני
  אושר ע"י Liran ("בדקתי וזה נראה טוב - יש אישור"). ענף `feat/settings-screen`. חלק 2
  (העדפות התראות + מיגרציה 0019) יתחיל בהמשך.
- **2026-07-10** — **DEV-009 הושלם — חלק 2 (התראות) חי בייצור.** מיגרציה `0019`
  (`profiles.notification_prefs jsonb`, additive, בלי policy חדש) **הוחלה+אומתה ע"י Liran
  ב-Supabase Dashboard** (`information_schema` → `jsonb | NO | '{}'::jsonb`). קוד חלק 2
  ([PR #52](https://github.com/Liran-Raz/AVI.APP1/pull/52)) מוזג ע"י Claude לפי אישור Liran
  ("תמזג יש אישור"): טאב התראות + `ui/switch.tsx` + `GET/PATCH /api/me/notification-prefs`
  + הצמדת מייל שיוך-משימה ל-`emailOnTaskAssignment`. **build המיזוג נכשל אצל Vercel בשלב
  clone (תקלת תשתית חולפת — הקוד תקין: build מקומי + כל CI ירוקים); retrigger ב-empty
  commit `670f671` → success.** GET smoke ירוק (`/settings` 307, כל settings-APIs 401,
  `/api/me/notification-prefs` 401). **מסך ההגדרות המלא (4 טאבים) חי על `www.aviapp1.com`.**
- **2026-07-11** — **נוספו 8 פריטי backlog (DEV-010→DEV-017)** לבקשת Liran, מרשימת
  ה"נחמד-שיהיה" שהיו פזורים בגוף הקובץ/זיכרון: EN לשדות טפסים (010), ציטוט לקוח (011),
  לוגו+ח.פ. למשרד (012), 2FA (013), השתקת התראות-פעמון (014), סביבת staging (015),
  `<noscript>` לנחיתה (016), הפעלת Google OAuth (017). כולם P3, סטטוס "ממתין", לא התחילו.
  שלושה דורשים מיגרציה/משטח DB חדש (012 organizations+storage, 014 trigger); 017 קונפיג-
  בלבד (הקוד מוכן); השאר קוד/תוכן ללא DB.
- **2026-07-11** — **DEV-018 נפתח.** שני באגים בטאב "התראות" (`/settings`) שדיווח Liran,
  רגרסיות מ-DEV-009 חלק 2: (א) הטוגל מתאפס/לא נשמר (חשד: `TabsContent` מפרק ומרנדר מחדש
  עם ה-prop ההתחלתי הישן, ו/או PATCH נכשל — לאמת); (ב) thumb הטוגל יוצא מהמסגרת שמאל
  ב-RTL כשדלוק (טרנספורם `ui/switch.tsx` שגוי). P2.
- **2026-07-11** — **DEV-018 הושלם — חי בייצור** ([PR #53](https://github.com/Liran-Raz/AVI.APP1/pull/53),
  main `36b725d`, Vercel success). (א) הרמת מקור-האמת של הטוגל ל-`SettingsPage` (Radix מפרק
  `TabsContent` לא-פעיל → אובדן state); הטופס controlled. (ב) `ui/switch.tsx` → translate
  מכוון-כיוון (`ltr:translate-x-[18px]`/`rtl:-translate-x-[18px]`), אומת דטרמיניסטית במדידת
  DOM (ראוט-בדיקה זמני שנמחק): RTL OFF=ימין, ON=שמאל, 0 overflow. QA ע"י Liran ("תקין").
  מוזג ע"י Claude לפי אישורו ("תמזג - יש אישור").
- **2026-07-11** — **DEV-017 הושלם — חי בייצור.** אימות קוד מקצה-לקצה (כפתור→apiClient→
  route→service→adapter→callback, כולל נתיב משתמש-חדש ל-`/onboarding`) לפני שהתחיל הקונפיג.
  Liran ביצע: OAuth consent screen (External, In production) + OAuth client עם redirect URI
  מדויק ל-`.../auth/v1/callback` + הפעלת provider Google ב-Supabase עם Client ID/Secret —
  אומתו קובץ-מול-קובץ מול ה-JSON שהוריד מ-Google Cloud, אפס טעויות. נבדק חי עם משתמש קיים
  (הגיע ל-`/tasks`); משתמש חדש לא נבדק חי (אין חשבון פנוי) אך מאומת בקוד דרך שער-onboarding
  קיים ומוכח. אפס שינוי קוד — קונפיג בלבד.
