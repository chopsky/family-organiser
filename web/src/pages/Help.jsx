/**
 * Help & support page (`/help`)
 *
 * Authenticated-only — wrapped in <RequireAuth><Layout> at the App.jsx
 * level, so it inherits the desktop sidebar and the mobile bottom-tab
 * bar + More sheet automatically. Reached from the More sheet's
 * "Help & support" row.
 *
 * Structure:
 *   1. Hero ("How can we help?")
 *   2. FAQ — 3 grouped sections with deep-link-friendly ids
 *      • #getting-started          Getting started + WhatsApp bot
 *      • #calendar-documents       Calendar + documents
 *      • #account-troubleshooting  Account, data + troubleshooting
 *   3. "Still need help?" — embedded ContactForm
 *   4. Footer — direct email, brand links, app version
 *
 * App Store guideline 3.1.1 — there is *no* subscription, billing,
 * pricing, payment, or Stripe content on this page in any form, on
 * any platform. Earlier drafts gated a Subscriptions FAQ behind
 * isIos() at runtime, but the strings + the openStripePortal handler
 * still lived in the JS bundle that ships with the iOS app via
 * Capacitor. Removing the section entirely means the iOS bundle
 * contains zero subscription content reachable from /help — strongest
 * possible signal to App Review.
 *
 * Web users with billing questions still find them in Settings →
 * Plan (which has its own iOS gate and the canonical Stripe portal
 * flow). The /help page deliberately does NOT duplicate that path.
 *
 * Copy is intentionally short and links to authoritative sources
 * where possible (Settings, Privacy page) rather than restating
 * numbers — keeps the page honest as features evolve.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import FaqAccordion from '../components/FaqAccordion';
import ContactForm from '../components/ContactForm';

export default function Help() {
  // Set the document title + scroll-to-top on mount, matching Privacy.jsx.
  useEffect(() => {
    document.title = 'Help & support · Housemait';
    if (!window.location.hash) window.scrollTo(0, 0);
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="mb-10">
        <div className="text-[11px] font-bold tracking-[0.1em] uppercase text-plum mb-2">
          We're here for you
        </div>
        <h1
          className="text-charcoal"
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontWeight: 400,
            fontSize: 'clamp(36px, 6vw, 44px)',
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
          }}
        >
          How can we{' '}
          <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>help?</em>
        </h1>
        <p className="text-warm-grey mt-3 text-[15px] leading-relaxed">
          Quick answers to common questions below — and a way to reach us if
          you're still stuck.
        </p>
      </div>

      {/* ── 1. Getting started + WhatsApp bot ─────────────────── */}
      <FaqSection id="getting-started" title="Getting started & WhatsApp bot">
        <FaqAccordion
          id="getting-started-create-household"
          question="How do I create a household and invite my family?"
        >
          <p>
            When you sign up, Housemait creates your household automatically.
            To invite family members, head to{' '}
            <Link to="/family" className="text-plum hover:underline">
              Family
            </Link>{' '}
            and use "Invite a member" — we'll send them a link they can open
            on their phone to join.
          </p>
          <p>
            Anyone you invite as an admin can add or remove members and
            change household settings. Regular members can use everything
            but can't manage the household itself.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="getting-started-connect-whatsapp"
          question="How do I connect WhatsApp?"
        >
          <p>
            Open{' '}
            <Link to="/settings" className="text-plum hover:underline">
              Settings
            </Link>{' '}
            and find "WhatsApp". Add your phone number (with country code,
            e.g. +44 7…), verify it with the code we text you, then send a
            message to our WhatsApp number to complete the link.
          </p>
          <p>
            From then on you can chat with the bot like any other contact —
            ask it to add events, tasks, shopping items, or to summarise
            what's on this week.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="getting-started-bot-commands"
          question="What can I say to the bot?"
        >
          <p>You can use slash commands for instant replies:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className="text-charcoal bg-plum-light/40 px-1 rounded">/shopping</code>{' '}
              — show the shopping list
            </li>
            <li>
              <code className="text-charcoal bg-plum-light/40 px-1 rounded">/tasks</code>{' '}
              — show today's and overdue tasks
            </li>
            <li>
              <code className="text-charcoal bg-plum-light/40 px-1 rounded">/mytasks</code>{' '}
              — show only tasks assigned to you
            </li>
            <li>
              <code className="text-charcoal bg-plum-light/40 px-1 rounded">/help</code>{' '}
              — the same reference, in WhatsApp
            </li>
          </ul>
          <p>Or just talk to it normally — it understands things like:</p>
          <ul className="list-disc pl-5 space-y-1 italic">
            <li>"Add milk and eggs to the list"</li>
            <li>"Remind Sarah to book the dentist on Tuesday"</li>
            <li>"What's on this Saturday?"</li>
          </ul>
        </FaqAccordion>

        <FaqAccordion
          id="getting-started-bot-not-replying"
          question="Why isn't the bot replying to me?"
        >
          <p>
            The most common cause is that your WhatsApp number isn't linked
            to a household yet — open{' '}
            <Link to="/settings" className="text-plum hover:underline">
              Settings
            </Link>{' '}
            and check the WhatsApp section. If it shows "verified" but
            messages still aren't getting replies, drop us a note below
            with your phone number and we'll take a look.
          </p>
        </FaqAccordion>
      </FaqSection>

      {/* ── 2. Calendar + documents ───────────────────────────── */}
      <FaqSection id="calendar-documents" title="Calendar & documents">
        <FaqAccordion
          id="calendar-add-feed"
          question="How do I add an external calendar (Apple, Google, school)?"
        >
          <p>
            On the{' '}
            <Link to="/calendar" className="text-plum hover:underline">
              Calendar
            </Link>{' '}
            page, use "Add feed" and paste the public iCal/.ics URL from
            Apple Calendar, Google Calendar, or your child's school calendar
            page. We refresh feeds in the background — events typically
            appear within a few minutes.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="calendar-missing-events"
          question="Why don't I see my events for next month?"
        >
          <p>
            Calendar fetches events for the visible month plus a small
            buffer either side. If you scroll forward, the next month
            loads on demand. External-feed events refresh on a schedule
            (currently every few hours) — pull the page to refresh, or
            wait for the next sync.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="documents-file-types"
          question="What file types can I upload, and what's our storage limit?"
        >
          <p>
            We support PDFs, common image formats (PNG, JPEG, GIF, WebP,
            HEIC), Word documents (.docx) and plain text/CSV. Each
            household gets several gigabytes of shared storage — plenty
            for school letters, insurance documents, and warranty cards.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="documents-privacy"
          question="Who can see my documents?"
        >
          <p>
            Only members of your household. Files are encrypted at rest,
            served via short-lived signed URLs (5 minutes), and every
            view is logged. You can read more in our{' '}
            <Link to="/privacy" className="text-plum hover:underline">
              privacy policy
            </Link>
            .
          </p>
        </FaqAccordion>
      </FaqSection>

      {/* ── 3. Account, data & troubleshooting ─────────────────── */}
      <FaqSection id="account-troubleshooting" title="Account, data & troubleshooting">
        <FaqAccordion
          id="account-export-delete"
          question="How do I export or delete my data?"
        >
          <p>
            Open{' '}
            <Link to="/settings" className="text-plum hover:underline">
              Settings → Privacy & data
            </Link>{' '}
            for export and deletion options. Deletion is permanent and
            removes your account from your household; admins should
            transfer the household first if they want it to keep running.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="account-leave-household"
          question="How do I leave a household or transfer admin?"
        >
          <p>
            Admins can promote another member to admin, then leave, from{' '}
            <Link to="/family" className="text-plum hover:underline">
              Family
            </Link>
            . Regular members can leave from there too — just bear in
            mind you'll lose access to shared lists and documents until
            re-invited.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="troubleshooting-push"
          question="I'm not getting push notifications."
        >
          <p>
            On iOS, check that notifications are enabled for Housemait in
            the system Settings app. In the Housemait app, head to{' '}
            <Link to="/settings" className="text-plum hover:underline">
              Settings
            </Link>{' '}
            and toggle the relevant notification preferences. If
            everything looks on but nothing arrives, drop us a note below.
          </p>
        </FaqAccordion>

        <FaqAccordion
          id="troubleshooting-login"
          question="I'm having trouble logging in."
        >
          <p>
            We use Cloudflare Turnstile to keep bots out of the login
            form — occasionally it asks you to complete a quick
            verification. If you're stuck on that, try refreshing the
            page or switching browsers. If you can't reach your account
            at all, email us directly at{' '}
            <a
              href="mailto:hello@housemait.com"
              className="text-plum hover:underline"
            >
              hello@housemait.com
            </a>{' '}
            — we'll sort it.
          </p>
        </FaqAccordion>
      </FaqSection>

      {/* ── Still need help? — embedded ContactForm ──────────── */}
      <section
        id="contact"
        className="bg-white rounded-2xl border border-cream-border p-6 md:p-8 mt-10"
      >
        <h2
          className="text-charcoal m-0"
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontWeight: 400,
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
          }}
        >
          Still need help?
        </h2>
        <p className="text-warm-grey mt-1 text-[15px]">
          Drop us a note and we'll get back within one working day.
        </p>
        <div className="mt-5">
          <ContactForm compact />
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-light-grey text-sm text-warm-grey space-y-3">
        <p>
          Or email us directly at{' '}
          <a
            href="mailto:hello@housemait.com"
            className="text-plum hover:underline"
          >
            hello@housemait.com
          </a>
          .
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/privacy" className="hover:text-charcoal hover:underline">
            Privacy policy
          </Link>
          <Link to="/terms" className="hover:text-charcoal hover:underline">
            Terms
          </Link>
        </p>
        <p className="text-xs text-warm-grey/70">
          Housemait v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}

/**
 * Section wrapper — large display title + a card-style container for
 * the accordion items inside. Each section has an `id` so the More
 * sheet (or anywhere else) can deep-link to it.
 */
function FaqSection({ id, title, children }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2
        className="text-charcoal mb-3"
        style={{
          fontFamily: "'Instrument Serif', serif",
          fontWeight: 400,
          fontSize: 28,
          lineHeight: 1.15,
          letterSpacing: '-0.015em',
        }}
      >
        {title}
      </h2>
      <div className="bg-white rounded-2xl border border-cream-border px-5 md:px-6">
        {children}
      </div>
    </section>
  );
}
