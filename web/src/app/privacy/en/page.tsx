import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — AVI.APP",
  description:
    "AVI.APP Privacy Policy — what information we collect, how we use it, the legal bases, your rights, and how we protect it.",
};

// Fixed (deterministic build — no Date.now()).
const LAST_UPDATED = "July 13, 2026";

export default function PrivacyEnPage() {
  return (
    <main dir="ltr" lang="en" className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14 text-left">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="text-sm text-primary hover:underline">
              ← Back to home
            </Link>
            <Link href="/privacy" className="text-sm text-primary hover:underline">
              עברית
            </Link>
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <article
          className="space-y-4 text-sm sm:text-base leading-relaxed
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground
            [&_p]:text-muted-foreground
            [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mt-1"
        >
          <p className="rounded-lg border border-border bg-card p-4 text-foreground">
            This Privacy Policy explains how AVI.APP (the &ldquo;<strong>Service</strong>,&rdquo;
            &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>&rdquo;) collects, uses,
            discloses, and protects information in connection with your use of the Service, whether
            through the web or our mobile application. The Service is an internal task-management
            platform for accounting firms and their staff. Please read it together with our{" "}
            <Link href="/terms/en" className="text-primary hover:underline">Terms of Service</Link>.{" "}
            This English version is a translation provided for convenience; the{" "}
            <Link href="/privacy" className="text-primary hover:underline">Hebrew version</Link>{" "}
            is the binding and governing version.
          </p>

          <section>
            <h2>1. Who we are</h2>
            <p>
              The Service is operated by <strong>[Legal entity name / licensed dealer + company
              (ח.פ.) or dealer number]</strong> (&ldquo;<strong>we</strong>&rdquo;), of{" "}
              <strong>[full address]</strong>. For any privacy question or to exercise your rights,
              contact us at <strong>[contact email, e.g. privacy@aviapp1.com]</strong>.
            </p>
          </section>

          <section>
            <h2>2. Controller and Processor roles</h2>
            <p>
              For information about your own account and staff, we act as the data{" "}
              <strong>controller</strong>. For the records that your firm enters about{" "}
              <strong>its own clients</strong> (for example client details and business/financial
              information), your firm is the <strong>controller</strong> and we act only as a{" "}
              <strong>processor</strong> that stores and processes that data on your instructions
              and on your behalf. Your firm is solely responsible for having a lawful basis to
              process its clients&rsquo; data, for providing any required notices, and for its own
              compliance with applicable law.
            </p>
          </section>

          <section>
            <h2>3. Information we collect</h2>
            <ul>
              <li>
                <strong>Account information:</strong> full name, email address, phone number, and
                organizational role, provided at sign-up or invitation.
              </li>
              <li>
                <strong>Organizational and operational data:</strong> your firm&rsquo;s data,
                tasks, schedules, and the client records you manage in the Service.
              </li>
              <li>
                <strong>Communications:</strong> the content of internal team chat messages you
                send through the Service, and support/bug reports you submit.
              </li>
              <li>
                <strong>Technical and usage data:</strong> IP address, browser/device type, and
                basic usage and diagnostic information used for security and operation.
              </li>
              <li>
                <strong>Mobile application:</strong> if you enable notifications, we store a device
                token to deliver push notifications. We do <strong>not</strong> collect location.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. How we use information, and legal bases</h2>
            <p>We process information to:</p>
            <ul>
              <li>provide, operate, secure, and maintain the Service (performance of a contract);</li>
              <li>authenticate users, manage permissions, and enforce tenant separation (legitimate interests and security);</li>
              <li>send operational messages and the notifications you request (performance of a contract / consent);</li>
              <li>improve the Service, prevent abuse, and diagnose problems (legitimate interests);</li>
              <li>comply with legal obligations.</li>
            </ul>
            <p>
              We do not sell personal information and do not use it for third-party advertising.
            </p>
          </section>

          <section>
            <h2>5. Service providers and sub-processors</h2>
            <p>
              We rely on service providers that process data on our behalf under appropriate
              confidentiality and security commitments, including:
            </p>
            <ul>
              <li><strong>Supabase</strong> — database, authentication, and storage.</li>
              <li><strong>Vercel</strong> — application hosting and delivery.</li>
              <li><strong>Resend</strong> — transactional email delivery.</li>
              <li><strong>Google</strong> — optional sign-in via a Google account.</li>
              <li><strong>Apple / Google</strong> — delivery of push notifications to the mobile app.</li>
            </ul>
            <p>
              We disclose information to other parties only where required by law, to protect our
              rights, in connection with a corporate transaction, or with your consent.
            </p>
          </section>

          <section>
            <h2>6. International transfers</h2>
            <p>
              Data is hosted on secure cloud infrastructure located in the European Union. Where
              data is transferred across borders, we rely on appropriate safeguards as required by
              applicable law.
            </p>
          </section>

          <section>
            <h2>7. Security</h2>
            <p>
              We apply commercially reasonable technical and organizational measures, including
              encryption in transit (HTTPS), access controls, and strict database-level separation
              between organizations. No method of transmission or storage is completely secure, and
              we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2>8. Data retention</h2>
            <p>
              We retain information for as long as your account is active and as needed to provide
              the Service and meet legal obligations. Following account closure, data is deleted or
              anonymized within a reasonable period, except where retention is required by law.
            </p>
          </section>

          <section>
            <h2>9. Your rights</h2>
            <p>
              Under Israel&rsquo;s Protection of Privacy Law, 5741-1981 (and, where applicable,
              other data-protection laws such as the GDPR), you may have the right to access,
              rectify, and request deletion of your personal data, and to object to or restrict
              certain processing. To exercise these rights, contact us at the address in Section 1.
              Where we act as a processor for your firm&rsquo;s client data, please direct such
              requests to your firm (the controller). You may also lodge a complaint with the
              Israeli Privacy Protection Authority.
            </p>
          </section>

          <section>
            <h2>10. Cookies</h2>
            <p>
              We use strictly necessary cookies to keep you signed in and to operate the Service.
              We do not use advertising or cross-site tracking cookies.
            </p>
          </section>

          <section>
            <h2>11. Push notifications</h2>
            <p>
              In the mobile app you may enable push notifications, delivered via Apple/Google using
              a device token. You can disable them at any time from your device settings or the
              Service&rsquo;s notification settings.
            </p>
          </section>

          <section>
            <h2>12. Children</h2>
            <p>
              The Service is a business tool intended for use by professionals and is not directed
              to children. We do not knowingly collect personal data from children.
            </p>
          </section>

          <section>
            <h2>13. Changes to this policy</h2>
            <p>
              We may update this Policy from time to time; the &ldquo;Last updated&rdquo; date
              above reflects the latest version. Material changes will be communicated through the
              Service.
            </p>
          </section>

          <section>
            <h2>14. Contact</h2>
            <p>
              For any question about this Policy or your data, contact us at{" "}
              <strong>[contact email]</strong>.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
