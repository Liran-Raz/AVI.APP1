import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CalendarDays, CheckCircle2, ListChecks, Users } from "lucide-react";

const features = [
  {
    icon: ListChecks,
    title: "תור משימות חכם",
    description:
      "כל המשימות במקום אחד, ממוינות לפי זמן הביצוע הקרוב. ארבעה סטטוסים ברורים: חדש, קיבלתי, בעבודה, בוצע.",
  },
  {
    icon: CalendarDays,
    title: "לוח שבועי גרירה",
    description:
      "תצוגת שבוע ראשון-שבת בעין אחת. גוררים משימה ליום ושעה אחרת ומעבירים שבועות קדימה ואחורה בקליק.",
  },
  {
    icon: Users,
    title: "כרטיסי לקוח",
    description:
      "כל הלקוחות שלך עם אנשי קשר, סוג עסק (פטור, מורשה, חברה בע״מ, עמותה, אגודה שיתופית) ומידע רלוונטי.",
  },
  {
    icon: CheckCircle2,
    title: "סנכרון בזמן אמת",
    description:
      "כשמשנים סטטוס משימה - כל הצוות רואה את זה מיד. עובד גם בפלאפון בלי להוריד אפליקציה.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
              א
            </div>
            <span className="font-bold text-lg">AVI.APP</span>
          </div>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">התחברות</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">
                התחל בחינם
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex items-center">
        <div className="container mx-auto px-6 py-20 md:py-32">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent text-accent-foreground text-sm font-medium">
              <span className="size-2 rounded-full bg-primary" />
              בנוי במיוחד למשרדי רואי חשבון בישראל
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
              ניהול משימות
              <br />
              <span className="text-primary">שמתאים לקצב שלך</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              תור משימות יומי, לוח שבועי עם גרירה, ניהול לקוחות וכל הצוות במקום אחד.
              <br />
              עובד בדפדפן ובפלאפון, ללא התקנה.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <Button size="lg" asChild>
                <Link href="/signup">
                  פתחו משרד חדש
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">יש לי כבר חשבון</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              ללא כרטיס אשראי · התחלה תוך 30 שניות
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/40 bg-muted/30">
        <div className="container mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              כל מה שצריך כדי לנהל את היום
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              ארבעה כלים שמדברים בעברית, חושבים בעברית, ומתאימים לרואי חשבון.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border/60">
                <CardHeader>
                  <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                    <feature.icon className="size-5" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="container mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} AVI.APP · כל הזכויות שמורות</p>
          <p>תוצרת ישראל 🇮🇱</p>
        </div>
      </footer>
    </div>
  );
}
