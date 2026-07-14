# מניפסט קבצים — טראק המובייל / הכנה לחנות (DEV-025)

**מה הקובץ הזה:** רשימה מדויקת של **כל** הקבצים ששייכים להכנת-האפליקציה-לחנות, מסווגים לפי
"100% מובייל (חדש)" מול "**משותף** (הווב משתמש בהם גם — לגעת בזהירות)". נועד למי שממשיך את
העבודה (הדרכה מתחילה בעוד ~שבוע — אין לחץ), וכדי שלעולם לא נבלבל בין קוד-מובייל לקוד-ווב.

> נכון ל-main `e286f68`. ראה גם: [`MOBILE_APP_TRACKING.md`](./MOBILE_APP_TRACKING.md) (לוח-בקרה) ·
> [`MOBILE_BUILD.md`](./MOBILE_BUILD.md) (מדריך-בנייה).

---

## 🟢 A. פרויקט Capacitor — 100% מובייל, עצמאי (בטוח לגעת כיחידה)

| נתיב | מה |
|---|---|
| `web/capacitor.config.ts` | **קונפיג-האב:** מצב hosted (`server.url`), `appId=com.aviapp1.app`, רקע נייבי, פלאגינים (StatusBar/Splash) |
| `web/capacitor-fallback/index.html` | מסך offline (webDir) — מוצג רק כשהאתר לא זמין |
| `web/ios/**` | **פרויקט ה-Xcode המלא (25 קבצים).** מפתח: `App/App/Info.plist` (סכימת deep-link), `Assets.xcassets/AppIcon…` (אייקון), `Splash.imageset` |
| `web/android/**` | **פרויקט Android המלא (77 קבצים).** מפתח: `app/src/main/AndroidManifest.xml` (הרשאת INTERNET + intent-filter ל-deep-link), `res/mipmap-*` (אייקונים), `res/drawable-*/splash` |
| `web/assets/icon-only.svg` · `icon-foreground.svg` · `icon-background.svg` · `splash.svg` · `splash-dark.svg` | **מקורות-וקטור** לאייקון/splash (מוזנים ל-`@capacitor/assets`) |

## 🟢 B. קוד-ווב מודע-נייטיב — קבצים חדשים, 100% מובייל

| נתיב | מה |
|---|---|
| `web/src/lib/native.ts` | `isNativeApp()` — זיהוי ה-shell דרך ה-Capacitor global (SSR-safe, false בווב) |
| `web/src/lib/native-auth.ts` | קבועי-סכימה משותפים ל-deep-link (`com.aviapp1.app://auth/callback`) |
| `web/src/components/native/native-bridge.tsx` | מאזין `appUrlOpen` → מעביר את קוד-ה-OAuth ל-WebView; **null בווב** |

## 🟡 C. קבצי-ווב משותפים — **שונו** (המובייל הוסיף פרוסה; הווב תלוי בהם — **לגעת בזהירות!**)

| נתיב | מה המובייל הוסיף | סיכון-ווב |
|---|---|---|
| `web/src/app/layout.tsx` | `viewportFit:"cover"` + עיגון `<NativeBridge/>` | נמוך (NativeBridge no-op בווב) |
| `web/src/app/globals.css` | 4 מחלקות safe-area (`topbar-safe`/`pb-safe`/`pt-drawer-safe`/`pb-drawer-safe`) | נמוך (env→0 בדסקטופ) |
| `web/src/components/dashboard/app-shell.tsx` | החלת מחלקות-safe-area על topbar/bottom-nav/drawer | נמוך-בינוני (משפיע גם על מובייל-ווב) |
| `web/src/app/login/login-form.tsx` | ענף Google נייטיבי (`else` = מסלול-הווב המקורי) | **auth — רגיש**; מסלול-הווב זהה בית-לבית |
| `web/src/app/api/auth/oauth/google/route.ts` | שדה `native?` optional ב-schema | **auth**; בווב false → זהה |
| `web/src/server/services/auth.service.ts` | ענף `native` → redirectTo של deep-link | **auth**; בווב → `SITE_URL/auth/callback` (זהה) |
| `web/src/lib/api-client.ts` | פרמטר `native` ל-`startOAuthGoogle` | נמוך |
| `web/src/components/marketing/LandingGlass.tsx` | 2 קישורי-פוטר (`/privacy`, `/terms`) | נמוך |
| `web/package.json` + `web/package-lock.json` | תלויות `@capacitor/*` (+ devDeps: cli, assets) | נמוך (build עבר) |

> **⚠️ כלל-הזהב:** קבצי §C משרתים את **אפליקציית-הווב החיה**. שינוי בהם = פוטנציאל-השפעה על
> פרודקשן. קבצי §A/§B הם מובייל-בלבד ואינרטיים בווב.

## 🟢 D. עמודי-חוק — דרישת-חנות (חדשים)

| נתיב | מה |
|---|---|
| `web/src/app/privacy/page.tsx` · `privacy/en/page.tsx` | מדיניות-פרטיות (עברית קובעת + אנגלית) |
| `web/src/app/terms/page.tsx` · `terms/en/page.tsx` | תנאי-שימוש (עברית קובעת + אנגלית) |

> ⏳ פתוח: מילוי ה-`[...]` (ישות משפטית + ח.פ., כתובת, אימייל, מחוז) + אישור עו״ד. **החלטת להשאיר
> כרגע** ולטפל בהמשך.

## 🟢 E. תיעוד

| נתיב | מה |
|---|---|
| `docs/MOBILE_APP_TRACKING.md` | לוח-בקרה (סטטוס · מה נדרש מכל מקום · roadmap) |
| `docs/MOBILE_BUILD.md` | מדריך-בנייה והגשה צעד-אחר-צעד |
| `docs/MOBILE_FILES.md` | **מניפסט זה** |

---

## 🧭 מדריך-החלטה מהיר: "האם מותר לי לגעת?"

- **§A / §B (מובייל-בלבד):** בטוח — לא נוגע בווב.
- **§D (עמודי-חוק):** בטוח (עמודים עצמאיים).
- **§C (משותף):** ⚠️ בזהירות — לוודא שהמסלול-הווב לא משתנה (במיוחד ה-4 קבצי-ה-auth). כל שינוי כאן
  ראוי ל-PR + Vercel preview לפני מיזוג.

## ▶️ כשמחדשים (בעוד ~שבוע)
1. **git:** להתחיל מ-`main` (`git switch -c <ענף-חדש> main`) — לא מהענף הישן `feat/dev-025-m1-web` (מיותר).
2. הצעד המעשי-הבא: הגדרת-Supabase → בנייה → בדיקת-מכשיר (ר׳ `MOBILE_BUILD.md`).
3. **M2 (push)** ידרוש מיגרציה **`0027`** (לא 0026 — נתפס ע"י צ׳אט R3/R4).
