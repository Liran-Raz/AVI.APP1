import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibility Statement — AVI.APP",
  description:
    "AVI.APP Accessibility Statement — our commitment to making the Service accessible to people with disabilities, the standard we follow (IS 5568 / WCAG 2.0 AA), what we have implemented, known limitations, and how to reach us.",
};

// Fixed (deterministic build — no Date.now()). Also the last review date of the
// accessibility arrangements.
const LAST_UPDATED = "July 18, 2026";

export default function AccessibilityEnPage() {
  return (
    <main dir="ltr" lang="en" className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14 text-left">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="text-sm text-primary hover:underline">
              ← Back to home
            </Link>
            <Link href="/accessibility" className="text-sm text-primary hover:underline">
              עברית
            </Link>
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold">Accessibility Statement</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <article
          className="space-y-4 text-sm sm:text-base leading-relaxed
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground
            [&_p]:text-muted-foreground
            [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mt-1"
        >
          <p className="rounded-lg border border-border bg-card p-4 text-foreground">
            This Accessibility Statement describes AVI.APP&rsquo;s (the &ldquo;<strong>Service</strong>,&rdquo;
            &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>&rdquo;) commitment to making the
            Service accessible to people with disabilities, and the accessibility status of the website and
            mobile application as of the date above. We treat accessibility as a value and an ongoing process,
            and work to improve it continuously. This English version is a translation provided for
            convenience; the{" "}
            <Link href="/accessibility" className="text-primary hover:underline">Hebrew version</Link>{" "}
            is the binding and governing version.
          </p>

          <section>
            <h2>1. Our accessibility commitment</h2>
            <p>
              We are committed to enabling all users, including people with disabilities, to use the Service
              independently, with dignity, and with ease. We invest resources in making the Service accessible
              and in improving it continuously, in the belief that every person deserves an equal right to
              receive service. The Service is operated by{" "}
              <strong>Liran Raz, licensed dealer (עוסק מורשה) no. 314954835</strong>.
            </p>
          </section>

          <section>
            <h2>2. The standard we follow</h2>
            <p>
              The website is built and maintained in accordance with <strong>Israeli Standard IS 5568</strong>{" "}
              for web content accessibility, which is anchored to the <strong>WCAG 2.0</strong> guidelines at
              level <strong>AA</strong>, and in accordance with the Equal Rights for Persons with Disabilities
              (Service Accessibility Accommodations) Regulations, 2013. Our accessibility target is
              conformance at level AA, and we work to close any gap that is identified.
            </p>
          </section>

          <section>
            <h2>3. What we have implemented</h2>
            <p>Among the accessibility measures currently in place in the Service:</p>
            <ul>
              <li>semantic page structure with landmarks and a single main heading per page;</li>
              <li>full keyboard operation, with a visible focus indicator on every interactive element;</li>
              <li>a &ldquo;skip to content&rdquo; link at the top of the home page;</li>
              <li>respect for the user&rsquo;s reduced-motion preference (prefers-reduced-motion);</li>
              <li>labels associated with form fields;</li>
              <li>declared language (Hebrew) and right-to-left (RTL) writing direction;</li>
              <li>a bilingual Hebrew/English interface.</li>
            </ul>
          </section>

          <section>
            <h2>4. Known limitations</h2>
            <p>
              We continue to improve the Service&rsquo;s accessibility. As of this date, we are aware of the
              following limitations and are working to address them:
            </p>
            <ul>
              <li>some decorative display elements on the home page (visual demonstrations) may be read by screen readers;</li>
              <li>color-contrast improvements to some secondary text and status tags;</li>
              <li>associating form error messages with the relevant field and announcing them to screen readers.</li>
            </ul>
            <p>
              If you encounter an accessibility barrier not listed here, we would be glad to hear from you —
              see &ldquo;How to reach us&rdquo; below. We will handle your request and work to fix the issue
              within a reasonable time.
            </p>
          </section>

          <section>
            <h2>5. How to reach us — accessibility coordinator</h2>
            <p>
              Encountered an accessibility problem, or have a suggestion for improvement? We would be glad to
              hear from you. You can contact our accessibility coordinator:
            </p>
            <ul>
              <li><strong>Name:</strong> Liran Raz</li>
              <li>
                <strong>Email:</strong>{" "}
                <a href="mailto:liran995@gmail.com" className="text-primary hover:underline">
                  liran995@gmail.com
                </a>
              </li>
              <li>
                <strong>Phone:</strong>{" "}
                <a href="tel:+972508880981" className="text-primary hover:underline">
                  +972-50-8880981
                </a>
              </li>
            </ul>
            <p>
              In your message, please describe what you encountered and on which page, so we can locate and
              fix the issue quickly.
            </p>
          </section>

          <section>
            <h2>6. Digital service only</h2>
            <p>
              The Service is provided online only and has no physical branch or service center open to the
              public; accordingly, our accessibility arrangements focus on making the website and application
              accessible.
            </p>
          </section>

          <section>
            <h2>7. Review date</h2>
            <p>
              The Service&rsquo;s accessibility arrangements were last reviewed and updated on{" "}
              <strong>{LAST_UPDATED}</strong>. This statement will be updated from time to time as
              improvements and further reviews are made.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
