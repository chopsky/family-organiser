import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import '../landing.css'
import { useLocale } from '../hooks/useLocale'
import HreflangTags from '../components/HreflangTags'
import { APP_STORE_URL, APP_STORE_CONFIGURED } from '../lib/app-store'

/**
 * Housemait marketing site — "scroll story" design, ported from
 * design_handoff_housemait_website (see its README for the spec).
 *
 * One component serves / and every locale path (/gb /us /eu /au /ca /za):
 * copy, currency and demo content adapt via useLocale(). The scroll story,
 * nav two-state, marquee and reveals are driven from a single rAF loop —
 * the progress maths is ported verbatim from the prototype's behaviour
 * class, which the handoff calls directly portable.
 */

const SIGNUP_URL = '/signup'

/* ── Locale-derived copy ──────────────────────────────────────────── */

// North-American English locales spell/word things differently.
const isNA = (locale) => locale.code === 'us' || locale.code === 'ca'

// Receipt amounts per Stripe currency — realistic small-basket prices so
// the "Receipts, read for you" card never shows £ to a $ visitor. Items
// use receipt-style shorthand on purpose.
const RECEIPTS = {
  gbp: { items: [['Strawberries', '£2.50'], ['Penne ×2', '£1.90'], ['Milk 2L', '£1.65']], total: '£6.05' },
  usd: { items: [['Strawberries', '$3.99'], ['Penne ×2', '$2.50'], ['Milk 1 gal', '$3.49']], total: '$9.98' },
  eur: { items: [['Strawberries', '€2.80'], ['Penne ×2', '€2.10'], ['Milk 2L', '€1.85']], total: '€6.75' },
  aud: { items: [['Strawberries', 'A$4.50'], ['Penne ×2', 'A$3.20'], ['Milk 2L', 'A$3.10']], total: 'A$10.80' },
  cad: { items: [['Strawberries', 'C$4.99'], ['Penne ×2', 'C$3.29'], ['Milk 2L', 'C$3.79']], total: 'C$12.07' },
  zar: { items: [['Strawberries', 'R44.99'], ['Penne ×2', 'R32.50'], ['Milk 2L', 'R38.99']], total: 'R116.48' },
}

// First features-grid card: automatic term-date import exists for GB + ZA
// (locale.features.schoolTerms); everywhere else the universal story is
// "forward the newsletter and the dates land in the calendar".
function schoolCard(locale) {
  if (locale.code === 'gb') {
    return {
      title: 'Term dates, imported in one click',
      desc: 'Tell Housemait the school. Every term, half-term and inset day drops straight into the family calendar.',
      chip: 'St Mary’s Primary · synced ✓',
      rows: [['Autumn term begins', 'Wed 3 Sep'], ['Half term', '27–31 Oct'], ['Inset day · school closed', 'Mon 24 Nov']],
    }
  }
  if (locale.code === 'za') {
    return {
      title: 'Term dates, imported in one click',
      desc: 'Tell Housemait the school. Every term date and school holiday drops straight into the family calendar.',
      chip: 'Westville Primary · synced ✓',
      rows: [['Term 1 begins', 'Wed 14 Jan'], ['School holiday', '28 Mar – 14 Apr'], ['Public holiday · school closed', 'Mon 27 Apr']],
    }
  }
  return {
    title: 'School letters, read for you',
    desc: 'Forward the class newsletter and every date lands straight in the family calendar.',
    chip: 'Newsletter scanned · 3 dates found ✓',
    rows: [['Class photo day', 'Fri 10 Oct'], ['Trip payment due', 'Wed 15 Oct'], ['No school · teacher day', 'Mon 24 Nov']],
  }
}

// Marquee reviews — names fixed by the design; mum/mom, sofa/couch and the
// term-dates reference adapt per locale.
function buildReviews(locale) {
  const na = isNA(locale)
  const mum = na ? 'mom' : 'mum'
  const hasTerms = !!locale.features?.schoolTerms
  return [
    { q: '“I forwarded the school newsletter on WhatsApp and every date just… appeared in the calendar. Sorcery.”', n: 'Emma', r: `${mum} of two` },
    { q: '“We stopped arguing about whose turn it is. The kids race to finish their quests before we’ve finished dinner.”', n: 'Daniel', r: 'dad of three' },
    { q: `“Meal planning went from an hour of Sunday dread to five minutes on the ${na ? 'couch' : 'sofa'}.”`, n: 'Priya', r: `${mum} of two` },
    { q: `“It replaced the fridge whiteboard, three apps and a paper ${na ? 'planner' : 'diary'}. My husband finally knows what’s on this week.”`, n: 'Jess', r: `${mum} of twins` },
    { q: '“My daughter asks to do her chores now. I’m as surprised as you are.”', n: 'Rachel', r: `${mum} of one` },
    { q: `“Set-up took ten minutes. ${hasTerms ? 'Term dates' : 'School dates'}, swimming, the lot. It just runs itself now.”`, n: 'Sophie & Mark', r: 'parents of three' },
  ]
}

function buildFaqs(locale) {
  const p = locale.pricing
  return [
    { q: 'What is Housemait?', a: 'Housemait is an AI-powered family organiser that brings your calendar, meals, shopping, chores and school life into one shared app, with an assistant on WhatsApp that does the typing for you.' },
    { q: 'How does the WhatsApp assistant work?', a: 'Message Housemait like you’d message a friend: type, send a voice note, or snap a photo of a school letter. It adds events, updates lists and answers questions about the week, and everything appears in the app for the whole family, instantly.' },
    { q: 'Do both parents see the same thing?', a: 'Yes. Everyone in the family shares the same calendar, lists and plans, live. Add something on the school run and it’s on your partner’s phone before you’re home.' },
    { q: 'Is it safe for kids?', a: 'Child Mode is a separate, playful space with their quests, stars and countdowns, and nothing else. No ads, no messages from strangers, no social feed. You decide what they see.' },
    { q: 'How much does it cost?', a: `Housemait is ${p.monthly} a month, or ${p.annual} a year (two months free). One subscription covers the whole household, and you can cancel anytime.` },
    { q: 'Which phones does it work on?', a: 'Housemait is on iPhone today, and the WhatsApp assistant works from any phone. Android is on the way.' },
  ]
}

/* ── Story config (ported from the prototype) ─────────────────────── */

// Unit vectors for the 8 floating icon tiles' spread positions.
const ICON_VECS = [[-1, -0.58], [1, -0.54], [-0.98, 0.22], [0.99, 0.3], [-0.55, 0.84], [0.62, 0.88], [-0.52, -0.98], [0.56, -0.94]]
// Narrow layout: side slots + jitter, four tiles per side of the phone.
const SLOT_Y = [-0.26, -0.26, 0.24, 0.24, 0.74, 0.74, -0.76, -0.76]
const JIT = [0, -6, -10, 4, 6, -4, -8, 8]
// icon src, inner padding, float duration s, float delay s
const ICONS = [
  ['/landing/icons/calendar.svg', 8, 4.6, -0.4],
  ['/landing/icons/whatsapp.svg', 7, 5.2, -2.1],
  ['/landing/icons/clipboard.svg', 12, 4.2, -1.3],
  ['/landing/icons/grocery.svg', 12, 5.4, -2.9],
  ['/landing/icons/restaurant.svg', 9, 4.9, -3.6],
  ['/landing/icons/sports.svg', 11, 4.4, -1.8],
  ['/landing/icons/graduate.svg', 9, 5.0, -1.0],
  ['/landing/icons/email.svg', 8, 4.7, -2.5],
]

const STORY_CHAPTERS = [
  { h: ['One calendar,', 'the whole family'], p: 'School runs, clubs, birthdays and appointments, colour-coded by person and synced to every phone in the house.' },
  { h: ['Chores kids', 'actually do'], p: 'Routines and quests with stars to earn and treats to spend. Beds get made, teeth get brushed, and nobody nags.' },
  { h: ['A week of dinners', 'in minutes'], p: 'Plan the week from your family recipe box, and every ingredient lands on the shopping list by itself.' },
  { h: ['Lists that keep', 'everyone in sync'], p: 'To-dos and shopping, shared in real time. Add it the moment you think of it, sorted before you forget.' },
  { h: ['And manage it all', 'in WhatsApp'], p: 'Message Housemait like a friend. It adds the event, updates the list and answers back in seconds.' },
]

const SCREENS = ['/landing/app-calendar.jpg', '/landing/app-tasks.jpg', '/landing/app-mealplan.jpg', '/landing/app-lists.jpg']
const SCREEN_ALTS = ['Housemait shared family calendar', 'Housemait chores, routines and rewards', 'Housemait weekly meal planner and recipe box', 'Housemait shared to-do and shopping lists']
const COMPANIONS = ['/landing/app-calendar-month.jpg', '/landing/app-rewards.jpg', '/landing/app-meals.jpg', '/landing/app-shopping.jpg']
const COMPANION_ALTS = ['Housemait calendar month view', 'Housemait rewards and star shop', 'Housemait recipe box', 'Housemait categorised shopping list']

/* ── Small shared pieces ──────────────────────────────────────────── */

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
)
const Check = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6D38AD" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
)
const FileIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>
)

/**
 * QR-on-hover download link — the behaviour carried over from the previous
 * site. Wrapper is the hover/focus zone; the popover shows the App Store QR
 * and flips above the trigger when there isn't ~200px free below (recomputed
 * on every pointer/keyboard entry, since scroll changes the answer). Touch
 * devices never see the popover (CSS hover gate) — a tap just navigates.
 */
function QrLink({ href, className, children, ariaLabel, preferUp = false }) {
  const wrapRef = useRef(null)
  const [placement, setPlacement] = useState(preferUp ? 'top' : 'bottom')
  const recompute = () => {
    const node = wrapRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    // preferUp: used inside overflow-hidden sections (hero, CTA panel)
    // where a downward popover gets clipped at the section edge — open
    // above the trigger unless there's genuinely no room up there.
    if (preferUp) setPlacement(rect.top < 210 ? 'bottom' : 'top')
    else setPlacement(window.innerHeight - rect.bottom < 210 ? 'top' : 'bottom')
  }
  return (
    <span ref={wrapRef} className="lv-qrwrap" data-placement={placement} onMouseEnter={recompute} onFocus={recompute}>
      <a href={href} className={className} aria-label={ariaLabel}>{children}</a>
      <span className="lv-qrpop" role="tooltip" aria-hidden="true">
        <img src="/assets/app-store-qr.svg" alt="" width="150" height="150" loading="lazy" />
      </span>
    </span>
  )
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const locale = useLocale()
  const [openFaq, setOpenFaq] = useState(null)
  const [navOver, setNavOver] = useState(true)

  const el = useRef({})
  const setEl = (name) => (node) => { el.current[name] = node }
  const marqueePaused = useRef(false)

  const na = isNA(locale)
  const reviews = useMemo(() => buildReviews(locale), [locale])
  const faqs = useMemo(() => buildFaqs(locale), [locale])
  const receipt = RECEIPTS[locale.stripeCurrency] || RECEIPTS.usd
  const school = schoolCard(locale)
  const p = locale.pricing

  // SEO title stays the established one (indexed); smooth in-page anchors.
  useEffect(() => {
    document.title = 'AI Family Organiser - Calendar, Tasks, Meals & Lists | Housemait'
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => { document.documentElement.style.scrollBehavior = prev }
  }, [])

  // Reveal-on-scroll: tag [data-lv-reveal] elements below the fold with
  // .pre, then flip to .in the first time they intersect. The data value
  // is the stagger index (delay = i × 0.09s).
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.lv [data-lv-reveal]'))
    nodes.forEach((node) => {
      const i = parseInt(node.getAttribute('data-lv-reveal') || '0', 10)
      node.style.transitionDelay = `${i * 0.09}s, ${i * 0.09}s`
      if (node.getBoundingClientRect().top > window.innerHeight * 0.9) node.classList.add('pre')
    })
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target) }
      })
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' })
    nodes.forEach((node) => io.observe(node))
    return () => io.disconnect()
  }, [])

  // The single rAF loop: nav two-state, scroll-story scrubbing, marquee.
  // Ported from the prototype's applyScroll()/loop() — maths unchanged.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const E = el.current
    let raf
    let mqX = 0
    let mqLast = 0
    let over = null

    const inv = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)))
    const ease = (t) => t * t * (3 - 2 * t)

    const applyScroll = () => {
      // Nav state: glassy-dark while the hero is still behind the pill.
      const nav = E.nav
      const hero = E.hero
      let navBottom = 86
      if (nav && hero) {
        navBottom = nav.getBoundingClientRect().bottom
        const isOver = hero.getBoundingClientRect().bottom > navBottom
        if (isOver !== over) { over = isOver; setNavOver(isOver) }
      }

      const st = E.story
      if (!st) return
      const vh = window.innerHeight
      const vw = window.innerWidth
      const total = st.offsetHeight - vh
      if (total <= 0) return
      const prog = Math.min(1, Math.max(0, -st.getBoundingClientRect().top / total))
      const narrow = vw < 1080

      const rx = Math.min(vw * 0.42, 520)
      const ry = vh * 0.33
      const maxX = vw / 2 - 70
      const fh = E.frame ? E.frame.offsetHeight / 2 : vh * 0.3

      // Narrow: the whole cluster rises 50% → 38% as the story begins —
      // clamped so the phone's top never tucks under the nav pill on
      // short viewports.
      const topPct = narrow ? 50 - 12 * ease(inv(prog, 0.15, 0.22)) : 50
      let centrePx = (topPct / 100) * vh
      if (narrow) centrePx = Math.max(centrePx, navBottom + 16 + fh * 1.05)
      const tp = `${centrePx.toFixed(0)}px`
      if (E.phoneWrap) E.phoneWrap.style.top = narrow ? tp : '50%'
      if (E.glow) E.glow.style.top = narrow ? tp : '50%'
      for (let i = 0; i < 8; i++) { const ic = E[`ic${i}`]; if (ic) ic.style.top = narrow ? tp : '50%' }

      // Icon tiles converge into the phone. On desktop, spread positions
      // come from the unit vectors but are pushed clear of the phone
      // horizontally (short viewports otherwise drop them onto it).
      const rxN = Math.min(fh * 1.19 * 0.479 + 30, vw / 2 - 58)
      const minX = fh * 0.479 + 64 // phone half-width (h × 828/1728 / 2) + tile half + gap
      for (let i = 0; i < 8; i++) {
        const ic = E[`ic${i}`]
        if (!ic) continue
        const s0 = 0.045 + i * 0.009
        const e0 = 0.125 + i * 0.009
        const c = ease(inv(prog, s0, e0))
        const v = ICON_VECS[i]
        let bx, by
        if (narrow) { bx = Math.sign(v[0]) * rxN + JIT[i]; by = SLOT_Y[i] * fh }
        else {
          bx = v[0] * rx; by = v[1] * ry
          if (Math.abs(bx) < minX) bx = Math.sign(bx) * minX
          if (Math.abs(bx) > maxX) bx = Math.sign(bx) * maxX
        }
        ic.style.transform = `translate(-50%,-50%) translate(${(bx * (1 - c)).toFixed(1)}px,${(by * (1 - c)).toFixed(1)}px) scale(${(1 - 0.85 * c).toFixed(3)})`
        ic.style.opacity = (1 - inv(prog, e0 - 0.02, e0)).toFixed(3)
      }

      // Purple glow + phone scale bump as the icons land.
      const bump = Math.max(0, 1 - Math.abs(prog - 0.175) / 0.055)
      if (E.glow) E.glow.style.opacity = (bump * 0.85).toFixed(3)
      const introScale = narrow ? 0.19 * (1 - ease(inv(prog, 0.15, 0.22))) : 0
      if (E.frame) E.frame.style.transform = `scale(${((1 + introScale) * (1 + 0.035 * ease(bump))).toFixed(4)})`

      // Five chapters: screens swap on the phone, text cards enter/exit.
      // Narrow: the card sits just below the phone's actual bottom edge
      // (cluster centre + scaled half-height + gap) rather than a fixed
      // 71%, so a big phone on a short viewport never overlaps the text.
      const A = 0.2
      const W = 0.16
      const cardTopNarrow = centrePx + fh * 1.05 + 26
      for (let i = 0; i < 5; i++) {
        const t = inv(prog, A + i * W, A + (i + 1) * W)
        const enter = ease(inv(t, 0, 0.22))
        const exit = i < 4 ? ease(inv(t, 0.82, 1)) : 0
        const screen = i <= 3 ? E[`s${i}`] : E.chat
        if (screen) {
          screen.style.opacity = enter.toFixed(3)
          screen.style.transform = `translateY(${((1 - enter) * 34).toFixed(1)}px)`
        }
        const card = E[`c${i}`]
        if (card) {
          card.style.top = narrow ? `${cardTopNarrow.toFixed(0)}px` : ''
          card.style.opacity = (enter * (1 - exit)).toFixed(3)
          const base = narrow ? 'translateX(-50%)' : 'translateY(-50%)'
          card.style.transform = `${base} translateY(${(((1 - enter) * 26) - (exit * 26)).toFixed(1)}px)`
        }
      }

      // Companion phone (desktop, chapters 1–4): tilted mock behind the
      // main phone on the opposite side of the text card.
      if (E.compWrap && !narrow) {
        const compSides = { 0: 1, 1: -1, 2: 1, 3: -1 }
        let vis = 0
        let act = -1
        for (const k of [0, 1, 2, 3]) {
          const t = inv(prog, A + k * W, A + (k + 1) * W)
          const v = ease(inv(t, 0, 0.22)) * (1 - ease(inv(t, 0.82, 1)))
          if (v > vis) { vis = v; act = k }
        }
        for (const k of [0, 1, 2, 3]) { const layer = E[`cp${k}`]; if (layer) layer.style.opacity = (k === act && vis > 0) ? '1' : '0' }
        const cw = E.frame ? E.frame.offsetWidth : 320
        const side = act >= 0 ? compSides[act] : 1
        E.compWrap.style.opacity = vis.toFixed(3)
        E.compWrap.style.transform = `translate(-50%,-50%) translate(${(side * cw * 0.52).toFixed(1)}px,${(34 + (1 - vis) * 22).toFixed(1)}px) rotate(${side * 5}deg) scale(0.86)`
      }
    }

    const loop = (ts) => {
      raf = requestAnimationFrame(loop)
      try { applyScroll() } catch { /* keep the loop alive */ }
      // Reviews marquee: ~32px/s, pauses on hover, wraps at half width.
      const mq = E.marquee
      if (mq && !reduced) {
        const dt = mqLast ? Math.min(ts - mqLast, 50) : 16
        if (!marqueePaused.current) {
          mqX -= dt * 0.032
          const half = mq.scrollWidth / 2
          if (half > 0 && -mqX >= half) mqX += half
          mq.style.transform = `translateX(${mqX.toFixed(2)}px)`
        }
      }
      mqLast = ts
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const organised = na ? 'organized' : 'organised'

  return (
    <div className="lv">
      <HreflangTags locale={locale} />

      {/* ── Nav pill ── */}
      <div className="lv-navwrap">
        <nav ref={setEl('nav')} className={`lv-nav${navOver ? ' over' : ''}`}>
          <a href="#top" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flex: 'none' }}>
            <img className="lv-nav-logo" src="/housemait-logo-web.svg" alt="Housemait" />
          </a>
          <div className="lv-nav-links">
            <a href="#story">Features</a>
            <a href="#reviews">Reviews</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lv-nav-right">
            <Link to={SIGNUP_URL} className="lv-nav-cta">Get started</Link>
          </div>
        </nav>
      </div>

      {/* ── Hero ── */}
      <section id="top" className="lv-hero" ref={setEl('hero')}>
        <img className="lv-hero-img" src="/landing/hero-family.jpg" alt="A family laughing together over dinner at home" fetchPriority="high" />
        <div className="lv-hero-scrim" />
        <div className="lv-hero-noise" />
        <div className="lv-hero-inner">
          <h1>Family life,<br />{organised} with AI.</h1>
          <p className="lv-hero-sub">One home for the family calendar, meals, lists and chores, with an AI assistant in WhatsApp that does it all for you.</p>
          <div className="lv-hero-ctas">
            {APP_STORE_CONFIGURED ? (
              <QrLink href={APP_STORE_URL} className="lv-btn-cream" preferUp ariaLabel="Get the Housemait app on the App Store — or hover to scan the QR code">
                Get the app
              </QrLink>
            ) : (
              <Link to={SIGNUP_URL} className="lv-btn-cream">Get started</Link>
            )}
            <a href="#story" className="lv-btn-ghost">
              See how it works
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
            </a>
          </div>
          <div className="lv-hero-trial">Free 30-day trial · No card to start&nbsp;<span style={{ letterSpacing: '0.27px' }}>· Cancel anytime</span></div>
        </div>
      </section>

      {/* ── Intro ── */}
      <section className="lv-intro">
        <div className="lv-intro-inner" data-lv-reveal="0">
          <h2>Your family&rsquo;s operating&nbsp;system.</h2>
          <p className="lv-sub" style={{ fontSize: 'clamp(15px,1.5vw,17.5px)' }}>Calendar, meals, lists, chores and school life. One app that keeps everyone in&nbsp;sync.</p>
        </div>
      </section>

      {/* ── Scroll story ── */}
      <section id="story" className="lv-story" ref={setEl('story')}>
        <div className="lv-stage">
          <div className="lv-glow" ref={setEl('glow')} />

          {/* Companion phone (desktop only) */}
          <div className="lv-compwrap" ref={setEl('compWrap')}>
            <div className="lv-comp-frame">
              <img className="lv-frame-img" src="/landing/phone-frame.webp" alt="" />
              <div className="lv-screen">
                {COMPANIONS.map((src, i) => (
                  <img key={src} ref={setEl(`cp${i}`)} src={src} alt={COMPANION_ALTS[i]} />
                ))}
              </div>
            </div>
          </div>

          {/* Main phone */}
          <div className="lv-phonewrap" ref={setEl('phoneWrap')}>
            <div className="lv-frame" ref={setEl('frame')}>
              <img className="lv-frame-img" src="/landing/phone-frame.webp" alt="" />
              <div className="lv-screen">
                <img className="lv-s-base" src="/landing/app-home.jpg" alt="Housemait family home screen with today&rsquo;s schedule" />
                {SCREENS.map((src, i) => (
                  <img key={src} ref={setEl(`s${i}`)} className="lv-s-layer" src={src} alt={SCREEN_ALTS[i]} style={{ zIndex: 2 + i }} />
                ))}
                <img ref={setEl('chat')} className="lv-s-layer" src="/landing/app-whatsapp.jpg" alt="WhatsApp conversation with the Housemait assistant" style={{ zIndex: 6 }} />
              </div>
            </div>
          </div>

          {/* Floating icon tiles */}
          {ICONS.map(([src, pad, dur, delay], i) => (
            <div key={src} className="lv-icon-tile" ref={setEl(`ic${i}`)}>
              <div style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}>
                <img className="lv-icon" src={src} alt="" style={{ padding: pad }} />
              </div>
            </div>
          ))}

          {/* Chapter text cards */}
          {STORY_CHAPTERS.map((ch, i) => (
            <div key={ch.p} className={`lv-story-card ${i % 2 === 0 ? 'side-l' : 'side-r'}`} ref={setEl(`c${i}`)}>
              <h3>{ch.h[0]}<br />{ch.h[1]}</h3>
              <p>{ch.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section id="touches" className="lv-touches">
        <div className="lv-touch-head" data-lv-reveal="0">
          <h2 className="lv-h2">The little things, handled.</h2>
          <p className="lv-sub">Housemait quietly takes care of the admin around the edges of family life, so nothing slips.</p>
        </div>
        <div className="lv-cards">
          <div className="lv-card" data-lv-reveal="0">
            <h3>{school.title}</h3>
            <p>{school.desc}</p>
            <div className="lv-rows">
              <div className="lv-chip">{school.chip}</div>
              {school.rows.map(([k, v]) => (
                <div className="lv-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>
          <div className="lv-card crop" data-lv-reveal="1">
            <h3>Kids build healthy habits</h3>
            <p>Child Mode lets kids see their day, tick off their tasks, earn stars and spend them on rewards.</p>
            <div className="lv-kidphone-well">
              <div className="lv-kidphone">
                <img src="/landing/app-kid-quests.jpg" alt="Housemait Child Mode, today&rsquo;s quests" loading="lazy" />
              </div>
            </div>
          </div>
          <div className="lv-card" data-lv-reveal="0">
            <h3>Store documents &amp; moments</h3>
            <p>Keep school letters, consent forms, insurance, passports and precious memories in a single, searchable place.</p>
            <div className="lv-rows">
              <div className="lv-docrow"><span className="ic"><FileIcon /></span><span className="k">Swimming consent form</span><span className="tag">School</span></div>
              <div className="lv-docrow"><span className="ic"><FileIcon /></span><span className="k">Home insurance policy</span><span className="tag">Home</span></div>
              <div className="lv-docrow"><span className="ic"><FileIcon /></span><span className="k">Passports × 4</span><span className="tag">Travel</span></div>
            </div>
          </div>
          <div className="lv-card" data-lv-reveal="1">
            <h3>Receipts, read for you</h3>
            <p>Snap your grocery receipt and Housemait automatically checks items off your shopping list.</p>
            <div className="lv-receipt-well">
              <div className="lv-receipt">
                <div className="store">GREEN &amp; GROCER</div>
                <div className="rule" />
                {receipt.items.map(([k, v]) => (
                  <div className="line" key={k}><span>{k}</span><span>{v}</span></div>
                ))}
                <div className="rule" />
                <div className="total"><span>TOTAL</span><span>{receipt.total}</span></div>
                <div className="lv-scanline" />
              </div>
              <div className="lv-chip" style={{ alignSelf: 'center' }}>Filed → Groceries · {receipt.total} ✓</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Reviews marquee ── */}
      <section id="reviews" className="lv-reviews">
        <div className="lv-reviews-head" data-lv-reveal="0">
          <h2 className="lv-h2">Loved by busy families.</h2>
        </div>
        <div className="lv-marquee-outer" data-lv-reveal="1">
          <div
            className="lv-marquee"
            ref={setEl('marquee')}
            onMouseEnter={() => { marqueePaused.current = true }}
            onMouseLeave={() => { marqueePaused.current = false }}
          >
            {[...reviews, ...reviews].map((r, i) => (
              <div className="lv-review" key={`${r.n}-${i}`} aria-hidden={i >= reviews.length || undefined}>
                <div className="stars">★★★★★</div>
                <p>{r.q}</p>
                <div className="who">{r.n} <span>· {r.r}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Privacy ── */}
      <section id="privacy" className="lv-privacy">
        <div className="lv-privacy-panel">
          <div className="lv-privacy-glow" />
          <div data-lv-reveal="0" style={{ position: 'relative' }}>
            <h2>Private by design.</h2>
            <p className="lv-privacy-sub">Housemait is where your family lives: plans, paperwork, little notes home. We treat that with the care it deserves.</p>
          </div>
          <div className="lv-privacy-grid">
            <div data-lv-reveal="0">
              <span className="ic"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg></span>
              <h4>No ads, no data sales</h4>
              <p>Your family&rsquo;s data is yours. We never share, sell it, or use it to train AI models.</p>
            </div>
            <div data-lv-reveal="1">
              <span className="ic"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
              <h4>Encrypted, always</h4>
              <p>All data is&nbsp;protected with industry standard encryption in transit and at rest.</p>
            </div>
            <div data-lv-reveal="2">
              <span className="ic"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg></span>
              <h4>Yours to take or delete</h4>
              <p>Export everything, or delete your account and every trace of it, any time you like.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="lv-pricing">
        <div className="lv-pricing-head" data-lv-reveal="0">
          <h2 className="lv-h2">One plan, whole household.</h2>
          <p className="lv-sub">Every feature, every family member, one subscription. Cancel anytime.</p>
        </div>
        <div className="lv-plans">
          <div className="lv-plan" data-lv-reveal="0">
            <div className="plan-k">MONTHLY</div>
            <div className="price-row"><span className="price">{p.monthly}</span><span className="per">/ month</span></div>
            <p className="plan-sub">Billed monthly. Flexible if you&rsquo;re just settling in.</p>
            <Link to={SIGNUP_URL} className="lv-plan-btn">Start monthly</Link>
          </div>
          <div className="lv-plan annual" data-lv-reveal="1">
            <div className="lv-plan-badge">2 MONTHS FREE</div>
            <div className="plan-k">ANNUAL</div>
            <div className="price-row"><span className="price">{p.annual}</span><span className="per">/ year</span></div>
            <p className="plan-sub">That&rsquo;s {p.monthlyEquivalent} a month, for the calmest year yet.</p>
            <Link to={SIGNUP_URL} className="lv-plan-btn fill">Start annual</Link>
          </div>
        </div>
        <div className="lv-plan-notes" data-lv-reveal="2">
          <span><Check />Whole family included</span>
          <span><Check />All features, no tiers</span>
          <span><Check />WhatsApp assistant</span>
          <span><Check />Cancel anytime</span>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="lv-faq">
        <div data-lv-reveal="0" style={{ textAlign: 'center' }}>
          <h2 className="lv-h2">Questions, answered.</h2>
        </div>
        <div className="lv-faq-list" data-lv-reveal="1">
          {faqs.map((f, i) => (
            <div className={`lv-faq-item${openFaq === i ? ' open' : ''}`} key={f.q}>
              <button type="button" className="lv-faq-q" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span className="q">{f.q}</span>
                <span className="chev"><Chevron /></span>
              </button>
              <div className="lv-faq-a">
                <div><p>{f.a}</p></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Download CTA ── */}
      <section id="download" className="lv-cta">
        <div className="lv-cta-panel" data-lv-reveal="0">
          <img className="lv-cta-img" src="/landing/cta-family.jpg" alt="" loading="lazy" />
          <div className="lv-cta-scrim" />
          <h2>Ready for calmer weeks?</h2>
          <p className="lv-cta-sub">Set Housemait up in just a few minutes. Free to get started. The {na ? 'coffee' : 'kettle'} will still be warm.</p>
          <div className="lv-cta-btns">
            <QrLink href={APP_STORE_URL} className="lv-appstore" preferUp ariaLabel="Download Housemait on the App Store — or hover to scan the QR code">
              <svg width="22" height="22" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></svg>
              <span className="lines">
                <span className="l1">DOWNLOAD ON THE</span>
                <span className="l2">App Store</span>
              </span>
            </QrLink>
            <span className="lv-android">Android coming soon</span>
          </div>
          <div className="lv-cta-web">
            <Link to={SIGNUP_URL}>or try Housemait on the web →</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lv-footer">
        <div className="left">
          <img src="/housemait-logo-web.svg" alt="Housemait" />
          <span className="copy">© 2026 Housemait</span>
        </div>
        <div className="links">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Contact</Link>
        </div>
      </footer>
    </div>
  )
}
