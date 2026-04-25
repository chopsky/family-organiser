import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Privacy Policy page.
 * Content mirrors /web/public/privacy.html, re-styled to match the landing-page
 * design system (DM Sans, plum headings, cream background, tailwind tokens).
 */
export default function Privacy() {
  useEffect(() => {
    document.title = 'Privacy Policy — Housemait'
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="landing-page min-h-screen bg-cream font-sans antialiased text-charcoal">
      {/* ═══ Top bar ═══ */}
      <nav className="sticky top-0 z-50 glass border-b border-light-grey">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/housemait-logo2.png" alt="Housemait" className="h-7" />
          </Link>
          <Link
            to="/"
            className="text-sm font-medium text-warm-grey hover:text-plum transition-colors duration-200 inline-flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Back to home
          </Link>
        </div>
      </nav>

      {/* ═══ Content ═══ */}
      <main className="max-w-3xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <header className="pb-6 mb-8 border-b border-light-grey">
          <h1 className="text-3xl md:text-5xl font-bold text-charcoal mb-3 leading-tight">
            Privacy Policy
          </h1>
          <p className="text-sm text-warm-grey m-0"><strong className="font-semibold">Last updated:</strong> 15 April 2026</p>
          <p className="text-sm text-warm-grey m-0"><strong className="font-semibold">Effective date:</strong> 15 April 2026</p>
        </header>

        <div className="space-y-6 text-base leading-relaxed">
          <p>
            This Privacy Policy explains how <strong>Housemait</strong> (“we”, “us”, or “our”) collects,
            uses, and shares personal data when you use the Housemait mobile and web application (the “Service”).
            We are committed to protecting your family's privacy and handling personal data transparently.
          </p>

          <div className="bg-white border border-light-grey rounded-2xl p-5 md:p-6">
            <strong className="font-semibold">In short:</strong> Housemait helps households coordinate shopping,
            tasks, meals, calendars, and documents. We only collect the data we need to run the Service.
            We never sell your data or share it for advertising. We use reputable third-party services to
            deliver the Service — they process data strictly on our behalf.
          </div>

          <Section title="1. Who we are">
            <p>
              Housemait is operated by <strong>Grant Shapiro</strong> (sole trader), based at
              124 City Road, London, EC1V 2NX, United Kingdom. For the purposes of the UK General Data
              Protection Regulation (UK GDPR) and the EU GDPR, we are the <strong>data controller</strong>
              for personal data you provide to us.
            </p>
            <p>
              Contact for privacy enquiries:{' '}
              <a href="mailto:privacy@housemait.com" className="text-plum hover:underline">privacy@housemait.com</a>
            </p>
          </Section>

          <Section title="2. What data we collect">
            <SubHeading>2.1 Account &amp; profile data</SubHeading>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Name and email address</li>
              <li>Password (stored only as a hashed value using bcrypt — we never see or store your password in plain text)</li>
              <li>Apple ID or Google account identifier, if you choose to sign in with Apple or Google</li>
              <li>Profile photo or avatar (optional)</li>
              <li>Birthday, family role (e.g. “Mum”, “Son”), colour theme, and allergies (optional profile fields)</li>
              <li>Approximate location (latitude/longitude) and timezone, if you choose to enable location-based features such as weather</li>
            </ul>

            <SubHeading>2.2 Household data you create</SubHeading>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Household name and members (including any dependents you add)</li>
              <li>Shopping lists, tasks, to-do items and their completion status</li>
              <li>Calendar events (including those synced from Google Calendar, Apple Calendar/iCloud, or Microsoft 365 if you choose to connect them)</li>
              <li>Meal plans and recipes (including recipes you import by URL)</li>
              <li>Documents you upload (e.g. school letters, appointment slips)</li>
              <li>Notes and household preferences</li>
              <li>School and term dates you select for your children</li>
            </ul>

            <SubHeading>2.3 Communications data</SubHeading>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>WhatsApp phone number, if you link your WhatsApp account to the bot</li>
              <li>Messages you send to the Housemait WhatsApp bot (text, voice notes, and photos of receipts)</li>
              <li>Voice notes are transcribed for processing; receipt photos are analysed to extract shopping items</li>
              <li>Transactional emails you receive from us (e.g. verification, password reset, weekly digest)</li>
            </ul>

            <SubHeading>2.4 Technical data</SubHeading>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Authentication tokens (JWT access token, refresh token) stored on your device</li>
              <li>Push notification tokens (if you enable notifications on iOS)</li>
              <li>Approximate IP address and user-agent strings, logged transiently for security and abuse prevention</li>
              <li>Server and application logs (errors, request traces) for operating and debugging the Service</li>
            </ul>

            <SubHeading>2.5 Data we do <em>not</em> collect</SubHeading>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>We do <strong>not</strong> use advertising identifiers or tracking SDKs.</li>
              <li>We do <strong>not</strong> collect precise location in the background. Location is requested only when you ask for weather or set a location-based reminder.</li>
              <li>We do <strong>not</strong> sell personal data. We do <strong>not</strong> share data with advertisers or data brokers.</li>
            </ul>
          </Section>

          <Section title="3. How we use your data (and why)">
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white">
                    <th className="text-left font-semibold p-3 border-b border-light-grey">Purpose</th>
                    <th className="text-left font-semibold p-3 border-b border-light-grey">Legal basis (UK/EU GDPR)</th>
                  </tr>
                </thead>
                <tbody>
                  <Row c1="Provide the core Service — account management, lists, tasks, calendar, meals, reminders" c2="Performance of contract (Art. 6(1)(b))" />
                  <Row c1="Send transactional emails (verification, password reset, digest, reminders)" c2="Performance of contract (Art. 6(1)(b))" />
                  <Row c1="Send push notifications you have opted into" c2="Consent (Art. 6(1)(a)) — revocable in Settings" />
                  <Row c1="Process WhatsApp messages, voice notes, and receipt photos you send to the bot" c2="Performance of contract (Art. 6(1)(b))" />
                  <Row c1="Process data through AI providers to classify messages, extract tasks/shopping items, parse receipts, and answer questions" c2="Performance of contract (Art. 6(1)(b))" />
                  <Row c1="Keep the Service secure — rate limiting, abuse prevention, fraud detection" c2="Legitimate interests (Art. 6(1)(f)) — running a secure service" />
                  <Row c1="Diagnose errors and improve the Service" c2="Legitimate interests (Art. 6(1)(f))" />
                  <Row c1="Comply with legal obligations (e.g. respond to lawful requests, tax and accounting records)" c2="Legal obligation (Art. 6(1)(c))" />
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <Section title="4. How AI is used">
            <p>
              Housemait uses large-language-model AI providers to deliver several features — for example,
              classifying your WhatsApp messages into tasks or shopping items, answering chat questions,
              extracting items from receipt photos, and importing recipes from URLs. When these features
              are used, the relevant message text, photo, or document you submit is sent to our AI providers
              (see section 5).
            </p>
            <p>
              We do <strong>not</strong> use your household's personal data to train any third-party AI
              model. Our AI providers contractually commit not to train on data submitted via their API
              (see their enterprise/API terms).
            </p>
            <p>
              AI is not infallible. AI-generated responses may occasionally be inaccurate. You should
              verify important information before acting on it.
            </p>
          </Section>

          <Section title="5. Third-party processors">
            <p>
              We use the following service providers to operate the Service. They process personal data on
              our behalf under written agreements (Data Processing Agreements) and are bound to keep your
              data confidential:
            </p>
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white">
                    <th className="text-left font-semibold p-3 border-b border-light-grey">Provider</th>
                    <th className="text-left font-semibold p-3 border-b border-light-grey">Role</th>
                    <th className="text-left font-semibold p-3 border-b border-light-grey">Where</th>
                  </tr>
                </thead>
                <tbody>
                  <Row c1="Supabase" c2="Primary database, file storage, and authentication infrastructure" c3="EU / US" />
                  <Row c1="Vercel" c2="Hosting for the web application" c3="US / EU" />
                  <Row c1="Railway" c2="Hosting for the backend API server" c3="US" />
                  <Row c1="Amazon Web Services (S3)" c2="Object storage for uploaded documents and media" c3="EU / US" />
                  <Row c1="Google (Gemini)" c2="Primary AI model for message classification and chat" c3="US" />
                  <Row c1="Anthropic (Claude)" c2="Fallback AI model" c3="US" />
                  <Row c1="OpenAI (GPT-4o)" c2="Secondary fallback AI model" c3="US" />
                  <Row c1="Twilio" c2="WhatsApp message delivery and receiving" c3="US / EU" />
                  <Row c1="Postmark" c2="Transactional email delivery" c3="US / EU" />
                  <Row c1="Apple Push Notification service" c2="Delivering iOS push notifications" c3="Global" />
                  <Row c1="Apple Sign in with Apple" c2="Optional authentication provider" c3="Global" />
                  <Row c1="Google Sign-In & Google Calendar" c2="Optional authentication and calendar sync" c3="Global" />
                  <Row c1="Microsoft Graph (Microsoft 365)" c2="Optional calendar sync" c3="Global" />
                  <Row c1="Open-Meteo / equivalent weather API" c2="Weather data (requires only coarse lat/lon)" c3="EU" />
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <Section title="6. International data transfers">
            <p>
              Several of our processors (notably AI providers, Twilio, Vercel and Railway) are based in
              the United States. Where personal data is transferred outside the UK or European Economic
              Area, we rely on appropriate safeguards such as:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Standard Contractual Clauses approved by the UK Information Commissioner's Office and European Commission;</li>
              <li>UK Addendum to the EU Standard Contractual Clauses;</li>
              <li>EU-US Data Privacy Framework and UK Extension where the provider is self-certified.</li>
            </ul>
          </Section>

          <Section title="7. Children's data">
            <p>
              Housemait is designed for families and we take children's privacy seriously. Our
              handling of children's data is guided by the{' '}
              <a href="https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/" target="_blank" rel="noopener noreferrer" className="text-plum hover:underline">
                UK Age Appropriate Design Code (Children's Code)
              </a>{' '}
              published by the Information Commissioner's Office.
            </p>
            <p>
              Adults (aged 16 or over in the UK, or the age of digital consent in your jurisdiction)
              set up and manage the household account. An account holder (parent or legal guardian)
              may add minor children as <strong>dependents</strong> so they appear on the shared
              calendar, list assignments, and school term imports.
            </p>
            <p>
              Dependents do not have their own login and cannot directly interact with the Service.
              Information about a dependent (name, birthday, allergies, etc.) is provided by the
              account holder and is the account holder's responsibility. Data collected about
              dependents is kept to the minimum needed for the Service to function (no profiling,
              no targeted advertising, no commercial use). If you are a parent or guardian and you
              wish to review, change, or remove any information about a child dependent in a
              Housemait household, you can do so directly from{' '}
              <strong>Settings → Family Setup</strong>, or contact us at{' '}
              <a href="mailto:privacy@housemait.com" className="text-plum hover:underline">privacy@housemait.com</a>.
            </p>
            <p>
              We do not knowingly create independent login accounts for children under 16. If we
              learn that a child under 16 has created an independent account without parental
              consent, we will delete it.
            </p>
          </Section>

          <Section title="8. Data retention">
            <ul className="list-disc pl-6 space-y-1.5">
              <li><strong>Account data:</strong> retained while your account is active, plus up to 30 days after deletion for backup rollover.</li>
              <li><strong>Household data</strong> (lists, tasks, calendar, meal plans, documents): deleted with the household, or within 30 days after all members have left.</li>
              <li><strong>WhatsApp message logs:</strong> retained for up to 90 days for abuse prevention and debugging, then purged.</li>
              <li><strong>Application logs:</strong> retained for up to 30 days.</li>
              <li><strong>Authentication tokens:</strong> refresh tokens expire 7 days after last use; access tokens expire 1 hour after issue.</li>
              <li><strong>Financial / tax records (if any):</strong> retained as required by law (typically 6 years in the UK).</li>
            </ul>
          </Section>

          <Section title="9. Your rights">
            <p>Under the UK GDPR and EU GDPR you have the following rights:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Access</strong> — obtain a copy of the personal data we hold about you.
                Self-service in-app from <strong>Settings → Your data → Export my data</strong>,
                which downloads a machine-readable JSON file with every row we hold about you
                and your household.
              </li>
              <li>
                <strong>Rectification</strong> — ask us to correct inaccurate data. Self-service
                from <strong>Settings → Edit profile</strong> and <strong>Family Setup</strong>.
              </li>
              <li>
                <strong>Erasure</strong> (“right to be forgotten”) — ask us to delete your data.
                Self-service from <strong>Settings → Delete account</strong>. If you're the only
                member of your household, deleting your account also deletes the household and
                everything in it.
              </li>
              <li><strong>Restriction</strong> of processing in certain circumstances.</li>
              <li><strong>Objection</strong> to processing based on legitimate interests.</li>
              <li>
                <strong>Data portability</strong> — receive your data in a structured,
                machine-readable format. Same flow as Access above.
              </li>
              <li><strong>Withdraw consent</strong> at any time where consent is the legal basis (e.g. disabling push notifications in Settings).</li>
              <li>
                <strong>Lodge a complaint</strong> with a supervisory authority — in the UK, the{' '}
                <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-plum hover:underline">
                  Information Commissioner's Office (ICO)
                </a>.
              </li>
            </ul>
            <p>
              For anything the in-app self-service doesn't cover, email{' '}
              <a href="mailto:privacy@housemait.com" className="text-plum hover:underline">privacy@housemait.com</a>.
              We will respond within 30 days.
            </p>
          </Section>

          <Section title="10. Security">
            <ul className="list-disc pl-6 space-y-1.5">
              <li>All traffic between your device and our servers is encrypted using HTTPS/TLS.</li>
              <li>Passwords are hashed using bcrypt before storage.</li>
              <li>Sessions use short-lived access tokens (1 hour) and single-use rotating refresh tokens (7 days).</li>
              <li>Database access is secured with row-level security policies scoped to your household.</li>
              <li>We follow the principle of least privilege for internal access and regularly review our third-party processors.</li>
            </ul>
            <p>
              No system is perfectly secure. If you believe your account has been compromised, please
              contact us immediately at{' '}
              <a href="mailto:privacy@housemait.com" className="text-plum hover:underline">privacy@housemait.com</a>.
            </p>
          </Section>

          <Section title="11. Cookies & similar technologies">
            <p>
              The Housemait web app uses <code className="bg-white border border-light-grey rounded px-1.5 py-0.5 text-sm">localStorage</code>{' '}
              on your device to store your authentication token and user preferences. We do not use
              advertising or analytics cookies. The marketing website may use minimal first-party
              technical cookies necessary for the site to function.
            </p>
          </Section>

          <Section title="12. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. If we make material changes, we will
              notify you by email or in-app before the change takes effect. The “Last updated” date at
              the top of this page will always reflect the most recent version.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>Questions, requests, or complaints can be sent to:</p>
            <p>
              <strong>Housemait — Privacy</strong><br />
              Email: <a href="mailto:privacy@housemait.com" className="text-plum hover:underline">privacy@housemait.com</a><br />
              Address: Housemait, 124 City Road, London, EC1V 2NX, United Kingdom
            </p>
          </Section>
        </div>

        <footer className="mt-12 pt-6 border-t border-light-grey text-sm text-warm-grey">
          © {new Date().getFullYear()} Housemait. This policy is provided in plain English as a summary of how we handle your data.
        </footer>
      </main>
    </div>
  )
}

/* ─── Small composition helpers ─── */

function Section({ title, children }) {
  return (
    <section className="pt-4">
      <h2 className="text-xl md:text-2xl font-semibold text-plum mt-6 mb-3 leading-snug">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SubHeading({ children }) {
  return <h3 className="text-base font-semibold text-charcoal mt-5 mb-2">{children}</h3>
}

function TableWrap({ children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-light-grey bg-cream">
      {children}
    </div>
  )
}

function Row({ c1, c2, c3 }) {
  return (
    <tr>
      <td className="p-3 border-b border-light-grey align-top">{c1}</td>
      <td className="p-3 border-b border-light-grey align-top">{c2}</td>
      {c3 !== undefined && <td className="p-3 border-b border-light-grey align-top">{c3}</td>}
    </tr>
  )
}
