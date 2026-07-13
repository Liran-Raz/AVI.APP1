import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — AVI.APP",
  description:
    "The Terms of Service that govern your access to and use of AVI.APP, including disclaimers, limitation of liability, and your responsibilities.",
};

// Fixed (deterministic build — no Date.now()).
const LAST_UPDATED = "July 13, 2026";

export default function TermsEnPage() {
  return (
    <main dir="ltr" lang="en" className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14 text-left">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="text-sm text-primary hover:underline">
              ← Back to home
            </Link>
            <Link href="/terms" className="text-sm text-primary hover:underline">
              עברית
            </Link>
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <article
          className="space-y-4 text-sm sm:text-base leading-relaxed
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground
            [&_p]:text-muted-foreground
            [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mt-1"
        >
          <p className="rounded-lg border border-border bg-card p-4 text-foreground">
            These Terms of Service (the &ldquo;<strong>Terms</strong>&rdquo;) form a binding
            agreement between you and <strong>[Legal entity name / licensed dealer + company (ח.פ.)
            or dealer number]</strong> (&ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo;
            &ldquo;<strong>AVI.APP</strong>&rdquo;) and govern your access to and use of the AVI.APP
            service, website, and mobile application (together, the &ldquo;<strong>Service</strong>&rdquo;).
            By accessing or using the Service, you agree to these Terms and to our{" "}
            <Link href="/privacy/en" className="text-primary hover:underline">Privacy Policy</Link>. If
            you do not agree, do not use the Service. Please read Sections&nbsp;9–12 carefully — they
            limit our liability and allocate risk to you. This English version is a translation
            provided for convenience; the{" "}
            <Link href="/terms" className="text-primary hover:underline">Hebrew version</Link>{" "}
            is the binding and governing version.
          </p>

          <section>
            <h2>1. Eligibility and acceptance</h2>
            <p>
              You may use the Service only if you can form a binding contract and are permitted to do
              so under applicable law. If you use the Service on behalf of an organization, you
              represent that you are authorized to bind that organization to these Terms, and
              &ldquo;you&rdquo; refers to both you and that organization. You must be at least 18
              years old.
            </p>
          </section>

          <section>
            <h2>2. The Service</h2>
            <p>
              AVI.APP is an internal task-management platform for accounting firms and their staff,
              providing task queues, scheduling, client-record management, and team chat, delivered
              through the web and a mobile application. We may add, change, or remove features at any
              time. The Service is provided for your internal business use only.
            </p>
          </section>

          <section>
            <h2>3. Accounts and security</h2>
            <ul>
              <li>You are responsible for maintaining the confidentiality of your credentials and for all activity under your account.</li>
              <li>You must provide accurate information and keep it current, and promptly notify us of any unauthorized use or security breach.</li>
              <li>You are responsible for your users&rsquo; compliance with these Terms and for all activity within your organization&rsquo;s workspace.</li>
            </ul>
          </section>

          <section>
            <h2>4. Your content and responsibilities</h2>
            <p>
              You retain all rights to the data, records, and content you or your users submit to the
              Service (&ldquo;<strong>Your Content</strong>&rdquo;). You grant us a limited,
              worldwide, non-exclusive license to host, store, process, transmit, and display Your
              Content solely to provide, secure, and maintain the Service. You represent and warrant
              that:
            </p>
            <ul>
              <li>you own or have all rights, consents, and lawful bases necessary to submit Your Content and to authorize our processing of it, including any personal data of your own clients;</li>
              <li>Your Content, and our permitted use of it, do not violate any law or infringe or misappropriate any third-party right;</li>
              <li>you are solely responsible for the accuracy, quality, legality, and appropriateness of Your Content and for the manner in which you acquired it.</li>
            </ul>
            <p>
              You are solely responsible for maintaining independent backups of Your Content. To the
              maximum extent permitted by law, we are not responsible for any loss, corruption, or
              unavailability of Your Content.
            </p>
          </section>

          <section>
            <h2>5. Acceptable use</h2>
            <p>You agree not to, and not to permit any third party to:</p>
            <ul>
              <li>use the Service in violation of any law or third-party right;</li>
              <li>attempt to gain unauthorized access to, probe, scan, disrupt, overload, or interfere with the Service or its infrastructure;</li>
              <li>copy, modify, translate, reverse-engineer, decompile, disassemble, or create derivative works of the Service, except to the extent this restriction is prohibited by law;</li>
              <li>resell, sublicense, rent, lease, or provide the Service to third parties as a service bureau;</li>
              <li>upload malware or unlawful, infringing, or harmful content, or use the Service to send unsolicited communications;</li>
              <li>use the Service to build a competing product, or to benchmark it without our prior written consent.</li>
            </ul>
          </section>

          <section>
            <h2>6. Intellectual property; feedback</h2>
            <p>
              The Service, including all software, code, design, text, graphics, and trademarks, is
              owned by us or our licensors and is protected by intellectual-property laws. We grant
              you a limited, personal, non-exclusive, non-transferable, revocable license to use the
              Service for its intended purpose during the term. No rights are granted except as
              expressly stated. If you provide feedback or suggestions, you grant us a perpetual,
              irrevocable, royalty-free license to use them without restriction or obligation to you.
            </p>
          </section>

          <section>
            <h2>7. Third-party services</h2>
            <p>
              The Service relies on third-party providers (including hosting, database, email, and
              notification providers) and may interoperate with third-party products. We do not
              control and are not responsible for third-party services, and your use of them may be
              subject to their own terms. We are not liable for any act, omission, outage, or breach
              of any third party.
            </p>
          </section>

          <section>
            <h2>8. No professional advice</h2>
            <p>
              The Service is a software tool only. It does <strong>not</strong> provide, and must not
              be relied upon as, accounting, tax, auditing, legal, financial, or other professional
              advice. You are solely responsible for your professional judgment, for verifying all
              data and outputs, and for meeting your own professional, regulatory, and legal
              obligations to your clients and to any authority. Any reliance you place on the Service
              is at your own risk.
            </p>
          </section>

          <section>
            <h2>9. Disclaimer of warranties</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND
              &ldquo;AS AVAILABLE,&rdquo; WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND. WE DISCLAIM
              ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING ANY IMPLIED WARRANTIES
              OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY, AND
              NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY,
              SECURE, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS, OR THAT ANY DATA WILL BE ACCURATE OR
              PRESERVED. NO ADVICE OR INFORMATION OBTAINED FROM US CREATES ANY WARRANTY NOT EXPRESSLY
              STATED HERE.
            </p>
          </section>

          <section>
            <h2>10. Limitation of liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE (AND OUR OFFICERS, EMPLOYEES, AND SUPPLIERS)
              WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR
              PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, GOODWILL, BUSINESS, OR DATA,
              ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS, WHETHER IN CONTRACT, TORT, OR
              ANY OTHER THEORY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
            </p>
            <p>
              OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE
              OR THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU ACTUALLY PAID US FOR
              THE SERVICE IN THE THREE (3) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE
              CLAIM, OR (B) ILS 1,000. THESE LIMITATIONS APPLY EVEN IF A REMEDY FAILS OF ITS ESSENTIAL
              PURPOSE. NOTHING IN THESE TERMS EXCLUDES OR LIMITS LIABILITY THAT CANNOT BE EXCLUDED OR
              LIMITED UNDER APPLICABLE LAW.
            </p>
          </section>

          <section>
            <h2>11. Indemnification</h2>
            <p>
              You will defend, indemnify, and hold us harmless from and against any claims, damages,
              liabilities, losses, costs, and expenses (including reasonable legal fees) arising out
              of or related to: (a)&nbsp;Your Content; (b)&nbsp;your use of the Service; (c)&nbsp;your
              violation of these Terms or of any law; or (d)&nbsp;any claim by your clients or any
              third party relating to your use of the Service or to Your Content.
            </p>
          </section>

          <section>
            <h2>12. Availability, changes, suspension, and termination</h2>
            <ul>
              <li>We may modify, suspend, or discontinue the Service (in whole or in part) at any time, and we are not liable for any resulting unavailability.</li>
              <li>We may suspend or terminate your access immediately if you breach these Terms, create risk or legal exposure for us, or fail to pay applicable fees.</li>
              <li>You may stop using the Service at any time.</li>
              <li>Upon termination, your license ends and we may delete Your Content after a reasonable period, except where retention is required by law. Sections that by their nature should survive (including Sections&nbsp;4, 6, and 8–14) survive termination.</li>
            </ul>
          </section>

          <section>
            <h2>13. Fees</h2>
            <p>
              Where the Service or any part of it is offered for a fee, you agree to pay all
              applicable charges. Fees are non-refundable except as required by law. We may change
              pricing on prospective notice.
            </p>
          </section>

          <section>
            <h2>14. Force majeure</h2>
            <p>
              We are not liable for any delay or failure to perform caused by events beyond our
              reasonable control, including acts of God, war, terrorism, civil unrest, labor disputes,
              governmental action, internet or utility failures, or failures of third-party providers.
            </p>
          </section>

          <section>
            <h2>15. Governing law and jurisdiction</h2>
            <p>
              These Terms are governed by the laws of the State of Israel, without regard to conflict-
              of-law rules. The competent courts located in the district of{" "}
              <strong>[district, e.g. Tel Aviv]</strong>, Israel, will have exclusive jurisdiction
              over any dispute arising out of or relating to these Terms or the Service, and you
              consent to their jurisdiction and venue.
            </p>
          </section>

          <section>
            <h2>16. General</h2>
            <ul>
              <li><strong>Entire agreement.</strong> These Terms and the Privacy Policy are the entire agreement between you and us regarding the Service and supersede all prior understandings.</li>
              <li><strong>Severability.</strong> If any provision is held unenforceable, the remaining provisions remain in full effect, and the unenforceable provision will be enforced to the maximum extent permitted.</li>
              <li><strong>No waiver.</strong> Our failure to enforce any right or provision is not a waiver of it.</li>
              <li><strong>Assignment.</strong> You may not assign these Terms without our prior written consent; we may assign them in connection with a merger, acquisition, or sale of assets.</li>
              <li><strong>Notices.</strong> We may provide notices through the Service or by email.</li>
            </ul>
          </section>

          <section>
            <h2>17. Changes to these Terms</h2>
            <p>
              We may update these Terms from time to time; the &ldquo;Last updated&rdquo; date above
              reflects the latest version. Material changes will be communicated through the Service,
              and your continued use after they take effect constitutes acceptance.
            </p>
          </section>

          <section>
            <h2>18. Contact</h2>
            <p>
              Questions about these Terms: <strong>[contact email]</strong>. See also our{" "}
              <Link href="/privacy/en" className="text-primary hover:underline">Privacy Policy</Link>.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
