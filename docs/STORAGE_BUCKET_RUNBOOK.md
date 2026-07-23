# DEV-032 — Storage bucket + env runbook (R1a live QA)

מדריך-מפעיל להפעלת פיצ'ר-הקבצים המוצפן (DEV-032 R1a) לבדיקה חיה. הקוד כולו מגודר
מאחורי הדגל `STORAGE_UI` — עד שמבצעים את הצעדים כאן, שום דבר לא מופיע ולא רץ.

**סדר הצעדים:** (1) החלת מיגרציה `0031` · (2) יצירת bucket-אחסון + RLS · (3) הגדרת
משתני-סביבה · (4) הפעלה מחדש · (5) בדיקה.

> כל הצעדים הם על ה-**Supabase project האמיתי** (Cloud) שאליו ה-dev-server מתחבר —
> בדיוק כמו QA של DEV-026. הפעולות לא-הרסניות (טבלאות/‏bucket חדשים וריקים,
> מגודרים-דגל), אבל הן על ה-DB האמיתי — לכן זה שער-בעלים.

---

## שלב 1 — החלת מיגרציה 0031

ב-Supabase → **SQL Editor**, כ-**Role: postgres**:

1. הרץ את ה-**PREFLIGHT** (בראש `supabase/migrations/0031_attachments_and_encryption.sql`, מוער) — לוודא מצב-התחלה נקי.
2. הדבק והרץ את **כל קובץ המיגרציה** (מ-`begin;` עד `commit;`).
3. הרץ את ה-**POSTFLIGHT** (מוער בתחתית הקובץ). התוצאה הצפויה **בדיוק**:
   `t | 0 | 0 | t | 2 | SELECT,UPDATE | 1 | 6 | 1 | 6`

זה יוצר את הטבלאות `attachments` + `encryption_keys`, 6 ה-RPCs, טריגר-ההקפאה, וה-org-pins.

---

## שלב 2 — bucket-אחסון `attachments` + מדיניות RLS

הקבצים המוצפנים (ciphertext) נשמרים ב-Supabase Storage, לא ב-DB. צריך bucket **פרטי**
+ מדיניות שמאפשרת לחבר-ארגון פעיל לגשת רק לנתיב של הארגון שלו (`org/<org_id>/…`).

### 2א. יצירת ה-bucket
Supabase → **Storage** → **New bucket**:
- **Name:** `attachments`
- **Public bucket:** ❌ **כבוי** (פרטי — חובה; אחרת הקבצים המוצפנים חשופים ל-URL ציבורי).
- צור.

### 2ב. מדיניות RLS על `storage.objects`
Supabase → **Storage** → **Policies** → על ה-bucket `attachments` → **New policy** →
**For full customization** (SQL). צור **שתי** מדיניות (SELECT ל-הורדה, INSERT ל-העלאה):

```sql
-- קריאה (הורדה): חבר-ארגון פעיל, רק בנתיב org/<org_id>/…
create policy "attachments read own org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'org'
    and public.user_is_active_member_of(((storage.foldername(name))[2])::uuid)
  );

-- כתיבה (העלאה): אותו תנאי
create policy "attachments insert own org"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'org'
    and public.user_is_active_member_of(((storage.foldername(name))[2])::uuid)
  );
```

**רשות (מומלץ):** מדיניות DELETE — מאפשרת ניקוי-best-effort של אובייקט-יתום אם
מנטוע-השורה נכשל אחרי ההעלאה (בלעדיה סתם נשארים יתומים; R2 מפייס אותם):

```sql
create policy "attachments delete own org"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'org'
    and public.user_is_active_member_of(((storage.foldername(name))[2])::uuid)
  );
```

> **אם ה-SQL נכשל עם `must be owner of table objects`:** `storage.objects` בבעלות
> `supabase_storage_admin`. במקרה כזה השתמש ב-**Storage → Policies → New policy**
> ובחר את התבנית "custom" — ה-Dashboard מחיל את אותה מדיניות עם ההרשאות הנכונות.
> הדבק את ה-`using` / `with check` מלמעלה בשדות המתאימים.

**אימות:** Storage → Policies על `attachments` — אמורות להופיע 2 (או 3) מדיניות
ל-`authenticated`.

---

## שלב 3 — משתני-סביבה (`web/.env.local`)

הוסף שתי שורות ל-`web/.env.local`:

```
STORAGE_UI=1
AVI_MASTER_KEK_B64=<מפתח-אב base64 של 32 בייט>
```

ליצירת מפתח-אב מקומי (dev בלבד — לא KMS):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **חשוב:** `AVI_MASTER_KEK_B64` הוא מפתח-האב שעוטף את מפתחות-המשרד. **שמור עליו** —
> אם תאבד אותו, כל הקבצים שהוצפנו איתו הופכים לבלתי-פענוחים. לפרודקשן זה יוחלף
> ב-AWS KMS (R1b/שער-בעלים); ל-dev-QA מקומי המפתח בקובץ מספיק.

---

## שלב 4 — הפעלה מחדש של ה-dev-server

משתני-סביבה נטענים רק בעליית-השרת. מ-`web/`:

```bash
npm run dev
```

(אם כבר רץ dev-server — עצור אותו והפעל מחדש, אחרת הוא לא יראה את `STORAGE_UI`/‏`AVI_MASTER_KEK_B64` החדשים.)

---

## שלב 5 — בדיקה בדפדפן (`http://localhost:3000`)

היכנס עם משתמש-בעלים. **3 מקומות** להיכנס לפיצ'ר:

1. **עמוד לקוח → טאב "קבצים"** (`/clients/<id>`): 4 תיקיות. בחר "תעודות ודוחות" →
   גרור/בחר קובץ (PDF/תמונה/Word/Excel, עד 4MB) → אמור להופיע בשורה עם גודל+שעה+מעלה.
2. **דיאלוג-עריכת-משימה** (`/tasks` → ✎ על משימה): מקטע "קבצים מצורפים" עם פתק-ניתוב.
   העלה קובץ למשימה **עם לקוח** → הוא אמור לצוץ גם ב**תיק-הלקוח › קבצי-משימות**.
3. **עמוד "ספריית המשרד"** (`/storage` בתפריט-הצד): 5 תיקיות — קבצי-המשרד (העלאה),
   קבצי-לקוחות/קבצי-משימות (תצוגות-על), ארכיון.

**מה לוודא:**
- ✅ **הורדה מפענחת:** לחץ על אייקון-ההורדה → הקובץ יורד ונפתח תקין (פוענח).
- ✅ **ניתוב:** קובץ ממשימה-עם-לקוח מופיע בתיק-הלקוח; ממשימה-בלי-לקוח בספריית-המשרד.
- ✅ **ארכוב:** תפריט ⋯ → "העברה לארכיון" → נעלם מהתיקייה, מופיע ב-ספריית-המשרד › ארכיון.
- ✅🔒 **הצפנה-במנוחה (העיקר):** Supabase → Storage → `attachments` → `org/<org_id>/…`
  → **הורד את האובייקט הגולמי** ופתח אותו — אמור להיות **ג׳יבריש בינארי** (ciphertext),
  לא ה-PDF/התמונה המקוריים. זו ההוכחה שגניבת-ה-bucket חושפת רק ciphertext.
- ✅ **חסימת-סוגים:** נסה להעלות קובץ `.html`/`.svg` (או שנה סיומת) → אמור להידחות (415).

---

## כיבוי / rollback

- **כיבוי מהיר:** הסר `STORAGE_UI=1` מ-`web/.env.local` (או קבע `0`) + הפעל מחדש —
  ה-UI נעלם, הקוד רדום, הנתונים נשארים.
- **rollback מלא של המיגרציה:** ה-ROLLBACK המוער בתחתית `0031` — **בטוח רק לפני שהועלה
  קובץ כלשהו** (הפלת הטבלאות מייתמת את אובייקטי-ה-Storage). אם כבר יש קבצים — אל
  תריץ rollback; פשוט כבה את הדגל.
