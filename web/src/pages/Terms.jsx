import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Terms of Service page.
 *
 * Scaffold based on standard UK SaaS terms (English & Welsh law, ICO-
 * aligned language, UK-resident friendly). Has not been reviewed by a
 * solicitor — the banner at the top says so. Content here is a starting
 * point; any production use should be run past a tech solicitor (roughly
 * one-hour review, ~£300-500) to tune the liability caps, dispute-
 * resolution wording, and any jurisdiction specifics before relying on it.
 *
 * Paired with the existing Privacy Policy (/privacy) — the two documents
 * reference each other.
 */
export default function Terms() {
  useEffect(() => {
    document.title = 'Terms of Service — Housemait'
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
            Terms of Service
          </h1>
          <p className="text-sm text-warm-grey m-0"><strong className="font-semibold">Last updated:</strong> 25 April 2026</p>
          <p className="text-sm text-warm-grey m-0"><strong className="font-semibold">Effective date:</strong> 25 April 2026</p>
        </header>

        <div className="space-y-6 text-base leading-relaxed">
          <p>
            These Terms of Service (“Terms”) govern your access to and use of{' '}
            <strong>Housemait</strong> (the “Service”), operated by Housemait (“we”, “us”, “our”).
            By creating a Housemait account or using the Service you agree to these Terms and the{' '}
            <Link to="/privacy" className="text-plum hover:underline">Privacy Policy</Link>.
            If you do not agree, please don't use the Service.
          </p>

          <div className="bg-white border border-light-grey rounded-2xl p-5 md:p-6">
            <strong className="font-semibold">In short:</strong> Housemait is a family organiser. You
            use it at your own responsibility, we try to keep it working and safe, but we can't
            guarantee perfection. If you break the rules or abuse the Service we can close your
            account. These Terms are governed by the law of England and Wales.
          </div>

          <Section title="1. Who can use Housemait">
            <ul className="list-disc pl-6 space-y-1.5">
              <li>You must be at least <strong>16 years old</strong> to create an account and agree to these Terms (see Section 5 for children added as household dependents).</li>
              <li>You must provide accurate information when signing up and keep it up to date.</li>
              <li>You are responsible for keeping your account credentials secure. Don't share your password. Tell us if you suspect someone else has accessed your account.</li>
              <li>One person per account. Don't share your login with anyone — create separate accounts for each family member.</li>
            </ul>
          </Section>

          <Section title="2. Your household">
            <p>
              When you create a household in Housemait, you become the initial <strong>admin</strong>.
              As admin you can invite other members, promote them to admin, remove members, and
              delete the household.
            </p>
            <p>
              Data added to a household — tasks, lists, events, notes, documents, meal plans — is
              shared with all members of that household. By inviting someone, you're giving them
              access to everything already in the household. By joining a household, you're
              acknowledging that other members can see what you add.
            </p>
          </Section>

          <Section title="3. Acceptable use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Use the Service to store or share content that's unlawful, harassing, hateful, threatening, defamatory, obscene, or that infringes anyone else's rights.</li>
              <li>Upload malware, viruses, or anything designed to disrupt the Service or other users' devices.</li>
              <li>Attempt to reverse engineer, probe, or circumvent the Service's security.</li>
              <li>Scrape, crawl, or use automated tools against the Service without our written permission.</li>
              <li>Resell, sublicense, or commercially redistribute the Service.</li>
              <li>Use the Service to send spam, phishing messages, or any unsolicited bulk communications — including via the WhatsApp integration.</li>
              <li>Impersonate another person or misrepresent your relationship to them.</li>
              <li>Abuse the AI features (receipt scanner, classifier, chat) to generate harmful, illegal, or deceptive content.</li>
            </ul>
            <p>
              We may suspend or terminate accounts that breach this section without notice.
              Depending on the breach we may also report it to the relevant authorities.
            </p>
          </Section>

          <Section title="4. Content you provide">
            <p>
              You own the content you put into Housemait — your shopping lists, your tasks, your
              photos, your documents. By uploading or entering content, you grant us a limited
              licence to store, process, and display it back to you and the other members of your
              household, purely so the Service can work. We don't use your content to train AI
              models or for advertising.
            </p>
            <p>
              You're responsible for having the right to share whatever content you upload. If you
              upload something that infringes someone else's rights and they let us know, we may
              remove it.
            </p>
          </Section>

          <Section title="5. Children added as dependents">
            <p>
              The Housemait <strong>dependents</strong> feature lets a parent or legal guardian
              add minor children to their household so they appear on the shared calendar, lists,
              and school imports. Dependents <strong>do not</strong> have their own login and
              cannot directly interact with the Service.
            </p>
            <p>
              By adding a child as a dependent you confirm that you are their parent or legal
              guardian and that you have authority to provide the information you're adding about
              them. See our{' '}
              <Link to="/privacy" className="text-plum hover:underline">Privacy Policy</Link>{' '}
              for details on how we handle data about children under the UK Age Appropriate Design
              Code.
            </p>
          </Section>

          <Section title="6. Third-party integrations">
            <p>
              Housemait integrates with third-party services including Apple, Google, and
              Microsoft calendar sync, WhatsApp (via Twilio), push notifications (Apple Push
              Notification service), and AI providers. When you enable an integration you're also
              agreeing to that provider's own terms. We're not responsible for outages, bugs, or
              policy changes on those platforms — though we'll do our best to work around them.
            </p>
            <p>
              Your use of the WhatsApp integration is also subject to{' '}
              <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer" className="text-plum hover:underline">
                WhatsApp's Business Policy
              </a>.
            </p>
          </Section>

          <Section title="7. Pricing, billing, and refunds">
            <p>
              New accounts get a <strong>30-day free trial</strong> with full access to every
              feature. No card details are required to start the trial. Towards the end of the
              trial we'll prompt you to choose a paid plan if you want to keep using the Service.
            </p>
            <p>
              Current plans (UK pricing, VAT included where applicable):
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li><strong>Monthly</strong> — £5.99 / month, billed monthly.</li>
              <li><strong>Annual</strong> — £59.99 / year, billed annually (works out at roughly £5 / month — about 2 months free vs. monthly billing).</li>
            </ul>
            <p>
              Both plans include the same features — there are no feature gates between tiers. You
              can view the current pricing at any time on the{' '}
              <strong>Settings → Plan</strong> screen or on our website. Payments are processed by{' '}
              <strong>Stripe</strong>; we don't see or store your card details.
            </p>
            <p>
              Subscriptions <strong>renew automatically</strong> at the end of each billing period
              using your saved payment method. You can cancel at any time from{' '}
              <strong>Settings → Plan → Manage subscription</strong> (which opens the Stripe
              Customer Portal). When you cancel, you keep access until the end of the period
              you've already paid for, and no further charges will be taken.
            </p>
            <p>
              Because the iOS App Store does not currently allow in-app purchases for Housemait
              subscriptions, iOS users complete and manage their subscription on the{' '}
              <a href="https://housemait.com" target="_blank" rel="noopener noreferrer" className="text-plum hover:underline">housemait.com</a>{' '}
              web app. The same account works across web and iOS.
            </p>
            <p>
              <strong>Refunds.</strong> Subscription fees are generally non-refundable for partial
              periods — when you cancel you keep access for the time you've paid for, but we
              don't pro-rata earlier in the cycle. Your statutory rights as a UK consumer
              (including the 14-day right to cancel a new subscription under the Consumer
              Contracts Regulations 2013, where it applies) are not affected. To request a
              refund or raise a billing issue, email{' '}
              <a href="mailto:hello@housemait.com" className="text-plum hover:underline">hello@housemait.com</a>.
            </p>
            <p>
              <strong>Pricing changes.</strong> If we change the price of an existing plan, we'll
              give you at least <strong>30 days' email notice</strong> before the new price applies
              to your next renewal. You can cancel before the change takes effect if you don't
              want to continue at the new price.
            </p>
          </Section>

          <Section title="8. Availability and changes">
            <p>
              We aim for the Service to be available at all times, but we can't guarantee it.
              The Service may occasionally be unavailable for maintenance, updates, or due to
              issues with third-party providers. We may add, change, or remove features from time
              to time. Material changes will be communicated in-app or by email where relevant.
            </p>
          </Section>

          <Section title="9. Your responsibility for household members">
            <p>
              If you invite other people to your household, you're responsible for ensuring they
              agree to these Terms before using the Service. You should also make them aware of
              the{' '}
              <Link to="/privacy" className="text-plum hover:underline">Privacy Policy</Link>{' '}
              before they sign in for the first time.
            </p>
          </Section>

          <Section title="10. Data retention">
            <p>
              If you cancel your subscription or your free trial ends without subscribing, we'll
              keep your household's data for <strong>12 months</strong> so you can pick up where
              you left off if you resubscribe. During that window you can still log in to view
              your data in read-only mode and export it at any time.
            </p>
            <p>
              After 12 months of inactivity, we permanently delete your household and everything
              in it. We'll email you <strong>30 days before deletion</strong> with a clear warning
              and your options (resubscribe or export).
            </p>
            <p>
              You can delete your account and data at any time from{' '}
              <strong>Settings → Delete account</strong>. See the{' '}
              <Link to="/privacy" className="text-plum hover:underline">Privacy Policy</Link>{' '}
              for the full retention schedule and your rights under UK data protection law.
            </p>
          </Section>

          <Section title="11. Account deletion">
            <p>
              You can permanently delete your Housemait account at any time from{' '}
              <strong>Settings → Delete account</strong>.
            </p>
            <p>When you delete your account:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                If you are the <strong>only member</strong> of your household, the entire
                household is deleted — shopping lists, calendars, meals, tasks, family profiles,
                documents, chat history — all of it.
              </li>
              <li>
                If <strong>other members remain</strong>, only your user record is removed. Your
                name is blanked from shared items but the items themselves stay with the
                household. If you were the only admin, another member is automatically promoted.
              </li>
              <li>
                Any <strong>active Stripe subscription</strong> is cancelled immediately as part
                of the deletion. No further charges will be taken.
              </li>
              <li>
                A <strong>minimal audit record</strong> is kept (user ID, email, deletion date,
                IP address, Stripe status) for 6 years to support fraud prevention and dispute
                resolution, as permitted by UK GDPR Article 17(3).
              </li>
            </ul>
            <p>
              Deletion is <strong>permanent and cannot be undone</strong>. If you want a copy of
              your data before deleting, use{' '}
              <strong>Settings → Your data → Export my data</strong> first.
            </p>
            <p>
              We may also suspend or terminate your account if you materially breach these Terms,
              if we're required to by law, or if your account is inactive beyond the retention
              window described in Section 10.
            </p>
          </Section>

          <Section title="12. Disclaimers">
            <p>
              Housemait is a <strong>personal organiser tool</strong> — not medical, legal,
              financial, or emergency advice. The AI features (classifier, receipt matcher, chat
              assistant) can and do make mistakes. Always sanity-check anything the Service does
              on your behalf, especially around schedules, allergies, medications, financial
              details, and anything time-sensitive.
            </p>
            <p>
              To the maximum extent permitted by law, the Service is provided <strong>“as is”</strong>{' '}
              and <strong>“as available”</strong>, without warranties of any kind, express or
              implied — including fitness for a particular purpose, merchantability,
              non-infringement, and accuracy of AI-generated content.
            </p>
          </Section>

          <Section title="13. Limitation of liability">
            <p>
              To the maximum extent permitted by law, our total liability to you in connection
              with the Service, whether in contract, tort, or otherwise, is limited to the
              greater of (a) the total fees you've paid to us in the 12 months preceding the
              claim, or (b) £100.
            </p>
            <p>
              We're not liable for indirect, incidental, consequential, or special damages —
              including lost data, lost profits, missed appointments, or any harm arising from
              reliance on AI output.
            </p>
            <p>
              Nothing in these Terms limits our liability for (i) death or personal injury caused
              by our negligence, (ii) fraud or fraudulent misrepresentation, or (iii) any other
              liability that cannot lawfully be limited.
            </p>
          </Section>

          <Section title="14. Indemnity">
            <p>
              You agree to indemnify and hold us harmless against any claim, loss, or damage
              arising from (a) your breach of these Terms, (b) content you upload to the Service,
              or (c) your use of the Service in a way that violates someone else's rights or
              applicable law.
            </p>
          </Section>

          <Section title="15. Governing law and disputes">
            <p>
              These Terms are governed by the law of <strong>England and Wales</strong>. Any
              dispute arising out of or in connection with these Terms or the Service falls under
              the exclusive jurisdiction of the courts of England and Wales — except that if you
              are a consumer resident in another UK jurisdiction, you may also bring proceedings
              in the courts of that jurisdiction.
            </p>
            <p>
              Before resorting to court proceedings we'd much rather sort things out informally.
              Please email us at <a href="mailto:hello@housemait.com" className="text-plum hover:underline">hello@housemait.com</a>{' '}
              and we'll do our best to resolve your concern.
            </p>
          </Section>

          <Section title="16. Changes to these Terms">
            <p>
              We may update these Terms from time to time. If we make material changes we'll
              notify you in-app or by email at least <strong>14 days</strong> before the changes
              take effect. Continued use of the Service after the effective date means you accept
              the updated Terms.
            </p>
          </Section>

          <Section title="17. Contact">
            <p>
              For questions about these Terms, email{' '}
              <a href="mailto:hello@housemait.com" className="text-plum hover:underline">hello@housemait.com</a>.
            </p>
            <p>
              For privacy-specific queries, see the{' '}
              <Link to="/privacy" className="text-plum hover:underline">Privacy Policy</Link>{' '}
              contact section.
            </p>
          </Section>

          <footer className="border-t border-light-grey pt-6 mt-10">
            <p className="text-sm text-warm-grey m-0">
              © {new Date().getFullYear()} Housemait. All rights reserved.
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="pt-4">
      <h2 className="text-xl md:text-2xl font-semibold text-plum mt-6 mb-3 leading-snug">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
