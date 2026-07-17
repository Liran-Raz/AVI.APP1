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
| DEV-014 | השתקת התראות בפעמון (in-app) לפי העדפה | פיתוח | P3 | **הושלם** | 2026-07-11 | **מוזג לייצור** ([PR #68](https://github.com/Liran-Raz/AVI.APP1/pull/68)). טוגל "פעמון בשיוך משימה" ליד טוגל-המייל; **השתקה רכה** (badge-only) — ההתראה עדיין ברשימת-הפעמון, רק לא נספרת בעיגול-האדום. **ללא מיגרציה** — מפתח `bellOnTaskAssignment` בעמודת `notification_prefs` הקיימת; סינון בשכבת-הקריאה על ה-COUNT בלבד (הטריגרים לא נגעו, לא-הרסני). התראות השלמה/החזרה תמיד מבדגות. |
| DEV-015 | סביבת staging (Vercel Preview עם env משלה) | תשתית/DevX | P3 | ממתין | 2026-07-11 | לבדוק מיילים/Auth/מיגרציות בלי לגעת ב-Production. ערכה התחדד ב-DEV-009 (QA של חלק 2 דרש להחיל מיגרציה על prod-DB לפני בדיקה) + כשל build ה-Vercel. קונפיג Vercel/Supabase, בלי קוד מהותי. |
| DEV-016 | `<noscript>` fallback לנחיתה | תשתית/נגישות | P3 | ממתין | 2026-07-11 | ה-`.reveal`/hero מתחילים מוסתרים ונחשפים ב-JS → בלי JS הדף כמעט ריק. Google מריץ JS (SEO תקין), אבל fallback חסין יותר. ללא מיגרציה. |
| DEV-017 | הפעלת Google OAuth (קונפיג בלבד) | תשתית | P3 | **הושלם** | 2026-07-11 | **חי בפרודקשן.** קונפיג בלבד ב-Google Cloud + Supabase (אפס שינוי קוד). משתמש קיים נבדק חי (הגיע ל-`/tasks`); משתמש חדש מאומת בקוד בלבד (אותו שער onboarding כמו הרשמה רגילה). |
| DEV-018 | באגים בטאב "התראות" (`/settings`) — רגרסיות מ-DEV-009 חלק 2 | באג | P2 | **הושלם** | 2026-07-11 | **חי בייצור** ([PR #53](https://github.com/Liran-Raz/AVI.APP1/pull/53), main `36b725d`, Vercel success, QA ע"י Liran). (א) הטוגל "מתאפס" → מקור-האמת הורם ל-`SettingsPage` (לא מתפרק במעבר טאבים); הטופס controlled. (ב) ה-thumb יוצא מהמסגרת ב-RTL → translate מכוון-כיוון (`ltr:translate-x-[18px]` / `rtl:-translate-x-[18px]`) ב-`ui/switch.tsx`; אומת דטרמיניסטית (מדידת DOM: 0 overflow). |
| DEV-019 | שלב 12 — דרישות מפגישת לקוח (סרגל עליון · מספור משימות · מחזור-חיים חדש · גורם מטפל ללקוח) | פיתוח (רב-סבב) | P2 | **הושלם** | 2026-07-11 | סבב-על: מיגרציה `0020` (חיה) + 4 סבבים — **כולם חיים בייצור** (A/B/C/D) + כפתור "החזר לחדשות". שלב 12 (R1–R7) הושלם. ראה פירוט. |
| DEV-020 | שלב 13 — חידודים ופיתוחים (חוויית לקוחות · התראות · דשבורד · צ'אט) | פיתוח (רב-סבב) | P2 | **הושלם** | 2026-07-11 | 3 סבבים — **כולם חיים בייצור**. **Round 1** (R1/R2/R3 + עדכון-לוח חי) PR #59/#60, `ecdae33`, `0021`. **Round 2 (R4)** דשבורד ניהולי + גישה פר-משתמש + מייל-הזמנה חדש, PR #61, `ff4285e`, `0022`. **Round 3 (R5)** צ'אט "הודעות" (קבוצה+DM, polling), PR #62, `8a99918`, `0023` — כולל **סקירת-אבטחה אדוורסרית (0 ממצאי-אבטחה, 6 תיקוני-נכונות)**. ראה פירוט. |

| DEV-021 | תפריט-צד נפתח בנייד (מגירה) + סרגל תחתון מצומצם | UX/פיתוח | P2 | **הושלם** | 2026-07-12 | **חי בייצור** ([PR #65](https://github.com/Liran-Raz/AVI.APP1/pull/65), main `aae0a05`, Vercel success, smoke ירוק). מגירה **נייבי-זכוכית** מימין (כמו הסייד-בר בדסקטופ): ניווט מלא + כרטיס משתמש (שם/מייל/תג-תפקיד) + מחליף-משרדים + קוד משרד + התנתקות; נסגרת ברקע/X/Escape/ניווט, נעילת גלילה. סרגל תחתון = **תור משימות · לקוחות · הודעות + "תפריט"** (סדר סופי ב-QA; לוח שבועי במגירה). דסקטופ ללא שינוי. עוצב במוקאפ (`.claude/design-preview/menu-preview.html`) ואושר לפני קוד; `app-shell.tsx` בלבד, ללא מיגרציה. הערה: `next build` מקומי קרס גם על main נקי (סביבתי, 0xC0000409) — שער ה-build המחייב היה Vercel CI. |
| DEV-022 | ריאל-טיים דרך Supabase Realtime (צ'אט + עדכוני משימות חיים) | פיתוח/ארכיטקטורה | P3 | נדחה | 2026-07-12 | **מוצר עתידי.** נבחן במועצת-LLM (2026-07-12): **Firebase נדחה** — 2 מודלי-אבטחה (RLS + חוקי-Firebase ביד) מעל נתונים פיננסיים = סיכון דליפה בין-דיירים; backend שני; SDK בדפדפן; ספק+תמחור נוספים. **המסלול כשנממש = Supabase Realtime** (כבר מפורסם ורדום ב-`0004`, אותו Postgres+RLS), צ'אט קודם, כפרויקט ממוקד — מצריך קליינט-Supabase-ראשון-בדפדפן (חריגה ארכיטקטונית מודעת) ונשאר additive ל-polling (backfill ב-reconnect). **טריגר:** צ'אט בשימוש כבד / לקוח מבקש "מיידי" / סקייל של הרבה משרדים. Firebase יחזור לשולחן רק עם מובייל native offline-first. ראה פירוט. |
| DEV-023 | התראות דחיפה בנייד (Web Push / PWA) | פיתוח (רב-סבב) | P3 | ממתין | 2026-07-12 | התראות "כמו הודעת וואטסאפ" שמגיעות לטלפון גם כשהאפליקציה סגורה. יש כבר `manifest.ts` (PWA מותקן ✓); **חסר:** service-worker + מפתחות VAPID + טבלת `push_subscriptions` (**מיגרציה**) + שליחה מהשרת (`web-push`) בנקודות השיוך/מעבר (כמו מסלול-המייל — הטריגרים ב-DB לא יכולים לקרוא לשירות-דחיפה) + מסך-הרשאה + toggle. **מלכוד iOS:** עובד רק ב-PWA שהותקן ("הוסף למסך הבית", iOS 16.4+) — לא בטאב Safari; אנדרואיד חלק יותר. בלי צד-שלישי (VAPID חינמי, תוכן מוצפן E2E). QA כבד על מכשירים אמיתיים (Liran). ראה פירוט. |
| DEV-024 | שלב 14 — שדרוג צ'אט "הודעות" לסגנון וואטסאפ (קבוצות · אישורי-קריאה · עריכה/מחיקה) | פיתוח (רב-סבב) | P2 | **הושלם (R1→R4 חיים)** | 2026-07-13 | **R1 (תשתית מודל-שיחות) חי בייצור** ([PR #71](https://github.com/Liran-Raz/AVI.APP1/pull/71), main `d6166b9`, מיגרציה `0024` הוחלה+אומתה). מודל `conversations`+`conversation_participants`, **fail-closed RPC-only** (לקוח SELECT-בלבד; כל כתיבה דרך RPCs של SECURITY DEFINER), composite-FK, משמר-התנהגות (office+DMs זהים). **סקירה אדוורסרית רב-סוכנית תפסה קריטי self-join + 2 גבוהים — נסגרו לפני ההחלה.** נותרו R2 קבוצות · R3 אישורי-קריאה+badge · R4 עריכה/מחיקה. ראה פירוט. |
| DEV-025 | אפליקציית מובייל בחנות (עטיפת-Capacitor, לא Flutter מלא) | פיתוח/תשתית (רב-סבב) | P3 | **M1 בפרודקשן (בטעות/אינרטי) · המשך נדחה** | 2026-07-13 | **⚠️ M1 (מעטפת Capacitor + iOS project + native-bridge + OAuth deep-link) נבלע בטעות ב-PR #76 (תקלת-סשנים-מקבילים) ומוזג ל-main `9b0b041`. אינרטי בווב (`isNativeApp()` false; `@capacitor/*` ב-dynamic-import של ענף-native בלבד; מסלול OAuth-ווב זהה בית-לבית). המלצת המועצה: להשאיר (revert של 146 קבצים מסוכן יותר). ראה רשומת-התקלה.** **המלצה: לעטוף את אפליקציית-הווב הקיימת ב-Capacitor** (codebase אחד, שימוש-חוזר מלא), **לא Flutter מלא** (מס ×2 לנצח + שכתוב-אבטחה). ה-WebView טוען את הווב → session/API/`requireSession` הקיימים עובדים כמו-שהם; פיצ'רי-אפליקציה מותנים ב-`isNative`. **hosted/OTA → `git push` מעדכן אתר+אפליקציה מיד בלי ביקורת-חנות** (רק שינוי-מעטפת=release נדיר). יכולות-נייטיב דרך plugins/תוספי-Swift: push נייטיבי (APNs/FCM) · וידג'טים + Live-Activities · גישת-מכשיר (GPS→שעון-נוכחות-מיקום, מצלמה, Face ID). עלות: אפל $99/שנה + גוגל $25, ~2-3 שבועות לשיגור. **טראק נפרד — אחרי DEV-024.** ראה פירוט. |

| DEV-026 | מודול הנהלת-חשבונות (חשבוניות/קבלות) + דוחות + **רישום תוכנה ברשות המסים** | פיתוח (רב-סבב) | P2 | **R1–R4 פרוסים בפרודקשן (רדומים, דגל כבוי) · הסימולטור עבר (ליקוי 1006 בלבד)** | 2026-07-17 | סבב-על **ledger-first** (שלב א': המשרד מפיק לעצמו; שלב ב' עתידי: ספרים ללקוחות). v1: מסמכים **305/320/330/400** · מסמכים ממוחשבים (R6) · חשבוניות-ישראל (R5; סף ₪10K→₪5K ב-2026) · **מבנה אחיד v1.31** (R4) · רישום במערכת המקוונת (R7). **R1** = מיגרציה **`0027`** (ledgers+documents+counters ללא-דילוגים+קפיאון+RPCs, fail-closed) + פרופיל-עסק + הרשאות `invoices.*` (post-0012) + דגל `INVOICING_UI` (כבוי). אל-יעדים: אין הנה"ח-כפולה/מלאי (INI 1013=0). **בולע את DEV-012** (לוגו+ח.פ על ה-ledger). שערי-בעלים: פרטי-עסק, שער-ממשלתי, תעודת-CA, סימולטור, הגשה. ראה פירוט. |

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

**הושלם 2026-07-12** ([PR #68](https://github.com/Liran-Raz/AVI.APP1/pull/68)). DEV-009
חלק 2 נתן כיבוי **מייל** בלבד; DEV-014 מוסיף כיבוי גם של **התראת-הפעמון** לאירוע שיוך-משימה.

**הכרעות (עם Liran, 4 סבבים):** גישה **C** — ספציפית לשיוך בלבד (מקבילה לטוגל-המייל;
התראות `task_status_changed` השלמה/החזרה תמיד מבדגות); אכיפה **בשכבת-הקריאה** (בלי מיגרציה,
בלי נגיעה בטריגרים 0002/0021, הפיך, לא-הרסני); עוצמה **רכה (badge-only)** — כשמושתק ההתראה
עדיין נוצרת ומופיעה ברשימת-הפעמון, רק לא נספרת בעיגול-האדום (כמו קבוצת-וואטסאפ מושתקת). אין
אודיו במערכת — הפעמון ויזואלי בלבד.

**מימוש (ללא מיגרציה):** מפתח `bellOnTaskAssignment` חדש בעמודת `profiles.notification_prefs`
הקיימת (jsonb). הדיכוי = `notifications.service.mutedBellTypes()` שמעביר
`excludeTypes:["task_assigned"]` ל-`countUnreadByUserId` — **על ה-COUNT (הבּיידג') בלבד**;
הרשימה (`findManyByUserId`) לא נוגעת. משקף 1:1 את דפוס `emailOnTaskAssignment` בכל שכבה
(validator/service/repo/UI). `tsc`/`lint`/**397 בדיקות** (+13) ירוקים; GET smoke 401/307.

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

### DEV-019 — שלב 12 (דרישות מפגישת לקוח)

**רקע:** Liran קיים פגישה עם הלקוח (משרד רו"ח) וחזר עם מסמך דרישות — חידודי UI,
פיתוחים חדשים, ושינוי לוגיקת-עבודה מרכזית במשימות. סבב הפיתוח המוצרי הגדול הראשון
מאז ה-redesign; נוגע בליבת המערכת (משימות) שרצה בפרודקשן עם נתונים אמיתיים.

**מבנה הביצוע:** מיגרציה אחת (`0020`) + 4 סבבים; כל סבב ענף → PR → QA של Liran →
מיזוג באישורו. סדר: **Round A** (בלי DB) → **שער: החלת 0020 ואימותה** → **Round B**
→ **Round C** → **Round D**.

**הדרישות (R1–R7):**
- **R1** — סרגל עליון: 2 חיוויי חיבוריות (DB + אינטרנט) + שעון/תאריך.
- **R2** — "גורם מטפל" ללקוח (איש צוות), נבחר בחלון צור-לקוח (רשות + ניתן לעריכה).
- **R3** — מזהה ID ייחודי למשימה (מספרי, מוצג בכרטיס).
- **R4** — חותמת זמן יצירה למשימה (מוצגת בכרטיס).
- **R5** — שינוי label עדיפות "סופני" → "עתידי".
- **R6** — חלון יצירת משימה: הסרת שדה סטטוס · צ'קבוקס "האם להוסיף תאריך יעד?" ·
  בורר "איש צוות לביצוע" (חובה, ברירת מחדל = היוצר).
- **R7** — מחזור-חיים חדש: יוצר → תור "חדשות" של המבצע → "במעקב" → "הושלמו"
  (חוזרת ליוצר לווידוא → ארכיון). עובד רואה רק את לוחו; owner/admin מקבלים בורר תצוגה.

**החלטות מוצריות (Liran, 2026-07-11):** מזהה משימה פר-משרד (זהות מערכתית =
`org_code`+מספר, `UNIQUE(org_id, task_number)`; למשתמש מוצגות רק הספרות) · איש-צוות
לביצוע חובה, ברירת מחדל = היוצר · עובד רואה רק את לוחו, מנהל+בעלים בוחרים תצוגה ·
גורם מטפל רשות + ניתן לעריכה.

**מיגרציה `0020`** — 🟢 **הוחלה + אומתה בייצור 2026-07-11** (Liran, role postgres; postflight ירוק). חבילת-אופרטור בסגנון 0019:
`tasks.task_number` + backfill + `UNIQUE(org_id, task_number)` · טבלת `task_counters`
(RLS + אפס policies + REVOKE מפורש) + טריגר `assign_task_number` (SECURITY DEFINER,
בטוח בתחרותיות + חסין-זיוף) · `due_at DROP NOT NULL` · remaps (status `received`→`new`;
`assigned_to`=creator כשריק — בלי ספאם התראות) · `clients.handling_user_id`.

**Round A — סרגל עליון (ללא DB) — 🟢 חי בייצור** ([PR #54](https://github.com/Liran-Raz/AVI.APP1/pull/54), main `2572da7`):
- קבצים חדשים (6): `server/repositories/health.repository.ts` (`pingDb` — קריאת org
  זעירה **שזורקת** על שגיאה), `server/services/health.service.ts` (+`.test.ts` —
  503 על כשל/אין-שורה), `app/api/health/db/route.ts` (`withErrorHandler`+`requireSession`),
  `components/dashboard/topbar-clock.tsx` (שעון hydration-safe, he-IL, שעה תמיד/תאריך
  בדסקטופ), `components/dashboard/topbar-connectivity.tsx` (DB poll ~45s + focus/online;
  אינטרנט `navigator.onLine`; **401 = נייטרלי**).
- שונו (2): `app-shell.tsx` (החיוויים+שעון בקלאסטר העליון + `truncate` לשם המשרד בנייד),
  `lib/api-client.ts` (`health.db()`).
- אימות: `tsc`/`lint`/`build`/**324 בדיקות** ירוקים; GET לא-מאומת — `/api/health/db`→**401**,
  `/api/health`→200, `/login`→200, `/tasks`→307. QA ויזואלי אושר ע"י Liran (2026-07-11).

**Round B + C — QA אושר (Liran), במיזוג (PR אחד):** B — טופס: `dueAt` אופציונלי מאחורי
צ'קבוקס, הסרת שדה סטטוס, בורר "איש צוות לביצוע" (חובה, ברירת מחדל=היוצר), כרטיס
`#0001`+חותמת יצירה, "סופני"→"עתידי", DTO חושף `taskNumber`+`creatorId`, `due_at` nullable.
C — לוח אישי 3-טורים (חדשות=assigned+new / במעקב=assigned+in_progress / הושלמו=creator+done)
דרך `boardFor` `.or()` ב-repo; עובד רואה רק את שלו, owner/admin מקבל בורר "הלוח של: X"
(שער `activeRole`); "החזר לביצוע" בטור הושלמו; `received` יצא מזרימת הקידום (נשאר ב-DB
לרינדור הגנתי).

**Round D — גורם מטפל ללקוח (R2) — QA אושר (Liran), במיזוג:** בורר "גורם מטפל" בחלון
צור/ערוך לקוח (רשות + ניתן לניקוי, active-members roster), עמודה בטבלת הלקוחות + שורה
בכרטיס-נייד + תא בעמוד פרטי-הלקוח, **guard בסגנון F1** (השרת מאמת חבר פעיל בארגון; ניקוי
תמיד מותר). `clients.handling_user_id` כבר בסכמה (מיגרציה 0020).

**דגלי scope שאושרו:** יוצר לא רואה משימה יוצאת עד השלמה · לוח-שנה + ארכיון/פח נשארים
כלל-משרדיים · משימות בלי תאריך לא מופיעות בלוח-שנה · "החזר לביצוע" בטור הושלמו ·
ארכוב מותר-לכולם בשרת.

**סטטוס:** 🟢 **הושלם.** כל 4 הסבבים (A/B/C/D) + מיגרציה 0020 חיים בייצור, וגם כפתור
"החזר לחדשות" למשימה ב"במעקב". **שלב 12 (R1–R7 + תוספת ה-QA) סגור לגמרי.**

---

### DEV-020 — שלב 13 (חידודים ופיתוחים מפגישת לקוח)

**רקע:** פגישת לקוח נוספת (משרד רו"ח). 5 דרישות: 2 חידודי-UX במסך לקוחות, שדרוג התראות,
דשבורד ניהולי לבעלים, ועמוד צ'אט קבוצתי. יושב מעל שלב 12 (main `686901b`, מיגרציות עד 0020).
מקור: תוכנית מאושרת `C:\Users\User\.claude\plans\bubbly-whistling-squirrel.md`.

**הכרעות (נעולות):** 3 סבבים (R1+R2+R3 → R4 → R5) · צ'אט ב-**Polling** (לא Realtime) ·
גרפי דשבורד ב-**SVG ידני** (בלי ספריית charts) · התראה על **כל מעבר-מידע בין יוזרים**.

**Round 1 — נבנה + QA אושר (Liran), במיזוג:**
- **R1** — לחיצה על כל שורת/כרטיס לקוח פותחת את עמוד הלקוח (`clients-page.tsx`: `router.push`
  + `stopPropagation` על תפריט-הפעולות/קישורי tel-mail; ה-`<Link>` על השם נשאר לנגישות).
- **R2** — כפתור "ערוך" בעמוד הלקוח (`client-detail.tsx` מרכיב את `ClientFormDialog` הקיים;
  הראוט כבר טוען `members`; `onSaved`→`router.refresh()`).
- **R3** — מיגרציה `0021` (**הוחלה + אומתה בפרודקשן**): טריגר `notify_on_task_status_change`
  (SECURITY DEFINER, `search_path=""`) — השלמה→פעמון ליוצר, החזרה-ל"חדשות"→פעמון למבצע,
  מדלג על הפועל (`auth.uid()`). מנצל את ערך ה-enum הקיים `task_status_changed` (בלי `ALTER
  TYPE`). הפעמון כבר עושה deep-link ל-`/tasks` → אפס שינוי קליינט. אומת: שני הטריגרים
  secdef=t (נפתרה אי-עקביות ב-`notify_on_task_assignment`). QA התראות בין-יוזרים = בפרודקשן.
- אימות: `tsc`/`lint`/`build`/347 בדיקות ירוקים.

**Round 2 (R4) — 🟢 חי בייצור (PR #61, main `ff4285e`, `0022` הוחלה+אומתה, Vercel success):**
- **דשבורד ניהולי** — אגרגציות "חינם" מ-`tasks` (GROUP BY, **בלי מיגרציה לדשבורד עצמו**):
  כרטיסי KPI (פעילות/פתוחות/הושלמו/באיחור) · עוגת SVG לפי סטטוס · עמודות לפי עדיפות + עומס
  לפי איש-צוות · קו נוצרו-מול-הושלמו 8 שבועות · טופ-לקוחות. שכבות רגילות
  (`dashboard.repository`→`dashboard.service`→`GET /api/dashboard/stats`→`apiClient.dashboard.stats`→
  `(dashboard)/dashboard/page.tsx`→`components/dashboard-analytics/*`). גרפים = SVG/CSS ידני, בלי ספריית charts.
- **גישה פר-משתמש** (תוספת של Liran) — הגישה = **בעלים או חבר שהבעלים פתח לו**. מיגרציה
  **`0022`** מוסיפה `organization_memberships.dashboard_access boolean` (אדיטיבית, ברירת מחדל false).
  שער `canViewDashboard` ב-`dashboard.service` (owner || dashboard_access), נאכף בשירות + ב-`GET /api/dashboard/stats`.
  בעמוד "צוות": כפתור owner-בלבד **"פתח/חסום גישה לדשבורד"** בתפריט הפעולות (`POST /api/team/members/[id]/dashboard-access`,
  `team.service.setDashboardAccess`) + תג "דשבורד" על שורת חבר מורשה. משתמש בלי גישה שנכנס ל-`/dashboard`
  → מסך "אין הרשאה" ידידותי (לא 404).
- **תבנית מייל-הזמנה חדשה** (תוספת של Liran) — `emails.service.sendInvitationEmail` עודכן ל-HTML
  דו-לשוני חדש (EN + HE, כרטיס רספונסיבי). אותם משתנים (`inviterName`/`orgName`/`roleHe`/`expiry`/`inviteUrl`), טקסט+נושא ללא שינוי.
- אימות: `tsc`/`lint`/`build`/**368 בדיקות** ירוקים; smoke לא-מאומת `/api/dashboard/stats`→401,
  `POST …/dashboard-access`→401, `/dashboard`→307. QA בין-יוזרים (גישה) = בפרודקשן.

**Round 3 (R5) — 🟢 חי בייצור (PR #62, main `8a99918`, `0023` הוחלה+אומתה, Vercel success):** צ'אט "הודעות".
- **טבלת `messages`** חדשה (מיגרציה **`0023`**, **הוחלה+אומתה בפרודקשן**: rls=t, 2 policies,
  authenticated INSERT+SELECT, אין UPDATE/DELETE, anon כלום): `recipient_id NULL` = פיד-משרד,
  לא-null = DM. RLS עם `public.user_is_active_member_of(org_id)` (הרב-משרדי, לא ה-deprecated),
  SELECT+INSERT בלבד (immutable).
- שכבות: `messages.schema` · `messages.repository` (create/findGroup/findThread) · `messages.service`
  (מזריק org+sender, מאמת נמען-DM חבר-פעיל בשליחה) · `GET/POST /api/messages` · `apiClient.messages` ·
  UI `(dashboard)/messages` (רשימת שיחות + thread + polling 3ש') · פריט ניווט "הודעות" לכל החברים.
- **סרגל ניווט תחתון בנייד נגלל אופקית** (בקשת Liran) — `flex overflow-x-auto` במקום grid, פריטים
  בגודל-טאב קבוע (`basis-1/5 min-w`), ~5 נראים והשאר בגלילה ימין→שמאל (פותר צפיפות עם 6-7 פריטים).
  utility `.no-scrollbar` ב-globals.
- **סקירת-אבטחה אדוורסרית לפני מיזוג** (5 צירים · אימות-הפרכה): **0 ממצאי-אבטחה** (RLS/בידוד/הזרקה
  עמדו). **6 באגי-נכונות תוקנו:** (1) `after: z.string().datetime()` דחה timestamptz עם offset `+00:00`
  → כל poll 400 → live-delivery מת; תוקן ל-`{offset:true}`. (2) מרוץ החלפת-שיחה → תגובת-poll ישנה
  נכתבת לשיחה החדשה; תוקן ב-effect אחד עם `cancelled`. (3) send קידם את הסמן מעבר להודעות שטרם נמשכו;
  הוסר קידום-הסמן. (4) `gt`→`gte` (הודעות באותו created_at לא נשמטות; dedup ב-id). (5) list-DM חסם
  היסטוריה מול חבר שהושבת; רך יותר (בדיקת חברות בלבד, לא is_active). +8 בדיקות validator/service.
- אימות: `tsc`/`lint`/`build`/**384 בדיקות** ירוקים; smoke לא-מאומת `/messages`→307, `/api/messages`→401.
  QA בין-2-יוזרים = בפרודקשן אחרי דפלוי (סביבה מקומית = יוזר יחיד).

---

### DEV-022 — ריאל-טיים (מוצר עתידי; Firebase נדחה, Supabase Realtime שמור)

**רקע:** Liran שאל אם לחבר את AVIAPP ל-Google Firebase לנתוני ריאל-טיים (עדכוני משימות חיים +
צ'אט), בהשראת דיון בפרויקט אחר שלו (BUS CONTROL). הרצנו **מועצת-LLM** (5 יועצים + ביקורת-עמיתים).

**מצב נוכחי (מאומת):** כל ה"ריאל-טיים" ב-AVIAPP היום = **polling** (צ'אט/פעמון/גרסת-לוח כל 3ש',
עם עצירה בטאב מוסתר). אין websocket, אין קליינט-DB בדפדפן (Supabase = server-only). **Supabase
Realtime כבר מפורסם** (מיגרציה `0004`: tasks/notifications/clients/profiles) אבל **רדום לגמרי**
(0 מנויים) — אותו Postgres, אותו RLS. אין SDK של Firebase מותקן.

**פסיקת המועצה (פה-אחד): לא להוסיף Firebase.**
- **סיבה מכרעת:** Firebase = backend שני + **2 מודלי-אבטחה** (RLS של Postgres + חוקי-אבטחה של
  Firebase שנכתבים ביד) מעל נתונים פיננסיים → חוסר-סנכרון אחד = דליפת נתונים בין-דיירים. גם:
  dual-write, ספק+תמחור נוספים (per-read מפתיע תחת עומס צ'אט), SDK בדפדפן.
- **ביקורת-העמיתים תפסה עיוורון-קבוצתי:** (א) "רק להדליק Supabase Realtime" אינו חינם — מצריך
  קליינט-Supabase-**ראשון-בדפדפן** שחוצה את הכלל "אין Supabase בקליינט", ומגביר צימוד ל-Supabase
  שמעבר-Auth-ל-Firebase-העתידי יצטרך להתיר; (ב) ריאל-טיים הוא **תוספת ל-polling, לא החלפה**
  (websockets נופלים → צריך backfill); (ג) *למה ריאל-טיים עכשיו?* — אף יוזר לא התלונן, 3ש'
  בלתי-מורגש, ויש בקלוג בעל-ערך גבוה יותר.

**החלטה (Liran):** לדחות ולרשום כמוצר עתידי. **המסלול כשנחליט לממש = Supabase Realtime בלבד**
(צ'אט קודם, פיילוט ממוקד; ראה תוכנית `d-bus-control-enumerated-quilt.md`). **Firebase יחזור
לשולחן רק אם** ייכנס מובייל native עם offline-first (עבודת-שטח, קליטה גרועה). **טריגר להפעלה:**
צ'אט בשימוש כבד / לקוח מבקש "מיידי" / סקייל של הרבה משרדים.

---

### DEV-023 — התראות דחיפה בנייד (Web Push / PWA)

**נרשם 2026-07-12 לבקשת Liran** (שאל אם אפשר לקבל התראות "כמו הודעת וואטסאפ" ל-PWA). זהו
**פיצ'ר רב-סבב, לא קונפיג** — גדול מ-DEV-014.

**מה כבר קיים:** `web/src/app/manifest.ts` (PWA תקין — `display:standalone`, RTL, אייקונים
`icon.svg`/`icon-maskable.svg`) → "הוסף למסך הבית" כבר עובד. **אין service-worker** (המניפסט
כותב זאת במפורש: "No service worker for MVP").

**מה נדרש:**
1. **service-worker** (`public/sw.js` או Serwist) — מקבל אירוע `push` → `showNotification()` +
   טיפול בקליק (deep-link ל-`/tasks`).
2. **מפתחות VAPID** — keypair; הציבורי בקליינט, הפרטי כ-env בשרת (כמו `RESEND_API_KEY`).
3. **מנוי (client)** — `Notification.requestPermission()` מאחורי מחווה (כפתור "הפעל התראות") →
   `PushManager.subscribe({ applicationServerKey })` → שליחת המנוי לשרת.
4. **טבלת `push_subscriptions`** — user_id + endpoint + keys (מנוי לכל מכשיר) → **דורש מיגרציה**
   (operator-assisted, org-scoped + RLS כמו שאר הטבלאות).
5. **שליחה מהשרת** — `web-push` (VAPID) fire-and-forget **בקוד-האפליקציה** בנקודות השיוך/מעבר
   (`tasks.service`, ליד `sendAssignmentEmailIfNeeded`) — **לא** בטריגר, כי טריגר ב-DB לא יכול
   לקרוא לשירות-דחיפה חיצוני. מכבד `notification_prefs` כמו המייל/פעמון (DEV-014).
6. **הרשאה + toggle** ב-הגדרות → התראות.

**מלכוד iOS (מכריע לכדאיות):** Web Push ב-iOS עובד **רק** ב-PWA שהותקן למסך-הבית, וב-**iOS 16.4+**
(03/2023) — **לא** בטאב Safari רגיל. אנדרואיד: עובד גם מהדפדפן, בלי התקנה חובה. ההצלחה באייפון
תלויה בכך שהצוות יתקין את ה-PWA.

**יתרונות:** בלי צד-שלישי ובלי עלות (VAPID + `web-push` חינמיים, דרך שירותי-הדחיפה של גוגל/אפל);
תוכן ההתראה **מוצפן end-to-end** (הספק לא רואה אותו — טוב לנתונים פיננסיים); ממלא את הפער בין
הפעמון-בתוך-האפליקציה (polling) למייל — נדנוד בטלפון כשה-PWA סגור.

**מגבלות:** אמינות/תזמון לא-מובטחים כמו native (iOS עלול לווסת) — מתאים ל"משימה חדשה", לא
להתראות קריטיות-בזמן. **QA כבד על מכשירים אמיתיים** (אייפון+אנדרואיד: התקנה→אישור→שיוך-בדיקה) =
של Liran; Claude מאמת headless (build/מנוי/שליחה). **טריגר להעלאת-עדיפות:** בקשת-לקוח / שימוש-כבד.

---

### DEV-024 — שלב 14: שדרוג צ'אט "הודעות" לסגנון וואטסאפ

**רקע:** Liran ביקש להפוך את חלונית-ההודעות לצ'אט אמיתי: (1) קבוצות מותאמות עם ניהול מלא,
(2) אישורי שליחה+קריאה (✓/✓✓) ב-DM ובקבוצה ("נקרא ע"י כולם"), (3) עריכה+מחיקה עד 10 דק'.

**שורש אחד:** לא היה מודל-שיחות — הצ'אט זוהה ע"י `messages.recipient_id` (NULL=משרד, uuid=DM),
אין טבלת-שיחות/משתתפים/קריאה, immutable. לכן תשתית-שיחות אחת נקייה. נשאר על **polling** (realtime=DEV-022).

**תוכנית: 4 סבבים על מיגרציה אחת (`0024`, מוסיפה את כל הסכימה ל-3 הפיצ'רים):**
- **R1 — תשתית + backfill + cutover משמר-התנהגות (הושלם, חי בייצור).** `conversations`(office|dm|group) +
  `conversation_participants`(last_read_at, is_admin) + `messages.conversation_id/edited_at/deleted_at`.
  השירות פותר `conversation_id` מתחת למכסה; חוזה-הלקוח לא השתנה. **מודל אבטחה fail-closed RPC-only**:
  ל-`authenticated` יש SELECT-בלבד על 2 הטבלאות, כל כתיבה דרך פונקציות SECURITY DEFINER מאומתות
  (`ensure_office`/`ensure_dm`/`create_group`); composite-FK שנועל org_id (כמו 0011); טריגר-תאימות
  ל-cutover אפס-חלון; backfill אידמפוטני (מסמן היסטוריה כנקראה, assert 100% לפני NOT NULL).
  **סקירה אדוורסרית תפסה קריטי self-join + 2 גבוהים בטיוטה הראשונה — נסגרו לפני החלה** (מעבר ל-fail-closed).
- **R2 — ניהול-קבוצות מלא (✅ חי בייצור, PR #74).** יצירה/שם/הוספה/הסרה/עזיבה/מחיקה + בורר-חברים
  multi-select; מקטע "קבוצות" ברשימה; פאנל-ניהול (bottom-sheet בנייד/כרטיס בדסקטופ); מיעון קבוצה `conv:<id>`.
  **מודל admin-only** (בחירת Liran): רק מנהל-הקבוצה מנהל, כל חבר עוזב, מנהל-יחיד + ירושה-אוטומטית. מיגרציה
  **`0025`** = 5 RPCs definer (rename/add/remove/leave/delete) + guard פנימי, additive-בלבד (fail-closed
  נשמר). סקירה אדוורסרית: 0 CRITICAL/HIGH, 7 ממצאי LOW/MEDIUM תוקנו לפני מסירה.
- **R3 — אישורי-קריאה + badge (✅ חי בייצור, PR #76).** טיקים ✓/✓✓ (`readThrough` = כולם-קראו) +
  פאנל "נקרא ע"י" בלחיצה + badge לא-נקרא (שורות-שיחה + ניווט "הודעות"). RPCs `mark_conversation_read` +
  `get_unread_counts` (fail-closed; office-unread לפי חברוּת כך שגם עובד-חדש מקבל badge). ה-poll עבר
  ל-recent-window + reconcile-by-id כדי לשקף עריכות/מחיקות של משתמשים אחרים.
- **R4 — עריכה+מחיקה עד 10 דק' (✅ חי בייצור, PR #76).** תפריט ערוך/מחק **מאוחד בפאנל** (לחיצה, בלי ריחוף) · "נערך" ·
  tombstone "הודעה נמחקה" (גוף מנוקה — סמן `[deleted]`, כי `messages.body` דורש `length>0`; ה-DTO מסתיר).
  `0026` היקשה את policy-העריכה (re-check `user_can_read_conversation` — סגר את חור החבר-שהוסר-עדיין-עורך מסקירת R2).

**סטטוס:** ✅ **שלב 14 (DEV-024) הושלם — R1→R4 חיים בייצור.** R1 (PR #71) · R2 (PR #74) · **R3+R4 (PR #76, main
`9b0b041`, `0026` הוחלה+אומתה)**. סקירה אדוורסרית R3+R4: 0 CRITICAL/HIGH; תפסה **HIGH-נכונות** (עריכות/מחיקות של
אחרים לא הגיעו לשיחה פתוחה — תוקן ב-recent-window+reconcile) + MEDIUM (badge-משרד לחבר-חדש — תוקן במיגרציה); באג-QA
של מחיקה (CHECK על גוף לא-ריק) תוקן. **הערה: PR #76 בלע גם את עבודת DEV-025 M1 (תקלת-סשנים-מקבילים) — ראה DEV-025
+ רשומת-התקלה ב-changelog.** QA משמר-התנהגות + רב-משתמשי = Liran בפרודקשן.

### DEV-025 — אפליקציית מובייל בחנות (עטיפת-Capacitor, לא Flutter מלא)

**נרשם 2026-07-13** בעקבות התייעצות (ללא קוד) של Liran: איך לתת לעובדים אפליקציה מהחנות.

**המלצה: עטיפת-Capacitor על אפליקציית-הווב הקיימת — לא Flutter/נייטיב-מלא.** Capacitor עוטף
את הווב ב-WebView נייטיבי ומייצר `.ipa`/`.aab` לחנויות; המעטפת דקה, הפיצ'רים נשארים ווב.

**למה עטיפה מנצחת Flutter (ליעד "אפליקציה בחנות לעובדים"):**
- **codebase אחד** — Flutter = מוצר-שני, כל פיצ'ר (R2/R3/R4, 2FA...) נבנה פעמיים לנצח.
- **אפס שכתוב-אבטחה** — ה-WebView מריץ את הווב האמיתי, אז ה-session/`/api`/`requireSession` +
  ה-authz-בשירות + מודל ה-RPC-only של הצ'אט עובדים כמו-שהם. Flutter היה מחייב token-auth או
  חיבור-ישיר-ל-Supabase (שובר את מודל-האבטחה).
- **deploy מיידי נשמר** — hosted/OTA: `git push` → Vercel → **אתר *וגם* אפליקציה מתעדכנים מיד,
  בלי ביקורת-חנות**. רק שינוי במעטפת-הנייטיב (plugin/וידג'ט/אייקון) = release + ביקורת (נדיר).
  ב-Flutter *כל* עדכון עובר ביקורת-חנות — הקצב מת.
- **לעובד אין הבדל נראה-לעין** — אפליקציה בחנות, אייקון, מסך-מלא, push. העטיפה בלתי-נראית.

**ספקטרום:** אתר/PWA (0% נייטיב) → **עטיפה (רובו-ווב + קצת-נייטיב)** → Flutter ("כמו-נייטיב",
codebase-שני) → נייטיב-אמיתי (Swift+Kotlin, שני codebases). ריפו **אחד** + `isNative` להתניית
פיצ'רי-אפליקציה (לא ריפו-נפרד — זה מחזיר את מס-הכפילות).

**יכולות-נייטיב שנכנסות לעטיפה דרך plugins/תוספים (בלי Flutter):**
- **push נייטיבי** (APNs/FCM) — אמין, פותר את מלכוד-iOS של Web Push (DEV-023).
- **וידג'טים למסך-בית + iOS Live-Activities** (כרטיס-חי במסך-נעילה/Dynamic Island כמו וולט —
  למשל טיימר-משימה/שעות-חיוב חי). נכתבים ב-Swift (WidgetKit/ActivityKit) — נייטיב **בכל מקרה,
  גם ב-Flutter**; מוסיפים כתוסף למעטפת, בלי לשכתב את האפליקציה.
- **גישת-מכשיר:** GPS/geofencing → **שעון-נוכחות מבוסס-מיקום** (קדמי עובד גם ב-PWA; רקע/geofence
  דורש את האפליקציה) · מצלמה · Face ID. הנתונים זורמים ב-`/api` הקיים (endpoint+טבלה חדשים).

**עלות/מאמץ:** אנדרואיד קל (ימים) · אייפון בינוני (~שבועיים כולל ביקורת) · אפל $99/שנה + גוגל $25 ·
~2-3 שבועות לשיגור ראשון (רובו קונפיג/תהליך) · תחזוקה מינימלית (codebase אחד).

**קאווטים:** סיכון-ביקורת-אפל 4.2 "minimum functionality" (ממותן ע"י push/פיצ'רים נייטיביים) ·
Google OAuth ב-WebView (לנתב לדפדפן-מערכת) · **פרטיות מיקום-עובדים** (חוק-הגנת-הפרטיות + ניטור-עובדים:
הסכמה, מטרה, מידתיות) · מיקום-רקע (סוללה+הרשאת-"always"+ביקורת) · דיוק-GPS בתוך מבנה.

**מתי Flutter/נייטיב-מלא כן מוצדק (חזרה לשולחן):** האפליקציה הופכת ל**מוצר-ראשי** / חוויה
נייטיבית-כבדה / **ערוץ-הפצה חיצוני** (SaaS רב-משרדי, גילוי-בחנות כשיווק).

**סטטוס:** ⚠️ **M1 (foundation) שוגר בטעות לפרודקשן בתוך PR #76** (תקלת-סשנים-מקבילים — HEAD משותף בין 2 סשנים; ראה
רשומת-התקלה 2026-07-14). אינרטי בווב לפי-תכנון; המועצה המליצה **להשאיר** (revert של 146 קבצים = הפעולה המסוכנת ביותר,
מוחקת את R3/R4 החי). **ההמשך (native push · widgets · Live-Activities · שעון-נוכחות · העלאה לחנויות) נדחה** — טראק נפרד.
פעולות-בעלים פתוחות: אימות-OAuth חי בפרודקשן, ותיאום בידוד-סשנים (git-owner יחיד / worktree נפרד) לפני עבודה מקבילה.

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
- **2026-07-11** — **DEV-019 נפתח — שלב 12 (דרישות מפגישת לקוח).** סבב-על: מיגרציה
  `0020` + 4 סבבים (A→D). **Round A** (סרגל עליון — 2 חיוויי חיבוריות + שעון) נבנה:
  6 קבצים חדשים + 2 שונו. שרשרת חדשה `health.repository`(pingDb זורק)→`health.service`
  (503)→`/api/health/db`(`requireSession`); `topbar-connectivity` (DB poll ~45s +
  focus/online, אינטרנט `navigator.onLine`, 401=נייטרלי); `topbar-clock` (hydration-safe).
  `tsc`/`lint`/`build`/324 בדיקות ירוקים; GET לא-מאומת `/api/health/db`→401. QA ויזואלי
  אושר ע"י Liran. ענף `feat/stage12-topbar-status`, **ב-PR** (ממתין למיזוג). המשך:
  החלת 0020 → Round B → C → D.
- **2026-07-11** — **DEV-019: Round A חי בייצור** ([PR #54](https://github.com/Liran-Raz/AVI.APP1/pull/54),
  main `2572da7`, Vercel success). סרגל עליון: 2 חיוויי חיבוריות + שעון. GET smoke ירוק
  (`/api/health/db`=401, `/api/health`=200, tasks/clients/team=307).
- **2026-07-11** — **DEV-019: מיגרציה 0020 הוחלה + אומתה בייצור** (Liran, role postgres;
  postflight ירוק — task_number int/NOT NULL/unique, task_counters fail-closed (RLS+0
  policies+0 client grants), טריגר SECURITY DEFINER `search_path=""`, `due_at` nullable,
  remaps `received`→`new` + assigned→creator, `clients.handling_user_id`). קובץ ה-SQL
  נכנס לריפו יחד עם PR של Round B+C.
- **2026-07-11** — **DEV-019: Round B+C נבנו + QA אושר (Liran).** B: טופס (dueAt אופציונלי,
  הסרת סטטוס, מבצע חובה=ברירת מחדל היוצר), כרטיס `#0001`+חותמת, "סופני"→"עתידי". C: לוח
  אישי 3-טורים (`boardFor` `.or()`: assignee-new/in_progress + creator-done), עובד רואה רק
  את שלו, owner/admin בורר "הלוח של: X" (שער `activeRole`), "החזר לביצוע", `received` יצא
  מהזרימה. QA כלל את הזרימה המלאה (יוצר→מבצע→הושלם→חזרה-ליוצר) + מספר מרווח.
  `tsc`/`lint`/`build`/343 בדיקות ירוקים. ענף `feat/stage12-task-form-board`, במיזוג ב-PR אחד.
- **2026-07-11** — **DEV-019: Round B+C מוזגו — חיים בייצור** ([PR #55](https://github.com/Liran-Raz/AVI.APP1/pull/55),
  main `46e1ba8`, Vercel success; validate-migrations + כל ה-CI ירוקים). קובץ מיגרציה 0020
  נכנס לריפו. GET smoke ירוק (`/api/tasks?boardFor=…`=401, tasks/calendar/clients=307).
- **2026-07-11** — **DEV-019: Round D נבנה + QA אושר (Liran).** גורם מטפל ללקוח (R2): בורר
  בחלון צור/ערוך (רשות + ניקוי), עמודה בטבלה + שורה בכרטיס-נייד + תא בפרטי-לקוח, guard F1
  (חבר פעיל בארגון). `tsc`/`lint`/`build`/347 בדיקות ירוקים. ענף `feat/stage12-client-handler`,
  במיזוג. **סוגר את שלב 12 (R1–R7).** בקשת המשך מ-Liran ב-QA: כפתור "החזר לחדשות" ממשימה ב'במעקב'.
- **2026-07-11** — **DEV-019: Round D מוזג — חי בייצור** ([PR #56](https://github.com/Liran-Raz/AVI.APP1/pull/56),
  main `bdee576`, Vercel success; deploy + prod smoke ירוקים). גורם מטפל ללקוח חי. **שלב 12
  (R1–R7) הושלם.**
- **2026-07-11** — **DEV-019 סגור: תוספת QA — כפתור "החזר לחדשות"** למשימה ב"במעקב"
  (`task-card` מוסיף פריט תפריט ל-`in_progress` שקורא ל-`handleReturnToWork` → status `new`;
  toast עודכן ל"הוחזרה לחדשות"). 2 קבצים, ללא שרת/DB. `tsc`/`lint`/`build`/347 בדיקות ירוקים,
  QA אושר. **כל שלב 12 חי בייצור — DEV-019 הושלם.**
- **2026-07-11** — **DEV-020 נפתח — שלב 13.** 5 דרישות מפגישת לקוח, 3 סבבים (החלטות: polling
  לצ'אט, SVG לגרפים, התראה על כל מעבר-מידע בין יוזרים). תוכנית מאושרת.
- **2026-07-11** — **DEV-020 Round 1 נבנה + QA אושר (Liran).** R1 (לחיצת-שורת-לקוח) + R2
  (עריכה בעמוד-לקוח) + R3 (מיגרציה `0021` — טריגר התראות מעבר-מידע, **הוחלה+אומתה בפרודקשן**;
  שני הטריגרים secdef=t). `tsc`/`lint`/`build`/347 בדיקות ירוקים. ענף
  `feat/stage13-clients-ux-notifications`, במיזוג (Liran אישר "למזג לייצור"; QA התראות
  בין-יוזרים ייעשה בפרודקשן — דורש 2 יוזרים).
- **2026-07-11** — **DEV-020 R6: עדכון-לוח חי + פעמון מהיר.** לאחר QA של Round 1, Liran
  דיווח שעדכונים בין-יוזרים לא מגיעים בלי רענון ידני. פתרון: polling כל **3ש'** בשיטת
  חתימה-זעירה — `GET /api/tasks/version` מחזיר `count:maxUpdatedAt` (org-scoped, בלי שורות),
  והלוח מושך רשימה מלאה **רק כשהחתימה השתנתה** + עצירה כשהטאב מוסתר (רענון מיידי בחזרה).
  hook חדש `useLiveTaskRefresh` מחווט ל-`tasks-page` + `calendar-page`; הפעמון הואץ מ-60ש'
  ל-3ש' באותה שיטה. בחירה מודעת: **polling, לא Realtime** (20 יוזרים ≈ עומס זניח; Realtime
  = מעבר Firebase עתידי, שם ה-realtime מובנה). `tsc`/`lint`/`build`/348 בדיקות ירוקים.
  ענף `feat/stage13-live-board-refresh`.
- **2026-07-11** — **DEV-020 Round 2 (R4) נבנה + 2 תוספות של Liran.** דשבורד ניהולי (KPI +
  גרפי SVG/CSS ידניים, אגרגציות מ-`tasks` בלי מיגרציה) — שכבות רגילות repo→service→route→
  apiClient→page→charts→nav. **תוספת א' (גישה פר-משתמש):** הבעלים פותח/חוסם גישה לדשבורד
  לכל חבר מעמוד "צוות" → מיגרציה **`0022`** (`organization_memberships.dashboard_access
  boolean`, אדיטיבית, ברירת מחדל false); שער `canViewDashboard` (owner || flag) בשירות +
  ראוט; משתמש בלי הרשאה → מסך "אין הרשאה" (לא 404). **תוספת ב' (מייל הזמנה):** `sendInvitationEmail`
  עודכן ל-HTML דו-לשוני חדש (EN+HE). `tsc`/`lint`/`build`/**368 בדיקות** ירוקים; smoke לא-מאומת
  `/api/dashboard/stats`→401, `POST …/dashboard-access`→401, `/dashboard`→307. ענף
  `feat/stage13-dashboard`. Liran אישר מיזוג; ממתין להחלת `0022` בפרודקשן לפני מיזוג (הקוד
  קורא את העמודה — מיזוג לפני החלה ישבור את עמוד "צוות"). R5 (צ'אט) יעבור למיגרציה `0023`.
- **2026-07-12** — **DEV-020 Round 2 (R4) חי בייצור** (PR #61 squash, main `ff4285e`, Vercel
  success, prod smoke ירוק). `0022` הוחלה+אומתה ע"י Liran. QA ויזואלי אושר.
- **2026-07-12** — **DEV-020 Round 3 (R5) — צ'אט "הודעות" נבנה + נסקר + `0023` הוחלה.** טבלת
  `messages` (קבוצה+DM, RLS רב-משרדי, immutable) + כל השכבות + UI polling 3ש' + סרגל-ניווט
  תחתון נגלל בנייד (בקשת Liran). `0023` הוחלה+אומתה בפרודקשן (rls=t, 2 policies, INSERT+SELECT).
  **סקירת-אבטחה אדוורסרית מרובת-סוכנים לפני מיזוג (5 צירים, אימות-הפרכה): 0 ממצאי-אבטחה** (RLS/
  בידוד-דיירים/הזרקה עמדו) **+ 6 באגי-נכונות שהמוקים פספסו — כולם תוקנו:** offset-timestamp שהרג
  live-delivery (`{offset:true}`), מרוץ החלפת-שיחה (`cancelled` ב-effect אחד), קידום-סמן ב-send,
  `gt`→`gte`, ורוך ב-list-DM מול חבר מושבת. +8 בדיקות. `tsc`/`lint`/`build`/**384 בדיקות** ירוקים.
  ענף `feat/stage13-chat`. Liran אישר מיזוג מותנה ב"אין חריגת-אבטחה" (התקיים).
- **2026-07-12** — **תיקון-חירום נייד (רגרסיה מ-PR #62):** סרגל-הניווט הנגלל גרם לכל העמוד
  להיגרר הצידה בנייד — עמודת ה-Main היא flex-item עם `min-width:auto`, ולכן רוחב ה-min-content
  של הסרגל (6-7 טאבים ברוחב קבוע) הרחיב את כל העמודה מעבר ל-viewport. תוקן: `min-w-0` על
  העמודה (הסרגל גולל פנימית כמתוכנן) + הוגדל גופן תוויות-הסרגל 10px→12px (בקשת Liran).
  **הוכח דטרמיניסטית** בהרפרודוקציה סטטית בדפדפן: שבור = scrollWidth 616 על viewport 390
  (גרירת-דף); מתוקן = 390 בדיוק + הסרגל גולל פנימית. לקח: שינויי-layout ב-AppShell לא נתפסים
  ב-tsc/build — לאמת במדידת-DOM לפני מיזוג.
- **2026-07-12** — **DEV-021 נפתח + הושלם באותו לילה: תפריט-צד נפתח בנייד.** Liran ביקש מגירה
  בגלל ריבוי עמודים. 3 הכרעות ננעלו (סרגל מצומצם + "תפריט" · דסקטופ ללא שינוי · מגירה עם אזור-
  חשבון מלא), עוצב **מוקאפ סטטי אינטראקטיבי** ב-2 גרסאות-עיצוב ואושר (נבחרה נייבי-זכוכית),
  ואז מומש ב-`app-shell.tsx` בלבד. ב-QA קוצר הסרגל ל-**תור משימות·לקוחות·הודעות+"תפריט"**
  (לוח שבועי במגירה). מוזג ([PR #65](https://github.com/Liran-Raz/AVI.APP1/pull/65), main
  `aae0a05`), Vercel success, smoke ירוק. הערת-סביבה: `next build` מקומי קרס שוב-ושוב **גם על
  main נקי** (ניסוי-בקרה; 0xC0000409 בשלב static-gen) — סביבתי, לא קוד; Vercel CI (לינוקס)
  שימש כשער ה-build המחייב. מומלץ ריסטארט למכונה.
- **2026-07-12** — **DEV-022 נפתח (מוצר עתידי): ריאל-טיים.** Liran שקל לחבר את AVIAPP ל-Firebase
  לריאל-טיים (עדכוני משימות + צ'אט). הרצנו **מועצת-LLM** (5 יועצים + ביקורת-עמיתים). פסיקה פה-אחד:
  **לא Firebase** (2 מודלי-אבטחה מעל נתונים פיננסיים = סיכון דליפה בין-דיירים; backend שני). המסלול
  השמור = **Supabase Realtime** (כבר מפורסם ורדום, אותו RLS). ביקורת-העמיתים חידדה: הפעלתו אינה
  "חינם" (קליינט-Supabase-ראשון-בדפדפן, חוצה כלל ארכיטקטוני; additive ל-polling), וגם — אף יוזר לא
  התלונן, אז אין דחיפות. Liran בחר **לדחות ולתעד כמוצר עתידי** (טריגר: שימוש-כבד/בקשת-לקוח/סקייל).
  מזכר מלא: plan `d-bus-control-enumerated-quilt.md`. שינוי docs-only, ללא קוד/מיגרציה.
- **2026-07-12** — **DEV-014 הושלם — השתקת התראת-הפעמון בשיוך (soft mute).** משלים את
  DEV-009 חלק 2 (מייל→גם פעמון). טוגל "פעמון בשיוך משימה" ליד טוגל-המייל; **השתקה רכה**:
  ההתראה עדיין ברשימת-הפעמון, רק לא נספרת בעיגול-האדום. **ללא מיגרציה** — מפתח
  `bellOnTaskAssignment` בעמודת `notification_prefs` הקיימת; סינון בשכבת-הקריאה על ה-COUNT
  בלבד (`mutedBellTypes`→`countUnreadByUserId excludeTypes`), הטריגרים לא נגעו → לא-הרסני.
  4 סבבי-הכרעה עם Liran (היקף שיוך-בלבד · אכיפה-בקריאה · עוצמה רכה). `tsc`/`lint`/**397
  בדיקות** (+13) ירוקים; GET smoke 401/307. ([PR #68](https://github.com/Liran-Raz/AVI.APP1/pull/68),
  ענף `feat/dev-014-mute-bell-on-assignment`). Liran אישר מיזוג לייצור.
- **2026-07-12** — **DEV-023 נפתח + נרשם לבקלוג (מוצר עתידי): התראות דחיפה בנייד (Web Push).**
  Liran שאל אם אפשר לקבל בנייד התראות "כמו הודעת וואטסאפ" ל-PWA. תשובה: כן — Web Push. בדיקת-קוד:
  יש כבר `manifest.ts` (PWA מותקן), **חסר** service-worker + VAPID + טבלת מנויים (מיגרציה) +
  שליחה מהשרת בנקודות-השיוך (כמו המייל) + הרשאה. **מלכוד iOS:** רק ב-PWA מותקן (iOS 16.4+), לא
  בטאב Safari. Liran בחר **לרשום לבקלוג, לא לבנות עכשיו**. שינוי docs-only. ראה פירוט DEV-023.
- **2026-07-13** — **DEV-024 נפתח (שלב 14 — שדרוג צ'אט לסגנון וואטסאפ).** 3 פיצ'רים
  (קבוצות מותאמות · אישורי שליחה+קריאה · עריכה+מחיקה עד 10 דק'). תוכנית מאושרת: 4 סבבים על
  תשתית-שיחות אחת. הכרעות Liran: ניהול-קבוצות מלא · אישורי-קריאה DM+קבוצה(כולם) · עריכה+מחיקה.
- **2026-07-13** — **DEV-024 R1 (תשתית מודל-שיחות) חי בייצור** ([PR #71](https://github.com/Liran-Raz/AVI.APP1/pull/71),
  main `d6166b9`, Vercel success, smoke ירוק). מיגרציה **`0024`** הוחלה+אומתה ע"י Liran (null_conv=0,
  SELECT-only). מודל `conversations`+`conversation_participants`+`messages.conversation_id/edited_at/
  deleted_at`; **fail-closed RPC-only** (לקוח SELECT-בלבד, כל כתיבה דרך SECURITY DEFINER); composite-FK
  (כמו 0011); טריגר-תאימות (cutover אפס-חלון); backfill אידמפוטני בעסקה-אחת. **סקירה אדוורסרית רב-סוכנית
  (3 סוכנים + אימות) תפסה קריטי (self-join) + 2 גבוהים (self-promote, roster חוצה-דיירים) בטיוטת-המיגרציה
  הראשונה — כולם נסגרו במעבר ל-fail-closed לפני ההחלה.** משמר-התנהגות (office+DMs זהים). `tsc`/`lint`/**402
  בדיקות** ירוקים. R4 קוד-בלבד; R2/R3 יצטרכו מיגרציית-RPC קטנה כל אחד.
- **2026-07-13** — **DEV-025 נרשם (מובייל): התייעצות על אפליקציה מהחנות.** סקירה מעמיקה Flutter
  מול עטיפה. **המלצה: עטיפת-Capacitor על הווב הקיים** (codebase אחד · אפס שכתוב-אבטחה · deploy מיידי
  נשמר · לעובד אין הבדל), לא Flutter מלא (מס ×2). כל יכולות-הנייטיב (push · וידג'טים/Live-Activities ·
  GPS/שעון-נוכחות · מצלמה/Face ID) נכנסות דרך plugins/תוספי-Swift, בלי לשכתב ל-Dart. Liran בחר לרשום
  לבקלוג (טראק נפרד, אחרי DEV-024). שינוי docs-only. ראה פירוט DEV-025.
- **2026-07-13** — **DEV-024 R2 (ניהול-קבוצות מלא) נבנה + נסקר + `0025` הוחלה בפרודקשן.** יצירה/שינוי-שם/
  הוספה/הסרה/עזיבה/מחיקה + בורר-חברים multi-select; מקטע "קבוצות" ברשימה; פאנל-ניהול (bottom-sheet בנייד/
  כרטיס בדסקטופ, `ResponsiveModal`); מיעון קבוצה `conv:<id>` (ה-activeKey נשאר מחרוזת אחת). **מודל admin-only**
  (בחירת Liran): רק מנהל-הקבוצה מנהל, כל חבר עוזב, מנהל-יחיד + ירושה-אוטומטית (קבוצה לא מתייתמת). מיגרציה
  **`0025`** = 5 RPCs של SECURITY DEFINER (rename/add/remove/leave/delete) + guard פנימי `_require_group_admin`
  — additive-בלבד, fail-closed (לקוח עדיין SELECT-בלבד). **הוחלה+אומתה ע"י Liran** (6 פונקציות secdef=t · 5
  ציבוריות can_exec=t · `_require_group_admin` לא-נגיש · conversations+participants SELECT-בלבד). **סקירה
  אדוורסרית רב-סוכנית (אבטחה + נכונות במקביל): 0 CRITICAL/HIGH** — 10 יעדי-תקיפה נסגרו (admin-only, אין
  self-promote, אין cross-tenant, office/DM חסינים דרך `kind='group'`); **7 ממצאי LOW/MEDIUM תוקנו לפני מסירה**
  (ניקוי-הודעות במעבר-שיחה, מיון-כרונולוגי מול שולחים-במקביל, `is_admin=false` בעזיבה/הסרה, הבזק-פרטים במעבר-
  קבוצה, כפתור-בתוך-כפתור לא-חוקי + נגישות, הוספה-חלקית). מוקאפ נייד+דסקטופ אושרו קודם (כולל תיקון "זכוכית
  חלבית" מאחורי הצ'אט). `tsc`/`lint`/**421 בדיקות** (+19) ירוקים. ענף `feat/chat-r2-groups`, ב-PR — QA +
  מיזוג = Liran. R3/R4 פתוחים.
- **2026-07-13** — **DEV-024 R2 — חי בייצור** ([PR #74](https://github.com/Liran-Raz/AVI.APP1/pull/74) squash,
  main `15a1aa7`, Vercel deploy=success, prod smoke ירוק: `/api/conversations`→401 לא-מאומת [הנתיב קיים],
  `/login`→200, `/messages`→307). QA יוזר-בודד אושר ע"י Liran ("תקין") מול ה-dev המקומי (0025 כבר חי בפרודקשן,
  אז שרשרת הקבוצות עבדה על החוט — `GET /api/conversations`→200, פולינג עם חותמת `+00:00`→200). **הערת git:**
  הקומיט נחת בטעות על main המקומי במהלך העבודה (ה-HEAD הוחזר) — זוהה ותוקן (הועבר ל-`feat/chat-r2-groups`,
  main המקומי אופס ל-origin/main); שום דבר לא נדחף ל-main שלא דרך PR. R3 (אישורי-קריאה+badge) + R4
  (עריכה/מחיקה, קוד-בלבד) נשארו — כל אחד מוקאפ-קודם + סקירה אדוורסרית.
- **2026-07-14** — **DEV-024 R3+R4 נבנו יחד + `0026` הוחלה בפרודקשן — ב-PR (סוגר את שלב 14).** Liran בחר
  לעשות R3+R4 יחד (QA אחד מקיף בסוף). **R3:** טיקים ✓/✓✓ (`readThrough` = min של last_read_at, ✓✓ כשכולם
  קראו — כולל המשרד, לפי בחירת Liran) + פאנל "נקרא ע"י" מפורט בלחיצה + badge לא-נקרא (שורות + ניווט ב-3
  מיקומים). **R4:** תפריט ערוך/מחק **מאוחד עם ה-read-by באותו פאנל** (לחיצה, בלי ריחוף — תיקון-מוקאפ לפי
  פידבק Liran) · "נערך" · tombstone. **מיגרציה `0026`** (הוחלה+אומתה ע"י Liran, postflight t/t/t): 2 RPCs
  definer (`mark_conversation_read` fail-closed upsert/update · `get_unread_counts` office-לפי-חברוּת) +
  הידוק policy-העריכה ל-`user_can_read_conversation` (סגר את חור החבר-שהוסר מסקירת R2). **מודל-קריאה:**
  `readState.recipients` בתשובת ה-list (טיקים + read-by) · `GET /api/messages/unread` (badge) ·
  `POST /api/messages/read` (mark-read) · `PATCH/DELETE /api/messages/[id]` (edit/soft-delete). **סקירה
  אדוורסרית רב-סוכנית (אבטחה + נכונות): 0 CRITICAL/HIGH.** תפסה **HIGH-נכונות** — עריכות/מחיקות של יוזרים
  אחרים לא הגיעו לשיחה פתוחה (poll-דלתא לפי `created_at` מפספס שינויים שלא מזיזים אותו) → **תוקן:** ה-poll
  עבר ל-recent-window + `reconcile` upsert-by-id (חולץ למודול טהור + בדיקת-רגרסיה) — וגם **MEDIUM** (badge-משרד
  לחבר-חדש → תוקן ב-`get_unread_counts` דרך חברוּת) + 2 LOW. `tsc`/`lint`/**440 בדיקות** (+19) ירוקים; הראוטים
  החדשים מתקמפלים ומאמתים auth (401/307). ענף `feat/chat-r3r4-receipts-edit`, ב-PR — QA + מיזוג = Liran.
- **2026-07-14** — **DEV-024 R3+R4 — חי בייצור. שלב 14 (DEV-024) הושלם (R1→R4).** QA של Liran תפס באג-מחיקה:
  `messages.body` נושא `check (length(btrim(body)) > 0)`, וה-tombstone איפס `body=""` → ה-CHECK דחה את העדכון,
  המחיקה נכשלה בשקט. תוקן: הגוף מוחלף בסמן לא-ריק (`[deleted]`) — התוכן עדיין נמחק-בפועל, וה-DTO מסתיר אותו. אושר
  ע"י Liran ("תקין"), מוזג ([PR #76](https://github.com/Liran-Raz/AVI.APP1/pull/76) squash, main `9b0b041`, Vercel
  deploy=success, prod smoke ירוק). **⚠️ ראה רשומת-התקלה למטה — PR #76 בלע בטעות גם את DEV-025 M1.**
- **2026-07-14** — **🔴 תקלת-סשנים-מקבילים: PR #76 מיזג 146 קבצים (R3/R4 + כל DEV-025 M1) ל-main/פרודקשן.**
  **מה קרה:** שני סשני Claude Code עבדו על אותו working-tree/HEAD (D:\AVI.APP) במקביל — סשן A (R3/R4 צ'אט) וסשן B
  (DEV-025 מובייל/Capacitor). מכיוון שחלקו **HEAD אחד**, הקומיטים של סשן B נחתו על ה-branch של סשן A, וה-squash של
  PR #76 בלע את הכל: R3/R4 + capacitor.config + פרויקט iOS (`web/ios/**`) + `native-bridge` + `lib/native*` +
  שינויי-OAuth-deep-link לקבצי-auth של הווב + `package-lock` (+16k) + עמודי privacy/terms. **שורש-התקלה = HEAD
  משותף, לא ה-staging** (ה-`git add` המפורש היה תקין; הקומיטים כבר היו על ה-branch). **מה נבדק (קריאה-בלבד):**
  פרודקשן בריא (Vercel success, smoke ירוק, R3/R4 חי); שכבת-ה-native אינרטית בווב לפי-תכנון (`isNativeApp()` false,
  `@capacitor/*` ב-dynamic-import של ענף-native בלבד, `NativeBridge` מרנדר null); **3 קבצי-ה-auth של הווב — מסלול
  ה-OAuth זהה בית-לבית, כל שינויי-ה-native מגודרים על `native===true`/`isNativeApp()`** (סיכון-הכניסה סגור סטטית);
  עמודי privacy/terms מדויקים ושמרניים (שוללים איסוף-מיקום). **מועצת-LLM (5 יועצים + peer-review) פסקה פה-אחד:
  לא לעשות revert** (revert של 146 קבצים = הפעולה המסוכנת ביותר — lock-file+app-shell משותפים, מוחק את R3/R4 החי,
  auto-deploy; להסיר קוד אינרטי). **החלטה: להשאיר.** פעולות-בעלים פתוחות (Liran): אימות-OAuth חי בפרודקשן + נעילת
  Vercel-rollback-lever. **עדכון 2026-07-16: אימות-ה-OAuth-החי בוצע ע"י ליראן** (עמוד-הכניסה של גוגל בפרודקשן עם
  `redirect_to=https://www.aviapp1.com/auth/callback` תקין, גלישה-פרטית) — סיכון-הכניסה נסגר גם אמפירית. **מניעה שננקטה:** פרוטוקול **git-owner יחיד** (סשן אחד נוגע ב-git, השני קפוא) — יושם מיד;
  DEV-025 הוקפא, R3/R4 מונה כ-git-owner. **מניעה קדימה (מוצע):** `git worktree` נפרד לכל סשן · בדיקת-CI שמסמנת PR
  שהיקף-קבציו סותר את כותרתו · CI e2e auth-smoke. תיעוד זה + לקח ב-HANDOFF.

---

### DEV-026 — מודול הנהלת-חשבונות + דוחות + רישום תוכנה ברשות המסים

**מטרה:** מודול חשבוניות/קבלות העומד בהוראות ניהול פנקסים, עמוד דוחות, ובסופו **רישום רשמי
כ"תוכנה לניהול מערכת חשבונות ממוחשבת"** במערכת המקוונת של רשות המסים (הושקה 13.05.2025).
מבוסס על קריאה מלאה של חוזר מ"ה 24/2004 (מסמכים ממוחשבים) + "הוראות להפקת קבצים במבנה אחיד"
v1.31, אימות-רשת (חשבוניות-ישראל 2026, עמדת-ענן) וסקירת-ארכיטקטורה. תוכנית מלאה אושרה ע"י
ליראן 2026-07-16 (כולל 4 החלטות-היקף: בשלבים משרד→לקוחות · 305/320/330/400 · מסמכים-ממוחשבים
ב-v1 · חשבוניות-ישראל ב-v1).

**עקרון-יסוד — ledger-first:** כל רשומה פיננסית תלויה ב-`ledgers` (בית-עסק), לא ב-`organizations`.
שלב א' = self-ledger יחיד למשרד; שלב ב' = ledgers ללקוחות המשרד בלי הגירה. **בולע את DEV-012**
(logo_url + business_id יושבים על ה-ledger, לא על organizations).

**אל-יעדים (v1):** אין הנהלת-חשבונות-כפולה, אין פקודות-יומן, אין מלאי ⇒ ייצוא במבנה-אחיד עם
INI שדה 1013=0 ("לא רלוונטי") בלי רשומות B100/B110/M100 — "מערכת מסמכים" לגיטימית לרישום.

**סבבים:** R1 יסודות (מיגרציה 0027) · R2 טיוטה→הפקה + UI מסמכים · R3 PDF עברי (spike
react-pdf; fallback puppeteer) + Storage bucket · R4 מנוע מבנה-אחיד + עמוד-דוחות + סימולטור ·
R5 חשבוניות-ישראל (שער-ממשלתי OAuth; סף ₪10,000 מ-1.1.2026 → ₪5,000 מ-1.6.2026) · R6 מסמכים
ממוחשבים (חתימת-CA-ענן per-office — בלי משמורת-מפתחות; הסכמות; "מסמך ממוחשב") · R7 חבילת-רישום.
אומדן ~42-65 ימי-פיתוח + ליד-טיימים (תעודה, שער-ממשלתי, בודק).

**סטטוס-על:** R1–R4 **מוזגו ל-main** (#79 `f96fc86`, #81 `308cf35`, #82 `00fa2f4`, #83 `00b8e94`);
מיגרציה 0027 **הוחלה+אומתה בפרודקשן**; **QA מקומי של ליראן עבר** בכל סבב. **פריסת-R4 לפרודקשן
הושלמה 2026-07-17:** תקלת-GitHub עולמית (16/07 22:21–23:50 UTC) חסמה זמנית את Vercel; מיד עם
ההתאוששות `00b8e94` נבנה בהצלחה (23:55 UTC), ואחריו `9ed0321` + רענון סופי `f32a87a` — הפרודקשן
מגיש את ה-main העדכני, smoke מלא ירוק (health/login 200 · tasks 307 · ledgers+reports APIs 401). **לולאת-הסימולטור
של R4 נסגרה 2026-07-17 (misim.gov.il, שני סבבים):** BKMVDATA / שלמות-נתונים / בדיקת-סיכומים —
תקין; **ליקוי-INI יחיד שנותר = 1006 מאופס** (מס' רישום — ייסגר בהגשת R7); 2 הערות-מבנה כלליות
(מינ' 2000 רשומות לדוגמת-רישום · היעדר B110) = פריטי-R7 מתוכננים לפי עמדת "מערכת מסמכים".
**תגלית: ליראן כבר רשום במרשם-התוכנות כבית-תוכנה — "LIRAN AI", מס' 314954835** (דרישת-קדם של
R7 שכבר בידיים; env מקומי: SOFTWARE_PRODUCER_VATID/NAME — **להוסיף גם ב-Vercel לפני הפעלת
המודול בפרודקשן**). הקוד חי-אך-רדום (דגל `INVOICING_UI` כבוי ב-Vercel).

**R4 (מוזג #83 `00b8e94`):** מנוע מבנה-אחיד + עמוד דוחות —
- **תיקון מלולאת-הסימולטור (סבב 1):** שדה 1025 אסור להיות עתידי → הייצוא קוטם את תאריך-הסיום
  ליום-ההפקה (כולל שאילתת-המסמכים — קובץ עקבי-עצמית), מזהיר בדיאלוג, ודוחה טווח שמתחיל בעתיד.
- **מנוע ייצוא "ממשק פתוח" (מבנה אחיד v1.31)** — מודול TS טהור נטול-DB
  (`server/openformat/`): תעתיק-שדות מלא מהמפרט הרשמי (A000 466 תווים כולל שדות-מבוטלים ·
  רשומות-סיכום INI · A100/Z900 · C100 444 · D110 339 · D120 222, כולל הזחות השדות-המבוטלים),
  מקודד fixed-width (סכומים X9(12)V99 עם סימן +/- לפי דוגמאות-המפרט, כמות V9999, תאריכים
  YYYYMMDD), **ISO-8859-8 לוגי** (iconv-lite; sanitizer לתווים לא-נתמכים ״׳"—₪→ש״ח), CRLF אחרי
  כל רשומה, מזהה-ראשי רנדומלי 15-ספרות, **INI 1013=0 בלי B100/B110/M100** (מערכת-מסמכים),
  מספור-רשומות רץ + ספירות 1002=1155, ZIP במבנה `OPENFRMT\<עוסק8>.<YY>\<MMDDhhmm>\` ובו
  INI.TXT + **BKMVDATA.zip** (סעיף 2.2(ד)) + דף-הוראות-חילוץ. ההבהרות מיושמות: ניכוי-במקור
  ב-+ (הבהרה 4), הנחות ב-− (הבהרה 5), מסמך-בסיס 1256/1257 לזיכויים (הבהרה 6, נפתר גם מחוץ
  לטווח), שדה-מקשר 1234↔1273/1323 (הבהרה 11), שלושת התאריכים (הבהרה 12, שעון Asia/Jerusalem).
  **17 בדיקות byte-exact** (כולל שלוש דוגמאות-הסימן מהמפרט + golden-file).
- **שכבת דוחות** — validator (טווח-תאריכים) · repository (עימוד-בטוח מעל תקרת ה-1000 של
  PostgREST; כשל-רועש על חיתוך; issued+cancelled בלבד, לעולם לא טיוטות) · service עם אגרגציות
  טהורות: **סיכום 27 סוגי-נספח-1** (לא-מנוהלים באפס — דרישת סעיף 2.6), **ספר מכירות** (זיכויים
  שליליים בסיכום, מבוטלים מסומנים-לא-נסכמים), **ספר תקבולים** (שורה לכל תשלום + סיכום
  לפי-אמצעי + ניכוי-במקור), **סיכום מע״מ חודשי**, **מאזן לקוחות** (חיובים מול תקבולים; 320
  מנטרל את עצמו; ניכוי-במקור נזקף כתקבול) · CSV עם BOM לאקסל. הרשאות: reports.view/export =
  בעלים+מנהל; **ייצוא מבנה-אחיד = invoices.export = בעלים-בלבד**; עובד ללא-דוחות (404).
  **15 בדיקות-service** (אגרגציות + שערים + אורקסטרציית-ייצוא).
- **API:** `GET /api/reports/[report]` (summary/sales/receipts/vat/client-balances; ?format=csv)
  + `GET /api/reports/export/openformat` (?mode=summary = תצוגת נספח-4 JSON; download = ZIP).
- **UI:** עמוד `/reports` + ניווט **"דוחות"** (אחרי "הנהלת חשבונות"; דגל+capability) — בורר-טווח
  (שנת-מס/רבעון/חודש/מותאם), רצועת-KPI, 5 טאבים (מובייל: מכירות/תקבולים/מאזן ככרטיסים
  נערמים), כרטיס "ממשק פתוח" (בעלים) → דיאלוג-סיכום-הפקה (נספח-4: ספירות, נתיב, אזהרות)
  לפני ההורדה, CSV לכל דוח, הדפסה עם גיליון-print (כותרת-הדפסה עם משרד+טווח; דיאלוג-הייצוא
  מודפס לבדו). מוקאפ אושר ע"י ליראן לפני המימוש. env חדשים (רשות): SOFTWARE_REG_NUMBER/NAME/
  VERSION/PRODUCER_VATID/PRODUCER_NAME (ברירות-מחדל: AVI.APP 1.0; 1006=00000000 עד הרישום).
- תלויות חדשות: `iconv-lite` + `jszip`. שער-איכות: tsc 0 · lint 0 · **511 בדיקות** · probes:
  ‎/reports 307 · כל ראוטי-הדוחות 401 · אין מיגרציה. **שער-בעלים: לולאת-סימולטור misim.gov.il.**

**R3 (מוזג #82 `00fa2f4`):** הפקת PDF עברי-RTL + מקור/העתק —
- **spike עבר:** `@react-pdf/renderer` מרנדר מסמך-מס עברי ברמת-ייצור (אומת ויזואלית ע"י המרת
  ה-PDF ל-PNG וקריאתו) → **puppeteer נדחה** (לא נדרש). פונט **Rubik (OFL) מוטמע base64**
  (`fonts-data.ts`) — אפס תלות-filesystem ב-Vercel serverless.
- **קוד:** `server/pdf/fonts.ts` (register memoized) + `invoice-document.tsx` (תבנית מ-DTO:
  כותרת+מספר, חותמת מקור/העתק/מבוטל, snapshot צדדים, טבלאות שורות+תקבולים, סכומים+מע"מ+ניכוי,
  באנר-ביטול, הפניית-בסיס לזיכוי, slot להקצאה ל-R5) · `documents.service.renderDocumentPdf`
  (issued-only; **הורדת-מקור ראשונה קוראת `mark_document_delivered`** → נעילת ביטול→זיכוי;
  אח"כ "העתק"; מקור מגודר ב-`invoices.send`) · route `GET /api/documents/[id]/pdf?copy=` (מזרים
  application/pdf, maxDuration 30) · UI: כפתורי "הורדת מקור/העתק" + "הדפסה" בתצוגת-המסמך.
- **אחסון נדחה ל-R6:** ב-R3 ה-PDF **נוצר על-פי-דרישה** (דטרמיניסטי מה-snapshot הקפוא) — אין
  bucket עדיין. Storage ייכנס ב-R6 כשחייבים לשמור **בייטים חתומים** (מסמך ממוחשב). מונע משטח-אחסון
  מוקדם ואישור-בעלים מיותר כרגע.
- שער-איכות: tsc 0 · lint 0 · 479 בדיקות · probe PDF-route unauth=401 · react-pdf server-only מאומת.

**R2 (מוזג #81 `308cf35`):** מחזור-חיים מלא של מסמכים —
- **הקשחת 0027:** בלם-תפקידים בתוך ה-DB (`_require_doc_operator_role`) על issue/cancel/credit/
  delivered — owner/admin בלבד גם ב-PostgREST ישיר (עובד = טיוטות בלבד; תואם למענקי-TS).
- **קוד:** `lib/money.ts` (אגורות↔₪, פרסינג-מחרוזתי בלי float; +8 בדיקות) · פרוסת-documents
  מלאה (validator עם replace-all לשורות/תקבולים והמחאה-מחייבת-בנק/סניף/חשבון/מספר · repo כולל
  עטיפות-RPC · service עם שערי-capability וגילום-שגיאות-RPC ל-400 · 5 ראוטים · apiClient; +13
  בדיקות-service). **UI:** `/invoicing` = רשימת-מסמכים (פילטרים, טבלה+כרטיסים) · אשף יצירה/עריכה
  (305/320/400, שורות+תקבולים, תצוגת-סכומים חיה לפי מע"מ-בתוקף ועוסק-פטור, "שמירה והפקה") ·
  `/invoicing/documents/[id]` תצוגה+פעולות (הפקה/עריכה/מחיקה לטיוטה; ביטול-עם-סיבה/יצירת-זיכוי
  להופק) · פרופיל-העסק עבר ל-`/invoicing/settings`. שער-איכות: tsc 0 · lint 0 · **471 בדיקות** ·
  probes 401/307 על כל הראוטים החדשים. QA של ליראן = מרוכז R1+R2 אחרי החלת 0027 (החלטתו).

**R1 (ב-PR [#79](https://github.com/Liran-Raz/AVI.APP1/pull/79), ענף `feat/dev-026-r1-ledgers`):**
- **מיגרציה `0027_invoicing_foundation.sql`** (טרם הוחלה): enums (`invoice_doc_type`
  '305'/'320'/'330'/'400', `invoice_doc_status`, `allocation_status`) · `ledgers` (זהות משפטית,
  self-ledger unique, backfill + insert-trigger לארגונים חדשים) · `documents` (snapshot מוכר+קונה,
  סכומים באגורות bigint, שדות-הקצאה, base_document לזיכוי) · `document_lines`/`document_payments`
  (D110/D120) · `document_counters` (**ללא-דילוגים**, fail-closed כמו 0020) · `customer_consents`
  (SELECT-בלבד עד R6) · `vat_rates` (17% עד 2024, 18% מ-2025, גלובלי-קריאה) · **קפיאון פוסט-הפקה
  ב-DB** (triggers חוסמים UPDATE/DELETE ללא-postgres) · **RPCs**: `issue_document` (נעילה→ולידציה→
  snapshot→חישוב-שרת→מספר-עוקב→issued; עוסק-פטור=מע"מ 0; 320 מחייב תשלומים=סה"כ),
  `cancel_document` (רק לפני-מסירה; המספר נשמר — דגל 1228), `create_credit_note` (טיוטת-330
  ממוסמך-בסיס), `mark_document_delivered`, `set_document_counter_start` (המשך-סדרה, owner-בלבד).
  Composite-FK org-pinning בכל טבלה (+ `clients_id_org_uq` חדש על clients).
- **קוד:** פרוסת-ledgers מלאה (validator→repo→service→routes→apiClient) · הרשאות
  `ledgers.*`/`invoices.*`/`reports.*` (post-0012; מבחן-הפריטי הורחב עם allowlist מתועד; Owner=הכל,
  Manager=תפעול בלי manage/export, Employee=view+טיוטה) · דגל `INVOICING_UI` (כבוי=אפס-UI) ·
  ניווט "הנהלת חשבונות" (אחרי "לקוחות") · עמוד `/invoicing` = פרופיל-עסק (טופס owner-בלבד +
  באנר-מוכנות; ללא business_id אי-אפשר להפיק) · 9 בדיקות-service חדשות.
- **שער-איכות R1:** tsc 0 · eslint 0 · **450 בדיקות** · probes: `/api/ledgers` unauth=401 envelope,
  `/invoicing` unauth=307→login · build מקומי מדולג (מגבלה סביבתית מתועדת; Vercel CI = השער).

**פעולות-בעלים (ליראן) לאורך המסלול:** הרצת 0027 ב-SQL Editor (אנסח חבילה) · פרטי-עסק של
המשרד (שם-רשמי, עוסק/ח.פ, כתובת) ב-`/invoicing` · אישור Storage-bucket (R3) · רישום-מפתחים
בשער-הממשלתי + sandbox (R5) · תעודת-CA למשרד ~₪200-400/שנה + דואר-רשום לפ"ש לפני משלוח-ממוחשב
ראשון (R6) · לולאת-סימולטור (R4/R7) · הגשת-רישום (R7) · פרטי בית-התוכנה (ח.פ. — משותף לעמודי-
החוק) · יעד-גיבוי-ישראל + הודעת-מקום-גיבוי (ציות 25(א); ה-DB ב-EU — ליווי רו"ח/עו"ד).

**הערות-תיאום:** מיגרציה 0027 נלקחה ע"י DEV-026 — המובייל (DEV-025 M2 push) ייקח next-free
כשיתחיל; `MOBILE_APP_TRACKING.md` ייושר בעדכון-docs הבא (PR #78 עדיין פתוח — לא נגענו בו כאן
כדי למנוע קונפליקט). עמוד `/invoicing` מוגן בשער-ה-layout (כמו `/messages`,`/dashboard`) — בלי
לגעת ב-middleware הרגיש.
