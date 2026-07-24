# Runbook — הקמת Google Cloud KMS למפתח-האב (DEV-032, מפעיל: לירן)

**מה מקימים כאן:** פרויקט Google Cloud ייעודי ובו **מפתח-האב (master KEK)** של
הצפנת-הקבצים, באזור **me-west1 (תל-אביב)**, ברמת-הגנה **HSM**. המפתח יושב בכוונה
בענן *שונה* מהדאטה (Supabase רצה על AWS) — שום פריצת-ספק יחידה לא מניבה גם את
הצופן וגם את המפתח שפותח אותו.

**עלות צפויה:** ~$1 לחודש למפתח-HSM + ~$0.03 לכל 10,000 קריאות (אצלנו — סנטים).
בהמשך (B2) יתווסף Cloud Run לפי שימוש — כמעט אפס בהיקף שלנו.

**מתי מריצים:** אפשר עכשיו, במקביל לפיתוח. שום דבר כאן לא מדליק את הפיצ'ר —
ההדלקה היחידה תתבצע בסוף (אחרי Cloud Run + ניקוי-QA), בפעולה אחת ב-25MB.

---

## שלב 1 — פרויקט ייעודי

1. היכנס ל-https://console.cloud.google.com עם חשבון-הגוגל שלך.
2. ודא **אימות דו-שלבי (2-Step Verification)** דלוק על החשבון:
   https://myaccount.google.com/security ← "2-Step Verification". חשבון זה יחזיק
   מפתח-הצפנה של דאטה פיננסית — חובה.
3. בסרגל העליון: בורר-הפרויקטים ← **NEW PROJECT** ← שם: `avi-app-media`
   (או דומה). **רשום לעצמך את ה-Project ID** (למשל `avi-app-media`,
   לפעמים עם ספרות — הוא יופיע בשם-המשאב של המפתח).
4. אם נדרש — חבר **Billing** (כרטיס אשראי). מומלץ מיד:
   Billing ← Budgets & alerts ← צור תקציב-התראה של **$10/חודש** (רק התראה,
   לא חסימה) — כך כל הפתעה תצוץ במייל.

## שלב 2 — הפעלת ה-API של KMS

1. בתפריט: **APIs & Services ← Library**.
2. חפש **"Cloud Key Management Service (KMS) API"** ← **Enable**.

## שלב 3 — יצירת מפתח-האב

1. בתפריט: **Security ← Key Management** (אפשר לחפש "KMS" בחיפוש העליון).
2. **CREATE KEY RING**:
   - Name: `avi-master`
   - Location type: **Region** ← **me-west1 (Tel Aviv)**  ⚠ חשוב — לא global.
3. בתוך ה-Key Ring: **CREATE KEY**:
   - Name: `master-kek`
   - Protection level: **HSM**
   - Purpose: **Symmetric encrypt/decrypt**
   - Rotation period: **Never (manual)** — ⚠ בכוונה. רוטציה אוטומטית מייצרת
     גרסת-מפתח חדשה כל תקופה, וכל גרסת-HSM שמורה מחויבת ~$1/חודש; כלי
     re-wrap מסודר מתוכנן לסבב R2 ורק אז נפעיל רוטציה.
4. פתח את המפתח שנוצר והעתק את **שם-המשאב המלא** (Copy resource name).
   הוא נראה כך:
   `projects/<PROJECT_ID>/locations/me-west1/keyRings/avi-master/cryptoKeys/master-kek`
   **את הערך הזה נשים ב-Vercel בתור `AVI_GCP_KMS_KEY_NAME`.**

## שלב 4 — Service Account מצומצם ל-Vercel

1. בתפריט: **IAM & Admin ← Service Accounts ← CREATE SERVICE ACCOUNT**:
   - Name: `vercel-kek`
   - בשלב "Grant this service account access to project" — **אל תעניק כלום.
     דלג.** (ההרשאה תינתן על המפתח בלבד, לא על הפרויקט.)
2. חזור ל-**Security ← Key Management** ← פתח את `master-kek` ← לשונית
   **PERMISSIONS** (או סמן את המפתח ← ADD PRINCIPAL בחלונית):
   - New principal: כתובת ה-SA שנוצרה
     (`vercel-kek@<PROJECT_ID>.iam.gserviceaccount.com`)
   - Role: **Cloud KMS CryptoKey Encrypter/Decrypter**
   - שמור. ⚠ ההרשאה חייבת להיות **על המפתח עצמו** — לא ברמת הפרויקט.
3. חזרה ל-Service Accounts ← פתח את `vercel-kek` ← לשונית **KEYS** ←
   **ADD KEY ← Create new key ← JSON** ← יירד קובץ JSON למחשב.
   ⚠ **הקובץ הזה רגיש** — מוחקים אותו מיד אחרי שלב 5.

## שלב 5 — משתני-סביבה ב-Vercel

1. המר את קובץ-ה-JSON ל-base64 — ב-PowerShell (החלף את הנתיב):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\User\Downloads\avi-app-media-xxxx.json"))
```

2. העתק את הפלט (שורה ארוכה אחת).
3. ב-Vercel: **Project ← Settings ← Environment Variables**, סביבת
   **Production בלבד**:
   - `AVI_GCP_KMS_KEY_NAME` = שם-המשאב המלא משלב 3.4
   - `AVI_GCP_SA_KEY_B64` = פלט ה-base64
   - ⚠ **לא** מגדירים `STORAGE_UI` עדיין — ההדלקה תגיע בסוף, אחרי Cloud Run
     וניקוי-ה-QA, ואחרי Redeploy.
4. **מחק את קובץ-ה-JSON מהמחשב** (וגם מסל-המיחזור) אחרי ההדבקה.

## מה אסור

- לא להעניק ל-SA שום תפקיד ברמת-הפרויקט (Owner/Editor/Viewer — כלום).
- לא להשתמש ב-SA הזה לשום דבר אחר.
- לא לשלוח את קובץ-ה-JSON או ה-base64 בצ'אט/מייל — הוא נשאר רק ב-Vercel.
- לא למחוק/להשבית את המפתח `master-kek` אחרי שהפיצ'ר חי — כל הקבצים
  המוצפנים תלויים בו (מחיקת-מפתח ב-KMS היא בלתי-הפיכה אחרי תקופת-החסד).

## מה לדווח בחזרה בצ'אט

- ✔ Project ID
- ✔ שם-המשאב המלא של המפתח (זה לא סוד)
- ✔ אישור ששני משתני-ה-env הוגדרו ב-Vercel Production ושקובץ-ה-JSON נמחק
- ✘ לעולם לא את ה-base64 עצמו

## הערות המשך (B2 — Cloud Run)

- שירות-המדיה של Cloud Run ירוץ **באותו פרויקט** וישתמש ב-**זהות מובנית**
  (service identity) — בלי קובץ-מפתח בכלל; ניתן לו את אותו תפקיד על
  `master-kek` בעת הפריסה (שלב נפרד עם runbook משלו).
- לפני ההדלקה בפרודקשן יבוצע **ניקוי-QA חד-פעמי**: המפתחות שנטבעו ב-QA החי
  נעטפו במפתח-הפיתוח המקומי ולא ניתנים לפתיחה ב-KMS — אנסח SQL + מחיקת
  אובייקטים ייעודיים, אתה מריץ (קיימים שם רק קבצי-בדיקה).
- ראה גם: `docs/STORAGE_BUCKET_RUNBOOK.md` (ה-bucket וה-RLS — כבר בוצע ואומת).
