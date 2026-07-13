# AVI.APP — לוח בקרה: אפליקציית מובייל (Android + iOS)

**מה הקובץ הזה:** לוח-סטטוס חי למסלול האפליקציה (DEV-025). מרכז את כל מה שאנחנו יודעים, מה בוצע,
ומה נדרש מכל מקום — כדי שאפשר יהיה להמשיך מכל מחשב. **לעדכן את הקובץ בכל התקדמות.**

- **מדריך בנייה מעשי (איך בונים):** [`docs/MOBILE_BUILD.md`](./MOBILE_BUILD.md)
- **בקלוג כללי של הפרויקט:** [`docs/DEV_TRACKING.md`](./DEV_TRACKING.md)
- **ענף העבודה:** `feat/dev-025-m1-web` (טרם מוזג ל-main)

---

## 1. סטטוס במבט-על

| שלב | תיאור | נחוץ? | סטטוס |
|---|---|---|---|
| **M1-A** | עמודי פרטיות + תנאים (דו-לשוני) · Safe-areas | חובה | ✅ קוד מוכן |
| **M1-B** | שלד Capacitor (iOS+Android) · אייקונים · splash | חובה | ✅ קוד מוכן |
| **M1-C** | התחברות Google נייטיבית | חובה | ✅ קוד מוכן |
| **M1 — הגדרה/בנייה/בדיקה** | Supabase · בנייה · QA · חשבונות · משפטי | חובה | 🔲 אצל Liran |
| **M1-D** | חנויות: `.well-known` · נכסים · הגשה | חובה | 🔲 |
| **M2** | Push נייטיבי (מיגרציה `0026`) | מומלץ מאוד | 🔲 |
| **M3** | וידג׳טים למסך-בית | רשות | 🔲 |
| **M4** | Live Activities (כרטיס-חי) | רשות | 🔲 |

**מצב נוכחי:** כל קוד M1 מוכן ונבדק (tsc 0 · lint 0 · 421 בדיקות · הווב ללא שינוי). הכדור אצל Liran
להגדרה + בנייה + בדיקה.

---

## 2. כרטיס-עובדות (Reference — הכל במקום אחד)

| שדה | ערך |
|---|---|
| אסטרטגיה | **Capacitor 8 — עטיפת WebView במצב HOSTED** (טוען את האתר החי, לא ארוז) |
| כתובת חיה | `https://www.aviapp1.com` |
| **appId** (קבוע!) | `com.aviapp1.app` |
| שם תצוגה | `AVI.APP` |
| **URL scheme** (deep-link) | `com.aviapp1.app://auth/callback` |
| צבע רקע / splash | נייבי `#0d1c32` · מותג כחול `#0054cc` |
| Capacitor | 8.4.1 · iOS = **SwiftPM** (בלי CocoaPods) |
| מיקום הפרויקט הנייטיבי | בתוך `web/` → `web/ios/` · `web/android/` · `web/capacitor.config.ts` |
| מקורות אייקון/splash | `web/assets/*.svg` (מיוצרים דרך `@capacitor/assets`) |
| מסך offline | `web/capacitor-fallback/index.html` |

**עיקרון hosted (חשוב):** שינוי בקוד-ווב → deploy ל-Vercel → מתעדכן מיידית באפליקציה, **בלי בנייה
מחדש/עדכון-חנות**. רק שינוי **נייטיבי** (אייקון/פלאגין/קונפיג/deep-link) דורש בנייה מחדש.

---

## 3. מה בוצע — פירוט (ענף `feat/dev-025-m1-web`)

- [x] **`540beb0` M1-A משפטי** — `/privacy` + `/terms` (עברית קובעת) + `/privacy/en` + `/terms/en`,
      מתג-שפה + סעיף גרסה-קובעת, קישור בפוטר. הגנה מלאה (AS-IS, הגבלת-חבות, שיפוי, אין-ייעוץ-מקצועי,
      Controller/Processor, דין ישראלי). *נותרו placeholders `[...]` + אישור עו״ד.*
- [x] **`e95d68b` M1-A safe-areas** — `viewportFit:cover` + 4 מחלקות `env(safe-area-inset-*)` על
      topbar/bottom-nav/drawer. no-op בדסקטופ (אומת).
- [x] **`ab1aa86` M1-B שלד Capacitor** — hosted, `capacitor.config.ts`, פרויקטי iOS+Android,
      הרשאת INTERNET, StatusBar/Splash נייבי, fallback offline.
- [x] **`b2f68a1` M1-B אייקונים + splash** — iOS AppIcon (full-bleed) + Android adaptive/legacy +
      splash light/dark, כל הצפיפויות. אומת ויזואלית.
- [x] **`09052fa` M1-C Google נייטיבי** — דפדפן-מערכת + deep-link handoff (PKCE ב-WebView).
      web ללא שינוי. *נדרשת הוספת ה-Redirect URL ב-Supabase (ר׳ למטה).*
- [x] **`d07d97e` docs** — runbook בנייה.

---

## 4. מה נדרש — לפי מקום/אחראי

### 🟦 Supabase (הגדרה — 2 דק׳) · אחראי: **Liran**
- [ ] Dashboard → Authentication → URL Configuration → **Redirect URLs** → הוסף:
      `com.aviapp1.app://auth/callback` (אל תמחק את הקיים). **חוסם התחברות Google בנייטיב.**

### 🍏 Apple / iOS · אחראי: **Liran** (חובה Mac)
- [ ] חשבון **Apple Developer** — $99/שנה.
- [ ] בניית iOS: `cd web && npx cap open ios` → Xcode → Signing team → Archive (ר׳ runbook §5).
- [ ] בדיקה על iPhone אמיתי.
- [ ] פרטים ל-`.well-known` (בהמשך): **Apple Team ID**.

### 🤖 Google / Android · אחראי: **Liran**
- [ ] חשבון **Google Play** — $25 חד-פעמי.
- [ ] בניית Android: `cd web && npx cap open android` → signed `.aab` (ר׳ runbook §4).
- [ ] ⚠️ **גיבוי ה-keystore + סיסמאות** (קבוע — אובדן = אי-אפשר לעדכן).
- [ ] בדיקה על מכשיר Android אמיתי.
- [ ] פרטים ל-`.well-known` (בהמשך): **טביעת-אצבע SHA256** של ה-keystore.

### ⚖️ משפטי · אחראי: **Liran**
- [ ] מילוי `[...]` בעמודי `/privacy` + `/terms`: שם ישות + ח.פ./עוסק · כתובת · אימייל · מחוז שיפוט.
- [ ] אישור עו״ד ישראלי לפני הגשה.

### 💻 קוד · אחראי: **הצוות/הסוכן** (כשיהיו התלויות)
- [ ] `.well-known/apple-app-site-association` + `assetlinks.json` — **כשיהיו Team-ID + SHA256**
      (משדרג את ה-OAuth ל-Universal/App Links, מאובטח יותר מ-scheme).
- [ ] M2: מיגרציה `0026` (`device_tokens`) + `@capacitor/push-notifications` + שליחה מהשרת.

### 🏪 הגשה לחנויות · אחראי: **Liran** (+ עזרת הצוות)
- [ ] נכסי-חנות: צילומי-מסך, תיאור, אייקון, קטגוריה.
- [ ] שאלון-פרטיות בכל חנות.
- [ ] הגשה + מענה לביקורת (לתקצב סבב אפל 4.2).

---

## 5. צעדים הבאים — לפי סדר

1. **Supabase Redirect URL** (§4) — פותח את התחברות Google.
2. **`cd web && npm install && npx cap sync`** (ר׳ runbook §3).
3. **בניית Android** (`.aab`) — הכי מהיר להתחיל (בלי Mac).
4. **בניית iOS** על ה-Mac.
5. **בדיקה על מכשירים** (צ׳ק-ליסט ב-runbook §6).
6. **חשבונות-חנות** + **מילוי משפטי** + **אישור עו״ד**.
7. → כשעובד ויציב: **M2 (push)**, ואז רשות: M3/M4.

---

## 6. מפת-דרכים עתידית

| שלב | מה | הערות |
|---|---|---|
| **M2** | Push נייטיבי (APNs/FCM) | מיגרציה `0026` = `device_tokens`; שליחה בנקודות-ההתראה הקיימות (שיוך-משימה, מעבר, הודעה). מחליף את DEV-023 (Web Push). |
| **M3** | וידג׳טים למסך-בית | תוסף Swift (WidgetKit) + Android (Glance). רעיונות: משימות-היום · המשימה הנוכחית · הודעות שלא-נקראו · לוח-שבועי. |
| **M4** | Live Activities | כרטיס-חי במסך-נעילה/Dynamic Island (iOS 16.1+). רעיון: טיימר שעות-חיוב · התקדמות משימות-היום · ספירה-לדדליין. |

**אחרי M4 — מסלול-האפליקציה גמור.** M3/M4 = רשות. כל פיצ׳ר-ווב עתידי מופיע באפליקציה חינם (hosted).

---

## 7. יומן התקדמות

| תאריך | מה |
|---|---|
| 2026-07-13 | M1-A/B/C קוד הושלם ונבדק (6 commits). נוצרו runbook + לוח-הבקרה הזה. הענף נדחף ל-GitHub. |

> **הוראת-שימוש:** כשמתקדמים — לסמן `[x]`, לעדכן את טבלת הסטטוס (§1), ולהוסיף שורה ל-§7.
