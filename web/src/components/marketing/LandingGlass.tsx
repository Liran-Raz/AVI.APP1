"use client";

// The Liquid Glass marketing landing page. Client component: all copy runs
// through `t(he, en)`, the hero product demo is fully React-state driven (no
// direct DOM node juggling), scroll-reveal is applied via INLINE style (so a
// language re-render never clobbers it), and the sticky-nav shadow is React
// state. Everything renders inside the `.mkt` wrapper whose `dir` comes from
// the language context — isolation lives in marketing.css.

import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  Aurora,
  LangToggle,
  MarketingLangProvider,
  useMarketingLang,
} from "./marketing-lang";

// Same-origin internal routes (the landing lives on the same app as the auth
// pages). Plain <a> is fine here — leaving the landing for auth is a full nav.
const SIGNUP_URL = "/signup";
const LOGIN_URL = "/login";
const FORGOT_URL = "/forgot-password";

/** delay helper for staggered reveals */
const d = (v: string): CSSProperties => ({ ["--d" as string]: v }) as CSSProperties;

function Check({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ============================================================
// Hero product demo — state driven
// ============================================================

type Tag = "urgent" | "normal" | "progress" | "ok";
type DemoTask = {
  id: number;
  title: [string, string];
  client: [string, string];
  tag: Tag;
  label: [string, string];
  done: boolean;
  entering: boolean;
};

let demoSeq = 1;
const mk = (
  title: [string, string],
  client: [string, string],
  tag: Tag,
  label: [string, string],
  done = false,
  entering = true,
): DemoTask => ({ id: demoSeq++, title, client, tag, label, done, entering });

const INITIAL: DemoTask[] = [
  mk(["דוח מע״מ — יוני", "VAT report — June"], ["כהן אחזקות בע״מ · עד היום", "Cohen Holdings Ltd · due today"], "urgent", ["דחוף", "Urgent"]),
  mk(["תלושי שכר — 12 עובדים", "Payslips — 12 employees"], ["מסעדת הגפן · עד 9 ביולי", "Ha'Gefen Restaurant · due Jul 9"], "normal", ["רגיל", "Normal"]),
  mk(["דוח שנתי 2025", "Annual report 2025"], ["י.מ. הנדסה בע״מ · עד 30 ביולי", "Y.M. Engineering Ltd · due Jul 30"], "progress", ["בתהליך", "In progress"]),
  mk(["התאמות בנק — יוני", "Bank reconciliation — June"], ["ר.נ ייעוץ · הושלם על ידי רות", "R.N Consulting · completed by Ruth"], "ok", ["הושלם", "Done"]),
];

function HeroDemo() {
  const { t } = useMarketingLang();
  const startedRef = useRef(false);

  const [tasks, setTasks] = useState<DemoTask[]>(() => INITIAL.map((x) => ({ ...x })));
  const [count, setCount] = useState(0);
  const [noteOn, setNoteOn] = useState(false);

  // One-time entrance on mount (the hero is always in view): tasks slide in
  // one after another, the completed one gets checked, the weekly counter
  // counts up, and the "teammate updated" note pops. No live reorder loop —
  // it stays a clean, stable snapshot after the intro (robust, glitch-free).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: number[] = [];
    const stagger = reduce ? 0 : 200;
    const base = reduce ? 0 : 240;

    INITIAL.forEach((tk, i) => {
      timers.push(
        window.setTimeout(() => {
          setTasks((prev) => prev.map((p) => (p.id === tk.id ? { ...p, entering: false } : p)));
        }, base + i * stagger),
      );
    });

    const done = base + INITIAL.length * stagger;
    timers.push(
      window.setTimeout(() => {
        setTasks((prev) => prev.map((p) => (p.tag === "ok" ? { ...p, done: true } : p)));
        if (reduce) {
          setCount(23);
          return;
        }
        const to = 23;
        const ms = 800;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
          setCount(Math.round(to * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, done + (reduce ? 0 : 160)),
    );
    timers.push(window.setTimeout(() => setNoteOn(true), done + (reduce ? 0 : 720)));

    return () => timers.forEach((id) => clearTimeout(id));
  }, []);

  return (
    <div className="hero-demo-wrap reveal" style={d(".15s")}>
      <div className="glass-strong app-window">
        <div className="app-chrome">
          <span className="dot d1" /><span className="dot d2" /><span className="dot d3" />
          <span className="app-title">{t("AVI.APP — תור משימות", "AVI.APP — Task queue")}</span>
        </div>
        <div className="demo-body">
          <div className="demo-head">
            {t("היום · יום ג׳, 15 ביולי", "Today · Tue, Jul 15")}
            <span className="live-badge"><span className="pulse" /> {t("מתעדכן עכשיו", "Updating now")}</span>
          </div>
          <ul className="demo-list">
            {tasks.map((tk) => (
              <li key={tk.id} className={`d-task${tk.done ? " done" : ""}${tk.entering ? " entering" : ""}`}>
                <span className="chk"><Check size={13} /></span>
                <div className="t-txt">
                  <strong>{t(tk.title[0], tk.title[1])}</strong>
                  <small>{t(tk.client[0], tk.client[1])}</small>
                </div>
                <span className={`tag ${tk.tag}`}>{t(tk.label[0], tk.label[1])}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="float-card glass f-stat">
        <strong>{count}</strong>
        <span>{t("משימות הושלמו השבוע במשרד", "tasks completed this week")}</span>
      </div>
      <div className={`float-card glass f-note${noteOn ? " on" : ""}`}>
        <span className="bell">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        </span>
        <span>
          {t("רות עדכנה:", "Ruth updated:")} <b>{t("שכר יוני — הושלם", "June payroll — done")}</b>
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Landing
// ============================================================

function LandingInner() {
  const { t, dir, lang } = useMarketingLang();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || 0) > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal via INLINE style so a language re-render can't clobber it.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".mkt");
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).style.opacity = "1";
            (e.target as HTMLElement).style.transform = "none";
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Pointer sheen on the strong glass panels (inline CSS vars — React-safe).
  useEffect(() => {
    if (!matchMedia("(pointer:fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const panels = Array.from(document.querySelectorAll<HTMLElement>(".mkt .glass-strong"));
    const cleanups: Array<() => void> = [];
    panels.forEach((panel) => {
      const host = (panel.closest(".hero-demo-wrap") as HTMLElement) || panel;
      const move = (e: PointerEvent) => {
        const r = panel.getBoundingClientRect();
        panel.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
        panel.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      };
      host.addEventListener("pointermove", move as EventListener, { passive: true });
      cleanups.push(() => host.removeEventListener("pointermove", move as EventListener));
    });
    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <div className="mkt" dir={dir} lang={lang}>
      <a className="skip" href="#main">{t("דילוג לתוכן", "Skip to content")}</a>
      <Aurora />

      <header className={`glass-nav${scrolled ? " scrolled" : ""}`} id="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#top"><span className="logo-mark">א</span> AVI.APP</a>
          <nav className="nav-links" aria-label={t("ניווט ראשי", "Main navigation")}>
            <a href="#features">{t("יכולות", "Features")}</a>
            <a href="#screens">{t("מסכי המערכת", "Screens")}</a>
            <a href="#how">{t("איך זה עובד", "How it works")}</a>
          </nav>
          <div className="nav-cta">
            <LangToggle />
            <a className="btn btn-glass" href={LOGIN_URL}>{t("התחברות", "Log in")}</a>
            <a className="btn btn-primary" href={SIGNUP_URL}>{t("הירשם", "Sign up")}</a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div className="hero-txt">
              <span className="eyebrow reveal"><span className="pin" /> {t("מערכת ניהול למשרדי רואי חשבון", "Management system for accounting firms")}</span>
              <h1 className="reveal" style={d(".06s")}>
                {t("כל המשימות של המשרד —", "All your firm's tasks —")}
                <br />
                <span className="grad">{t("במקום אחד.", "in one place.")}</span>
              </h1>
              <p className="lead reveal" style={d(".12s")}>
                {t(
                  "AVI.APP עוזרת למשרדי רואי חשבון לנהל משימות, לקוחות וצוות: תור עבודה ברור, לוח שבועי וכרטיס לקוח מלא. בעברית, פשוט, ומכל דפדפן.",
                  "AVI.APP helps accounting firms manage tasks, clients and team: a clear work queue, a weekly board and a full client card. Simple, and from any browser.",
                )}
              </p>
              <div className="hero-ctas reveal" style={d(".18s")}>
                <a className="btn btn-primary btn-lg" href={SIGNUP_URL}>{t("הירשם", "Sign up")}</a>
                <a className="btn btn-glass btn-lg" href="#screens">{t("צפו איך זה נראה", "See how it looks")}</a>
              </div>
              <ul className="hero-checks reveal" style={d(".24s")}>
                <li><Check size={18} /> {t("ללא התקנה", "No installation")}</li>
                <li><Check size={18} /> {t("עברית מלאה, מימין לשמאל", "Full Hebrew, right to left")}</li>
                <li><Check size={18} /> {t("הרשאות לפי תפקיד", "Role-based permissions")}</li>
              </ul>
            </div>
            <HeroDemo />
          </div>
        </section>

        {/* Trust strip */}
        <section className="trust">
          <div className="wrap">
            <div className="glass trust-in reveal">
              <p>{t("נבנה יחד עם משרד רואי חשבון פעיל בישראל:", "Built with an active accounting firm in Israel:")}</p>
              <span className="chip">{t("תור משימות", "Task queue")}</span>
              <span className="chip">{t("לוח שבועי", "Weekly board")}</span>
              <span className="chip">{t("כרטיסי לקוח", "Client cards")}</span>
              <span className="chip">{t("צוות והרשאות", "Team & permissions")}</span>
              <span className="chip">{t("התראות בזמן אמת", "Real-time alerts")}</span>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="section" id="features">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow reveal"><span className="pin" /> {t("היכולות", "Capabilities")}</span>
              <h2 className="sec-title reveal" style={d(".06s")}>{t("הכלים שמשרד רואי חשבון באמת צריך", "The tools an accounting firm really needs")}</h2>
              <p className="sec-lead reveal" style={d(".12s")}>{t("בלי פיצ'רים מיותרים. ארבעה כלים פשוטים שעושים סדר בעבודה היומיומית.", "No bloat. Four simple tools that bring order to daily work.")}</p>
            </div>
            <div className="grid-feats">
              <article className="glass feat reveal">
                <span className="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></svg></span>
                <h3>{t("תור משימות חכם", "Smart task queue")}</h3>
                <p>{t("כל משימה עם לקוח, תאריך יעד ועדיפות. רואים מיד מה דחוף, מה בתהליך ומה הושלם.", "Every task with a client, due date and priority. See at a glance what's urgent, in progress and done.")}</p>
              </article>
              <article className="glass feat reveal" style={d(".08s")}>
                <span className="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg></span>
                <h3>{t("לוח שבועי", "Weekly board")}</h3>
                <p>{t("כל השבוע במבט אחד. גוררים משימה מיום ליום — והצוות מעודכן מיד.", "The whole week at a glance. Drag a task between days — the team updates instantly.")}</p>
              </article>
              <article className="glass feat reveal" style={d(".16s")}>
                <span className="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><circle cx="12" cy="13" r="2" /><path d="M8 18a4 4 0 0 1 8 0" /></svg></span>
                <h3>{t("כרטיס לקוח מלא", "Full client card")}</h3>
                <p>{t("פרטי החברה, אנשי הקשר והמשימות של כל לקוח — במקום אחד, בלי לחפש בניירות.", "Company details, contacts and tasks for each client — in one place, no paper chasing.")}</p>
              </article>
              <article className="glass feat reveal" style={d(".24s")}>
                <span className="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
                <h3>{t("צוות והרשאות", "Team & permissions")}</h3>
                <p>{t("מזמינים עובדים במייל וקובעים תפקיד — בעלים, מנהל או עובד. כל אחד רואה את מה שמותר לו.", "Invite employees by email and set a role — owner, manager or employee. Each sees only what they're allowed.")}</p>
              </article>
            </div>
          </div>
        </section>

        {/* System screens */}
        <section className="section" id="screens" style={{ paddingTop: "1rem" }}>
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow reveal"><span className="pin" /> {t("מסכי המערכת", "System screens")}</span>
              <h2 className="sec-title reveal" style={d(".06s")}>{t("ככה תיראה המערכת מבפנים", "This is how the system looks inside")}</h2>
              <p className="sec-lead reveal" style={d(".12s")}>{t("מסכי העבודה המרכזיים — במחשב, בלפטופ ובנייד.", "The main work screens — on desktop, laptop and mobile.")}</p>
            </div>

            {/* Screen 1 — task queue */}
            <div className="screen reveal">
              <div className="screen-cap">
                <span className="num">1</span>
                <h3>{t("תור המשימות", "The task queue")}</h3>
                <p>{t("מסך העבודה המרכזי של המשרד: שלוש עמודות ברורות — לביצוע, בתהליך, הושלם.", "The firm's main work screen: three clear columns — to do, in progress, done.")}</p>
                <ul>
                  <li><Check /> {t("כל משימה משויכת ללקוח ולעובד", "Every task assigned to a client and employee")}</li>
                  <li><Check /> {t("תאריכי יעד ועדיפויות צבועים וברורים", "Colour-coded, clear due dates and priorities")}</li>
                  <li><Check /> {t("חיפוש וסינון לפי לקוח או עדיפות", "Search and filter by client or priority")}</li>
                </ul>
              </div>
              <div className="screen-stage">
                <span className="stage-glow" aria-hidden="true" />
                <span className="stage-floor" aria-hidden="true" />
                <span className="scene-chip glass" style={{ top: "-4px", insetInlineStart: "3%" }}><span aria-hidden="true">🔔</span> <span>{t("3 משימות להיום", "3 tasks due today")}</span></span>
                <div className="glass-strong app-frame">
                  <div className="app-chrome"><span className="dot d1" /><span className="dot d2" /><span className="dot d3" /><span className="app-title">{t("AVI.APP — תור משימות · משרד לוי ושות׳", "AVI.APP — Task queue · Levi & Co.")}</span></div>
                  <div className="frame-body">
                    <div className="mock-shell">
                      <aside className="mock-side">
                        <span className="ms-brand"><i>א</i> AVI.APP</span>
                        <span className="ms-item active"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></svg> {t("תור משימות", "Task queue")}</span>
                        <span className="ms-item"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg> {t("לוח שבועי", "Weekly board")}</span>
                        <span className="ms-item"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg> {t("לקוחות", "Clients")}</span>
                        <span className="ms-item"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg> {t("צוות", "Team")}</span>
                        <span className="ms-item"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.2 4.2l2.9 2.9M16.9 16.9l2.9 2.9M1 12h4M19 12h4M4.2 19.8l2.9-2.9M16.9 7.1l2.9-2.9" /></svg> {t("הגדרות", "Settings")}</span>
                      </aside>
                      <div className="mock-main">
                        <div className="mock-top">
                          <h4>{t("תור משימות", "Task queue")}</h4>
                          <span className="mini-chip">{t("4 משימות פעילות", "4 active tasks")}</span>
                          <span className="spacer" />
                          <span className="mini-chip">{t("כל העדיפויות ▾", "All priorities ▾")}</span>
                          <span className="mini-btn">{t("+ משימה חדשה", "+ New task")}</span>
                        </div>
                        <div className="kanban">
                          <div className="kcol">
                            <div className="kcol-h"><span className="kdot todo" /> {t("לביצוע", "To do")} <span className="cnt">2</span></div>
                            <div className="kcard"><strong>{t("דוח מע״מ — יוני", "VAT report — June")}</strong><small>{t("כהן אחזקות בע״מ", "Cohen Holdings Ltd")}</small><div className="krow"><span className="pill red">{t("דחוף", "Urgent")}</span><span className="pill blue">{t("עד היום, 15:00", "due today, 15:00")}</span></div></div>
                            <div className="kcard"><strong>{t("מקדמות מס הכנסה", "Income-tax advances")}</strong><small>{t("ר.נ ייעוץ", "R.N Consulting")}</small><div className="krow"><span className="pill blue">{t("עד 15 ביולי", "due Jul 15")}</span></div></div>
                          </div>
                          <div className="kcol">
                            <div className="kcol-h"><span className="kdot doing" /> {t("בתהליך", "In progress")} <span className="cnt">2</span></div>
                            <div className="kcard"><strong>{t("דוח שנתי 2025", "Annual report 2025")}</strong><small>{t("י.מ. הנדסה בע״מ · רות", "Y.M. Engineering Ltd · Ruth")}</small><div className="krow"><span className="pill amber">{t("בעבודה", "Working")}</span><span className="pill blue">{t("עד 30 ביולי", "due Jul 30")}</span></div></div>
                            <div className="kcard"><strong>{t("תלושי שכר — 12 עובדים", "Payslips — 12 employees")}</strong><small>{t("מסעדת הגפן · דוד", "Ha'Gefen Restaurant · David")}</small><div className="krow"><span className="pill blue">{t("עד 9 ביולי", "due Jul 9")}</span></div></div>
                          </div>
                          <div className="kcol">
                            <div className="kcol-h"><span className="kdot done" /> {t("הושלם", "Done")} <span className="cnt">1</span></div>
                            <div className="kcard kdone"><strong>{t("התאמות בנק — יוני", "Bank reconciliation — June")}</strong><small>{t("ר.נ ייעוץ · הושלם היום", "R.N Consulting · done today")}</small><div className="krow"><span className="pill green">{t("✓ הושלם", "✓ Done")}</span></div></div>
                            <div className="kempty">{t("גררו לכאן משימה שהסתיימה", "Drag a finished task here")}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Screen 2 — weekly board (flipped) */}
            <div className="screen flip reveal">
              <div className="screen-cap">
                <span className="num">2</span>
                <h3>{t("הלוח השבועי", "The weekly board")}</h3>
                <p>{t("מתכננים את השבוע של כל המשרד בגרירה פשוטה — בלי טבלאות ובלי נייר.", "Plan the whole firm's week with a simple drag — no tables, no paper.")}</p>
                <ul>
                  <li><Check /> {t("שבוע מלא, ראשון עד שבת, במסך אחד", "A full week, Sunday to Saturday, on one screen")}</li>
                  <li><Check /> {t("גוררים משימה ליום אחר — והיא זזה לכולם", "Drag a task to another day — it moves for everyone")}</li>
                  <li><Check /> {t("היום הנוכחי מודגש תמיד", "Today is always highlighted")}</li>
                </ul>
              </div>
              <div className="screen-stage">
                <span className="stage-glow" aria-hidden="true" />
                <span className="stage-floor" aria-hidden="true" />
                <div className="glass-strong app-frame">
                  <div className="app-chrome"><span className="dot d1" /><span className="dot d2" /><span className="dot d3" /><span className="app-title">{t("AVI.APP — לוח שבועי · 13–19 ביולי", "AVI.APP — Weekly board · Jul 13–19")}</span></div>
                  <div className="frame-body" style={{ position: "relative" }}>
                    <div className="mock-main">
                      <div className="mock-top">
                        <h4>{t("לוח שבועי", "Weekly board")}</h4>
                        <span className="mini-chip">{t("13–19 ביולי 2026", "Jul 13–19, 2026")}</span>
                        <span className="spacer" />
                        <span className="mini-chip">{t("‹ שבוע", "‹ Week")}</span>
                        <span className="mini-chip">{t("שבוע ›", "Week ›")}</span>
                      </div>
                      <div className="cal">
                        <div className="day"><div className="dh">{t("א׳ 13", "Sun 13")}</div><div className="devs"><div className="ev green">{t("התאמות בנק ✓", "Bank recon ✓")}</div></div></div>
                        <div className="day"><div className="dh">{t("ב׳ 14", "Mon 14")}</div><div className="devs"><div className="ev">{t("מאזן בוחן — הגפן", "Trial balance — Gefen")}</div><div className="ev amber">{t("פגישת לקוח 11:00", "Client meeting 11:00")}</div></div></div>
                        <div className="day today"><div className="dh">{t("ג׳ 15 · היום", "Tue 15 · Today")}</div><div className="devs"><div className="ev red">{t("דוח מע״מ — כהן", "VAT — Cohen")}</div><div className="ev">{t("מקדמות מס", "Tax advances")}</div></div></div>
                        <div className="day"><div className="dh">{t("ד׳ 16", "Wed 16")}</div><div className="devs"><div className="ev">{t("שכר — 12 תלושים", "Payroll — 12 slips")}</div></div></div>
                        <div className="day"><div className="dh">{t("ה׳ 17", "Thu 17")}</div><div className="devs"><div className="ev">{t("דוח שנתי — י.מ.", "Annual — Y.M.")}</div><div className="ev amber">{t("ביקורת פנימית", "Internal audit")}</div></div></div>
                        <div className="day"><div className="dh">{t("ו׳ 18", "Fri 18")}</div><div className="devs"><div className="ev">{t("סגירת שבוע", "Week close")}</div></div></div>
                        <div className="day"><div className="dh">{t("ש׳ 19", "Sat 19")}</div><div className="devs"><div className="cal-empty">{t("אין משימות", "No tasks")}</div></div></div>
                      </div>
                    </div>
                    <span className="drag-hint glass">✥ {t("גררו משימה ליום אחר", "Drag a task to another day")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Screen 3 — client card in a laptop */}
            <div className="screen reveal">
              <div className="screen-cap">
                <span className="num">3</span>
                <h3>{t("כרטיס הלקוח — בפגישה", "The client card — in the meeting")}</h3>
                <p>{t("יושבים מול הלקוח? כל מה שצריך לדעת — פרטים, אנשי קשר ומשימות פתוחות — פתוח מולכם בלחיצה אחת.", "Sitting across from the client? Everything you need — details, contacts and open tasks — open in front of you in one click.")}</p>
                <ul>
                  <li><Check /> {t("פרטי חברה, ח.פ וסוג עסק", "Company details, reg. number and type")}</li>
                  <li><Check /> {t("אנשי קשר עם טלפון ומייל", "Contacts with phone and email")}</li>
                  <li><Check /> {t("המשימות הפתוחות של הלקוח, במקום אחד", "The client's open tasks, in one place")}</li>
                </ul>
              </div>
              <div className="screen-stage">
                <span className="stage-glow" aria-hidden="true" />
                <span className="stage-floor" aria-hidden="true" />
                <span className="scene-chip glass" style={{ top: "-8px", insetInlineEnd: "4%" }}><span aria-hidden="true">📅</span> <span>{t("בעוד 15 דק׳: פגישה עם דנה כהן", "In 15 min: meeting with Dana Cohen")}</span></span>
                <div className="laptop">
                  <div className="laptop-screen">
                    <div className="frame-body">
                      <div className="app-chrome"><span className="dot d1" /><span className="dot d2" /><span className="dot d3" /><span className="app-title">{t("AVI.APP — כרטיס לקוח", "AVI.APP — Client card")}</span></div>
                      <div className="mock-main">
                        <div className="client-head">
                          <span className="avatar">כא</span>
                          <div className="ch-txt"><strong>{t("כהן אחזקות בע״מ", "Cohen Holdings Ltd")}</strong><small>{t("חברה בע״מ · ח.פ 512345678 · לקוח פעיל", "Ltd company · Reg. 512345678 · Active client")}</small></div>
                          <span className="spacer" style={{ flex: 1 }} />
                          <span className="mini-btn">{t("+ משימה ללקוח", "+ Task for client")}</span>
                        </div>
                        <div className="tabs"><span className="tab">{t("פרטים", "Details")}</span><span className="tab active">{t("אנשי קשר", "Contacts")}</span><span className="tab">{t("משימות", "Tasks")}</span></div>
                        <div className="crow"><span className="ci">דכ</span><div className="ct"><strong>{t("דנה כהן — מנכ״לית", "Dana Cohen — CEO")}</strong><small>052-1234567 · dana@kohen.co.il</small></div><span className="tag normal">{t("ראשי", "Primary")}</span></div>
                        <div className="crow"><span className="ci">יל</span><div className="ct"><strong>{t("יוסי לוי — הנהלת חשבונות", "Yossi Levi — Bookkeeping")}</strong><small>03-1234567 · yossi@kohen.co.il</small></div></div>
                        <div className="crow"><span className="ci" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>!</span><div className="ct"><strong>{t("2 משימות פתוחות ללקוח זה", "2 open tasks for this client")}</strong><small>{t("דוח מע״מ — עד היום · דוח שנתי — עד 30 ביולי", "VAT — due today · Annual — due Jul 30")}</small></div><span className="tag progress">{t("לצפייה", "View")}</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="laptop-base" />
                </div>
              </div>
            </div>

            {/* Screen 4 — the office on mobile (flipped) */}
            <div className="screen flip reveal">
              <div className="screen-cap">
                <span className="num">4</span>
                <h3>{t("המשרד בנייד", "The office, on mobile")}</h3>
                <p>{t("יצאתם מהמשרד? הדשבורד המלא נשאר איתכם בטלפון — אותן משימות, אותו סדר.", "Out of the office? The full dashboard stays with you on your phone — same tasks, same order.")}</p>
                <ul>
                  <li><Check /> {t("מותקנת למסך הבית כמו אפליקציה", "Installs to your home screen like an app")}</li>
                  <li><Check /> {t("מקבלים התראה כשמשימה מסתיימת", "Get notified when a task is completed")}</li>
                  <li><Check /> {t("אותם נתונים, מסונכרנים תמיד", "The same data, always in sync")}</li>
                </ul>
              </div>
              <div className="screen-stage">
                <span className="stage-glow" aria-hidden="true" />
                <span className="stage-floor" aria-hidden="true" />
                <span className="scene-chip glass" style={{ bottom: "30px", insetInlineStart: "6%" }}><span aria-hidden="true">⚡</span> <span>{t("כל המשרד, בכף היד", "Your whole firm, in your pocket")}</span></span>
                <div className="bigphone" aria-hidden="true">
                  <div className="bigphone-screen">
                    <div className="phone-top"><strong>{t("תור משימות", "Task queue")}</strong><span className="pplus">+</span></div>
                    <div className="ptask"><strong>{t("דוח מע״מ — יוני", "VAT report — June")}</strong><small>{t("כהן אחזקות בע״מ", "Cohen Holdings Ltd")}</small><span className="ppill red">{t("דחוף", "Urgent")}</span></div>
                    <div className="ptask"><strong>{t("תלושי שכר — 12 עובדים", "Payslips — 12 employees")}</strong><small>{t("מסעדת הגפן", "Ha'Gefen Restaurant")}</small><span className="ppill blue">{t("עד 9 ביולי", "due Jul 9")}</span></div>
                    <div className="ptask"><strong>{t("דוח שנתי 2025", "Annual report 2025")}</strong><small>{t("י.מ. הנדסה בע״מ", "Y.M. Engineering Ltd")}</small><span className="ppill amber">{t("בתהליך", "In progress")}</span></div>
                    <div className="ptask pdone"><strong>{t("התאמות בנק — יוני", "Bank reconciliation — June")}</strong><small>{t("ר.נ ייעוץ", "R.N Consulting")}</small><span className="ppill green">{t("✓ הושלם", "✓ Done")}</span></div>
                    <div className="pnav">
                      <svg className="on" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></svg>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Screen 5 — login */}
            <div className="screen reveal">
              <div className="screen-cap">
                <span className="num">5</span>
                <h3>{t("מסך הכניסה", "The login screen")}</h3>
                <p>{t("גם הדלת למערכת מקבלת את העיצוב החדש — נקי, ברור ומזמין.", "The door to the system gets the new design too — clean, clear and welcoming.")}</p>
                <ul>
                  <li><Check /> {t("התחברות פשוטה עם מייל וסיסמה", "Simple login with email and password")}</li>
                  <li><Check /> {t("שחזור סיסמה עצמאי בלחיצה אחת", "Self-service password reset in one click")}</li>
                  <li><Check /> {t("עובדים שהוזמנו במייל נכנסים ישירות מכאן", "Invited employees log in right here")}</li>
                </ul>
              </div>
              <div className="screen-stage">
                <span className="stage-glow" aria-hidden="true" />
                <span className="stage-floor" aria-hidden="true" />
                <div className="glass-strong app-frame">
                  <div className="app-chrome"><span className="dot d1" /><span className="dot d2" /><span className="dot d3" /><span className="app-title">{t("AVI.APP — התחברות", "AVI.APP — Log in")}</span></div>
                  <div className="frame-body" style={{ display: "grid", placeItems: "center", padding: "2.4rem 1rem", minHeight: 320 }}>
                    <div className="glass" style={{ width: "min(320px,100%)", borderRadius: 18, padding: "1.5rem 1.4rem", textAlign: "center" }}>
                      <span className="logo-mark" style={{ marginInline: "auto" }}>א</span>
                      <h5 style={{ marginTop: ".85rem", fontSize: "1.08rem", fontWeight: 800 }}>{t("התחברות ל-AVI.APP", "Log in to AVI.APP")}</h5>
                      <span style={{ display: "block", color: "var(--ink-faint)", fontSize: ".86rem", marginTop: ".15rem" }}>{t("ברוכים השבים! הזינו את הפרטים שלכם.", "Welcome back! Enter your details.")}</span>
                      <div style={{ textAlign: "start", marginTop: ".95rem" }}>
                        <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--ink-soft)", marginBottom: ".35rem" }}>{t("אימייל", "Email")}</div>
                        <div style={{ background: "rgba(255,255,255,.88)", border: "1px solid var(--line)", borderRadius: 10, padding: ".62rem .8rem", fontSize: ".9rem", color: "var(--ink-faint)" }}>liran@office.co.il</div>
                      </div>
                      <div style={{ textAlign: "start", marginTop: ".95rem" }}>
                        <div style={{ display: "flex", fontSize: ".82rem", fontWeight: 700, color: "var(--ink-soft)", marginBottom: ".35rem" }}>{t("סיסמה", "Password")} <span style={{ marginInlineStart: "auto", color: "var(--accent-dark)", fontSize: ".78rem" }}>{t("שכחת סיסמה?", "Forgot password?")}</span></div>
                        <div style={{ background: "rgba(255,255,255,.88)", border: "1px solid var(--line)", borderRadius: 10, padding: ".62rem .8rem", fontSize: ".9rem", color: "var(--ink-faint)" }}>••••••••••</div>
                      </div>
                      <div style={{ marginTop: "1.15rem", borderRadius: 12, background: "var(--accent)", color: "#fff", fontWeight: 700, padding: ".72rem", fontSize: ".96rem" }}>{t("התחברות", "Log in")}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="section" id="how" style={{ paddingTop: "1.5rem" }}>
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow reveal"><span className="pin" /> {t("מתחילים בקלות", "Get started easily")}</span>
              <h2 className="sec-title reveal" style={d(".06s")}>{t("שלושה צעדים — והמשרד מסודר", "Three steps — and your firm is organised")}</h2>
            </div>
            <div className="steps">
              <article className="glass step reveal"><span className="n">1</span><h3>{t("פותחים חשבון", "Create an account")}</h3><p>{t("נרשמים בדקה, מאמתים את המייל, ופותחים את המשרד שלכם במערכת.", "Sign up in a minute, verify your email, and open your firm in the system.")}</p></article>
              <article className="glass step reveal" style={d(".1s")}><span className="n">2</span><h3>{t("מוסיפים לקוחות וצוות", "Add clients and team")}</h3><p>{t("מקימים את רשימת הלקוחות ומזמינים את העובדים במייל — כל אחד עם התפקיד שלו.", "Build your client list and invite employees by email — each with their role.")}</p></article>
              <article className="glass step reveal" style={d(".2s")}><span className="n">3</span><h3>{t("עובדים מסודר", "Work in order")}</h3><p>{t("כל משימה במקום שלה, כל עובד יודע מה עליו לעשות היום — והמנהל רואה הכול.", "Every task in its place, every employee knows what to do today — and the manager sees it all.")}</p></article>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow reveal"><span className="pin" /> {t("שאלות נפוצות", "FAQ")}</span>
              <h2 className="sec-title reveal" style={d(".06s")}>{t("שאלות ששואלים אותנו", "Questions we get asked")}</h2>
            </div>
            <div className="faq-list">
              <details className="glass faq-item reveal">
                <summary>{t("צריך להתקין משהו?", "Do I need to install anything?")}</summary>
                <p className="faq-a">{t("לא. AVI.APP עובדת בדפדפן — במחשב, בטאבלט ובנייד. נכנסים לכתובת, מתחברים, ועובדים.", "No. AVI.APP works in the browser — on desktop, tablet and mobile. Go to the address, log in, and work.")}</p>
              </details>
              <details className="glass faq-item reveal" style={d(".06s")} open>
                <summary>{t("המידע של הלקוחות שלי מאובטח?", "Is my clients' data secure?")}</summary>
                <p className="faq-a">
                  {t(
                    "כן, האבטחה בליבת המערכת. התשתית שעליה AVI.APP פועלת עומדת בתקני האבטחה והאיכות המחמירים בעולם — ",
                    "Yes, security is at the core. The infrastructure AVI.APP runs on meets the world's strictest security and quality standards — ",
                  )}
                  <b>SOC 2 Type II</b> {t("ו-", "and ")}<b>ISO/IEC 27001</b>
                  {t(
                    " — עם הצפנת נתונים מלאה בזמן ההעברה (TLS) ובאחסון (AES-256). בנוסף, ברמת המערכת עצמה: כל משרד מבודד לחלוטין מהאחרים, ההתחברות מאומתת בכתובת המייל, וכל עובד רואה אך ורק את מה שהתפקיד שלו מתיר.",
                    " — with full data encryption in transit (TLS) and at rest (AES-256). And at the system level: each firm is fully isolated from the others, login is verified by email address, and each employee sees only what their role permits.",
                  )}
                </p>
              </details>
              <details className="glass faq-item reveal" style={d(".12s")}>
                <summary>{t("אפשר לעבוד מהנייד?", "Can I work from mobile?")}</summary>
                <p className="faq-a">{t("כן. המערכת מותאמת למסכים קטנים, ואפשר גם להוסיף אותה למסך הבית בנייד — והיא תיפתח כמו אפליקציה לכל דבר.", "Yes. The system adapts to small screens, and you can add it to your phone's home screen — it opens like a full app.")}</p>
              </details>
              <details className="glass faq-item reveal" style={d(".18s")}>
                <summary>{t("איך מצרפים את הצוות?", "How do I add my team?")}</summary>
                <p className="faq-a">{t('ממסך "צוות" שולחים הזמנה במייל, בוחרים תפקיד — מנהל או עובד — והעובד מצטרף בלחיצה אחת על הקישור שקיבל.', 'From the "Team" screen, send an email invitation, choose a role — manager or employee — and they join with one click on the link.')}</p>
              </details>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="section" style={{ paddingTop: "1rem" }}>
          <div className="wrap">
            <div className="glass-strong cta-panel reveal">
              <h2>{t("מוכנים לעשות סדר במשרד?", "Ready to organise your firm?")}</h2>
              <p>{t("ללא התקנה · עובד בכל דפדפן · בעברית מלאה", "No installation · works in any browser · full Hebrew")}</p>
              <div className="hero-ctas" style={{ marginTop: "1.6rem" }}>
                <a className="btn btn-primary btn-lg" href={SIGNUP_URL}>{t("פתיחת חשבון", "Create account")}</a>
                <a className="btn btn-glass btn-lg" href={LOGIN_URL}>{t("כבר יש לי חשבון", "I already have an account")}</a>
              </div>
              <p className="cta-sub">{t("מתחילים בדקות · מזמינים את הצוות מתי שנוח לכם", "Start in minutes · invite your team whenever you like")}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <a className="brand" href="#top" style={{ fontSize: "1.05rem" }}><span className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9, fontSize: ".95rem" }}>א</span> AVI.APP</a>
          <span>{t("© 2026 · מערכת ניהול למשרדי רואי חשבון", "© 2026 · Management system for accounting firms")}</span>
          <nav className="foot-links" aria-label={t("קישורי תחתית", "Footer links")}>
            <a href={LOGIN_URL}>{t("התחברות", "Log in")}</a>
            <a href={SIGNUP_URL}>{t("הרשמה", "Sign up")}</a>
            <a href={FORGOT_URL}>{t("שחזור סיסמה", "Reset password")}</a>
            <a href="/privacy">{t("פרטיות", "Privacy")}</a>
            <a href="/terms">{t("תנאי שימוש", "Terms")}</a>
            <a href="/accessibility">{t("הצהרת נגישות", "Accessibility")}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LandingGlass() {
  return (
    <MarketingLangProvider>
      <LandingInner />
    </MarketingLangProvider>
  );
}
