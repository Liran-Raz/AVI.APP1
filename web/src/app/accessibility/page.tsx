import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "הצהרת נגישות — AVI.APP",
  description:
    "הצהרת הנגישות של AVI.APP — מחויבותנו להנגשת השירות לאנשים עם מוגבלות, התקן שלפיו פועלים (ת״י 5568 / WCAG 2.0 AA), ההתאמות שבוצעו, מגבלות ידועות ודרכי פנייה.",
};

// קבוע (בנייה דטרמיניסטית — ללא Date.now()). גם מועד הביקורת האחרונה של הסדרי הנגישות.
const LAST_UPDATED = "18 ביולי 2026";

export default function AccessibilityPage() {
  return (
    <main dir="rtl" lang="he" className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="text-sm text-primary hover:underline">
              → חזרה לדף הבית
            </Link>
            <Link href="/accessibility/en" className="text-sm text-primary hover:underline">
              English
            </Link>
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold">הצהרת נגישות</h1>
          <p className="mt-2 text-sm text-muted-foreground">עודכן לאחרונה: {LAST_UPDATED}</p>
        </header>

        <article
          className="space-y-4 text-sm sm:text-base leading-relaxed
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground
            [&_p]:text-muted-foreground
            [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:pr-5 [&_ul]:space-y-1 [&_ul]:mt-1"
        >
          <p className="rounded-lg border border-border bg-card p-4 text-foreground">
            הצהרת נגישות זו מפרטת את מחויבותה של AVI.APP (״<strong>השירות</strong>״, ״<strong>אנחנו</strong>״)
            להנגשת השירות לאנשים עם מוגבלות, ואת מצב הנגישות של האתר נכון למועד העדכון שלמעלה.
            אנו רואים בנגישות ערך ותהליך מתמשך, ופועלים לשיפורה באופן שוטף. גרסה זו בעברית היא הגרסה המחייבת
            והקובעת; גרסת{" "}
            <Link href="/accessibility/en" className="text-primary hover:underline">האנגלית</Link>{" "}
            ניתנת לנוחות בלבד.
          </p>

          <section>
            <h2>1. מחויבות לנגישות</h2>
            <p>
              אנו מחויבים לאפשר לכלל המשתמשים, לרבות אנשים עם מוגבלות, לעשות שימוש בשירות בעצמאות, בכבוד
              ובנוחות. בהתאם ל<strong>חוק שוויון זכויות לאנשים עם מוגבלות, התשנ״ח-1998</strong>, ולתקנות
              שהותקנו מכוחו, אנו משקיעים משאבים בביצוע התאמות-הנגישות הנדרשות ובשיפורן המתמשך, מתוך אמונה
              שלכל אדם מגיעה זכות שווה לקבל שירות. השירות מופעל על-ידי{" "}
              <strong>לירן רז, עוסק מורשה 314954835</strong>.
            </p>
          </section>

          <section>
            <h2>2. התקן שלפיו אנו פועלים</h2>
            <p>
              האתר הונגש בהתאם ל<strong>תקן הישראלי ת״י 5568</strong> להנגשת תכנים באינטרנט ברמה{" "}
              <strong>AA</strong>, המעוגן בהנחיות <strong>WCAG 2.0</strong> הבינלאומיות, ובהתאם לתקנות
              שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013. לחוויית-גלישה מיטבית עם
              תוכנת הקראת-מסך אנו ממליצים על NVDA העדכנית.
            </p>
          </section>

          <section>
            <h2>3. ההתאמות שבוצעו</h2>
            <p>בין אמצעי הנגישות המיושמים כיום בשירות:</p>
            <ul>
              <li>מבנה-עמוד סמנטי עם אזורי-ניווט (landmarks) וכותרת ראשית אחת לכל עמוד;</li>
              <li>
                הפעלה מלאה באמצעות מקלדת (Tab, מקשי-חצים, Enter, ו-Esc ליציאה מחלונות ותפריטים), עם
                חיווי-מיקוד (focus) גלוי לכל רכיב אינטראקטיבי;
              </li>
              <li>קישור ״דילוג לתוכן״ בראש עמוד הבית;</li>
              <li>
                כלי-נגישות מובנה — תפריט התאמות-תצוגה: הגדלת-טקסט, ניגודיות, גופן-קריא, מרווח-שורות,
                עצירת-אנימציות, סמן מוגדל, והדגשת קישורים/כותרות;
              </li>
              <li>כיבוד העדפת המשתמש להפחתת אנימציות (prefers-reduced-motion);</li>
              <li>תוויות (labels) מקושרות לשדות הטפסים;</li>
              <li>הצהרת שפה וכיוון-כתיבה מימין-לשמאל (RTL);</li>
              <li>התאמה לדפדפנים הנפוצים ולשימוש בטלפון הנייד;</li>
              <li>ממשק דו-לשוני עברית/אנגלית.</li>
            </ul>
          </section>

          <section>
            <h2>4. שיפור מתמשך</h2>
            <p>
              אנו ממשיכים במאמצים לשפר את נגישות השירות, כחלק ממחויבותנו לאפשר לכלל המשתמשים — לרבות אנשים
              עם מוגבלות — לקבל שירות נגיש. ייתכן שחלקים מסוימים באתר טרם הונגשו במלואם. אם
              נתקלת בבעיה או בחסם-נגישות כלשהו, נשמח שתעדכן אותנו (ראו ״דרכי פנייה״ להלן), ואנו נעשה כל מאמץ
              למצוא פתרון מתאים ולטפל בכך בהקדם האפשרי.
            </p>
          </section>

          <section>
            <h2>5. דרכי פנייה — רכז/ת הנגישות</h2>
            <p>
              נתקלת בבעיית-נגישות, או שיש לך הצעה לשיפור? נשמח לשמוע. ניתן לפנות אל רכז/ת הנגישות שלנו:
            </p>
            <ul>
              <li><strong>שם:</strong> לירן רז</li>
              <li>
                <strong>דוא״ל:</strong>{" "}
                <a href="mailto:liran995@gmail.com" dir="ltr" className="text-primary hover:underline">
                  liran995@gmail.com
                </a>
              </li>
              <li>
                <strong>טלפון:</strong>{" "}
                <a href="tel:+972508880981" dir="ltr" className="text-primary hover:underline">
                  050-8880981
                </a>
              </li>
            </ul>
            <p>בפנייתך, פרטו במה נתקלתם ובאיזה עמוד, כדי שנוכל לאתר ולתקן את הבעיה במהירות.</p>
          </section>

          <section>
            <h2>6. שירות דיגיטלי בלבד</h2>
            <p>
              השירות ניתן באופן מקוון בלבד ואין לו סניף או מוקד-שירות פיזי הפתוח לקהל; על-כן הסדרי הנגישות
              מתמקדים בהנגשת האתר.
            </p>
          </section>

          <section>
            <h2>7. מועד הבדיקה</h2>
            <p>
              הסדרי הנגישות של השירות נבדקו ועודכנו לאחרונה בתאריך <strong>{LAST_UPDATED}</strong>. הצהרה זו
              תעודכן מעת-לעת בהתאם לשיפורים ולבדיקות נוספות.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
