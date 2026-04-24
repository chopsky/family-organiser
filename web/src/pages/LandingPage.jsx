import { useEffect, useRef, useState } from 'react'
import '../landing.css'

const SIGNUP_URL = '/signup'
const SIGNIN_URL = '/login'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'WhatsApp', href: '#whatsapp' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

const QUICK_CHIPS = [
  { label: 'Calendar', color: 'var(--purple)' },
  { label: 'Shopping', color: 'var(--sage)' },
  { label: 'Tasks', color: 'var(--coral)' },
  { label: 'Meal plan', color: 'var(--butter)' },
  { label: 'Receipts', color: 'var(--sky)' },
  { label: 'Documents', color: 'var(--pink)' },
  { label: 'WhatsApp', color: '#25D366' },
]

const FAQS = [
  {
    q: 'How does the free trial work?',
    a: "You get full access to every Housemait feature for 30 days — no credit card required to start. We'll only ask for payment details at the end of the trial if you want to continue. If you do nothing, your account simply pauses.",
  },
  {
    q: 'How much does Housemait cost after the trial?',
    a: 'Housemait is £4.99/month or £49/year (which works out to about £4.08/month — roughly 2 months free). Both plans include everything — there are no feature gates. You can switch between plans or cancel anytime.',
  },
  {
    q: 'How does the WhatsApp bot work?',
    a: 'Each family member messages the Housemait bot directly on WhatsApp. Just send a message to add items, assign tasks, plan meals or check the shopping list. The bot understands natural language and even voice notes.',
  },
  {
    q: 'Can I share documents and photos with my household?',
    a: "Yes. Housemait has a secure Documents section where you can upload school letters, appointment slips, receipts, family photos and more. Everyone in the household has access — no more digging through email attachments.",
  },
  {
    q: 'Can I use Housemait without WhatsApp?',
    a: 'Absolutely. The web app has everything you need. WhatsApp is an optional add-on for families who prefer chatting over apps.',
  },
  {
    q: 'How many people can be in a household?',
    a: "There's no limit. Invite as many family members as you need — parents, grandparents, older kids, au pairs, anyone who helps run the household. One subscription covers everyone.",
  },
  {
    q: 'Is my family data safe?',
    a: "Your privacy is paramount. We're fully GDPR compliant, your data is encrypted, and we never sell or share your family's information with third parties.",
  },
]

const PRICING = {
  monthly: { amount: '£4.99', per: '/month', billed: 'Billed monthly after your 30-day trial' },
  annual: { amount: '£49.90', per: '/year', billed: 'Billed annually — 2 months free' },
}

const PLAN_FEATURES = [
  'Unlimited household members',
  'Shared lists, tasks & calendar',
  'AI-powered WhatsApp assistant',
  'School term dates & INSET days',
  'Meal planner & recipe library',
  'Documents & photos vault',
  'Receipt scanner',
  'Weekly family digest',
]

const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const CalendarMock = () => (
  <div className="shot-wrap">
    <div className="mock">
      <div className="mock-head">
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Thursday</div>
          <h4 style={{ marginTop: 2 }}>16 April · Today</h4>
        </div>
        <a className="mock-link">Week →</a>
      </div>
      <ul className="mock-list cal-list">
        <li>
          <span className="cal-time">08:30</span>
          <span className="cal-bar" style={{ background: 'var(--purple)' }} />
          <div style={{ flex: 1 }}>
            <div className="cal-title">School run · Ben</div>
            <div className="cal-meta">Mum · 25 min</div>
          </div>
          <span className="avt" style={{ background: 'var(--purple)' }}>M</span>
        </li>
        <li>
          <span className="cal-time">10:00</span>
          <span className="cal-bar" style={{ background: 'var(--coral)' }} />
          <div style={{ flex: 1 }}>
            <div className="cal-title">Vet · Luna's check-up</div>
            <div className="cal-meta">Dad · 45 min</div>
          </div>
          <span className="avt" style={{ background: 'var(--coral)' }}>D</span>
        </li>
        <li>
          <span className="cal-time">15:45</span>
          <span className="cal-bar" style={{ background: 'var(--sage)' }} />
          <div style={{ flex: 1 }}>
            <div className="cal-title">Swimming · Sofia</div>
            <div className="cal-meta">Mum · 1 hr</div>
          </div>
          <span className="avt" style={{ background: 'var(--sage)' }}>S</span>
        </li>
        <li>
          <span className="cal-time">18:30</span>
          <span className="cal-bar" style={{ background: 'var(--butter)' }} />
          <div style={{ flex: 1 }}>
            <div className="cal-title">Family dinner</div>
            <div className="cal-meta">Everyone · 1 hr</div>
          </div>
        </li>
      </ul>
    </div>
  </div>
)

const TasksMock = () => (
  <div className="shot-wrap coral">
    <div className="mock">
      <div className="mock-head">
        <h4>This week's tasks</h4>
        <a className="mock-link">All →</a>
      </div>
      <ul className="mock-list">
        <li>
          <span className="task-cb done">✓</span>
          <div style={{ flex: 1, textDecoration: 'line-through', color: 'var(--ink-soft)' }}>Book MOT for the Volvo</div>
          <span className="avt" style={{ background: 'var(--coral)' }}>D</span>
        </li>
        <li>
          <span className="task-cb" />
          <div style={{ flex: 1 }}>
            <div>Take bins out</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>Tonight · recurring Thu</div>
          </div>
          <span className="avt" style={{ background: 'var(--sage)' }}>B</span>
        </li>
        <li>
          <span className="task-cb" />
          <div style={{ flex: 1 }}>
            <div>Pick up prescription</div>
            <div style={{ fontSize: 12, color: 'var(--coral)', marginTop: 2, fontWeight: 600 }}>Overdue · due Tue</div>
          </div>
          <span className="avt" style={{ background: 'var(--purple)' }}>M</span>
        </li>
        <li>
          <span className="task-cb" />
          <div style={{ flex: 1 }}>
            <div>Reply to Mrs Walker</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>From forwarded school email</div>
          </div>
          <span className="avt" style={{ background: 'var(--butter)' }}>M</span>
        </li>
        <li>
          <span className="task-cb" />
          <div style={{ flex: 1 }}>Book piano lessons for term 3</div>
          <span className="avt" style={{ background: 'var(--sky)' }}>S</span>
        </li>
      </ul>
    </div>
  </div>
)

const MealsMock = () => (
  <div className="shot-wrap butter">
    <div className="mock">
      <div className="mock-head">
        <h4>This week's meal plan</h4>
        <a className="mock-link">Edit →</a>
      </div>
      <ul className="mock-list">
        <li><span className="day-badge sage">MON</span><span className="meal">Spaghetti Bolognese</span><span className="emoji">🍝</span></li>
        <li><span className="day-badge sage">TUE</span><span className="meal">Shepherd's Pie</span><span className="emoji">🥧</span></li>
        <li><span className="day-badge sage">WED</span><span className="meal">Chicken Stir-fry</span><span className="emoji">🍳</span></li>
        <li><span className="day-badge sage">THU</span><span className="meal">Fish &amp; Chips</span><span className="emoji">🐟</span></li>
        <li><span className="day-badge coral">FRI</span><span className="meal">Pizza Night</span><span className="emoji">🍕</span></li>
        <li><span className="day-badge sage">SAT</span><span className="meal">Roast Chicken</span><span className="emoji">🍗</span></li>
        <li><span className="day-badge sage">SUN</span><span className="meal">Sunday Roast</span><span className="emoji">🥩</span></li>
      </ul>
      <button type="button" className="mock-cta">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h6M9 12h6M9 17h4" /></svg>
        Add all ingredients to shopping list
      </button>
    </div>
  </div>
)

const ShoppingMock = () => (
  <div className="shot-wrap green">
    <div className="mock">
      <div className="mock-head">
        <h4>🛒 Groceries</h4>
        <span className="mock-chip">7 items</span>
      </div>
      <div className="shop-aisle">Meat &amp; Seafood</div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🥩</span>
        <span style={{ flex: 1 }}>Beef sausages</span>
        <span className="shop-qty">2</span>
      </div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🍗</span>
        <span style={{ flex: 1 }}>Chicken frankfurters</span>
      </div>
      <div className="shop-aisle">Produce</div>
      <div className="shop-item">
        <span className="shop-cb done">✓</span>
        <span className="shop-emoji">🥭</span>
        <span style={{ flex: 1, textDecoration: 'line-through', color: 'var(--ink-soft)' }}>Mango</span>
      </div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🍐</span>
        <span style={{ flex: 1 }}>Pears</span>
        <span className="shop-qty">6 pcs</span>
      </div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🥒</span>
        <span style={{ flex: 1 }}>Cucumbers</span>
      </div>
      <div className="shop-aisle">Dairy &amp; Eggs</div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🥚</span>
        <span style={{ flex: 1 }}>Eggs</span>
        <span className="shop-qty">2 pack</span>
      </div>
      <div className="shop-item">
        <span className="shop-cb" />
        <span className="shop-emoji">🥛</span>
        <span style={{ flex: 1 }}>Milk</span>
      </div>
    </div>
  </div>
)

const SchoolTermsMock = () => (
  <div className="shot-wrap coral">
    <div className="mock">
      <div className="mock-head">
        <h4>🏫 School details</h4>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, marginBottom: 20 }}>
        <div className="mock-field">
          <span className="label">School</span>
          <span className="value">Queen Elizabeth's School</span>
        </div>
        <div className="mock-field">
          <span className="label">Year</span>
          <span className="value">Year 4</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--coral)' }}>
          <span>📅</span> Term dates imported
        </div>
        <span className="mock-chip synced">✓ Synced</span>
      </div>
      <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '4px 16px 8px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', margin: '14px 0 4px' }}>2025–2026</div>
        <div className="term-row">
          <span className="term-pill autumn">Autumn</span>
          <div style={{ flex: 1 }}>
            <div className="term-dates">3 Sept – 19 Dec</div>
            <div className="term-half">Half term: 27 Oct – 31 Oct</div>
          </div>
        </div>
        <div className="term-row">
          <span className="term-pill spring">Spring</span>
          <div style={{ flex: 1 }}>
            <div className="term-dates">5 Jan – 10 Apr</div>
            <div className="term-half">Half term: 16 Feb – 20 Feb</div>
          </div>
        </div>
        <div className="term-row">
          <span className="term-pill summer">Summer</span>
          <div style={{ flex: 1 }}>
            <div className="term-dates">4 May – 22 Jul</div>
            <div className="term-half">Half term: 25 May – 29 May</div>
          </div>
        </div>
      </div>
      <div className="mock-warning">⚠️ <span><strong>3 INSET days</strong> added to your calendar</span></div>
    </div>
  </div>
)

const SHOWCASE = [
  {
    id: 'cal',
    eyebrow: <div className="eyebrow-sec">Shared Calendar</div>,
    title: (<>Every date, <em>every&nbsp;body</em>, on one&nbsp;page.</>),
    desc: "See the whole month for the whole family. Filter by person, add shared events in one tap, and get a heads up when two people are double-booked.",
    bullets: ['Colour-coded per family member', 'Syncs with Google, Apple, Outlook', 'Forward a school email — it becomes an event', '"What\'s on today" widget for the fridge tablet'],
    mock: <CalendarMock />,
  },
  {
    id: 'tasks',
    eyebrow: <div className="eyebrow-sec">Tasks</div>,
    title: (<>The mental load, <em>finally</em> split fairly.</>),
    desc: "Columns per family member, so nothing lives in one person's head. Recurring chores repeat themselves. Overdue items nudge gently, not naggingly.",
    bullets: ['Assign by name, not by guilt', 'Recurring tasks (bins, vet, MOT)', 'Kid-safe view for younger family members', 'Weekly digest: who did what'],
    mock: <TasksMock />,
  },
  {
    id: 'meals',
    eyebrow: <div className="eyebrow-sec">Meal Plan</div>,
    title: (<>Sunday planning, <em>finally&nbsp;fun.</em></>),
    desc: "Drag recipes onto the week. Housemait builds the shopping list from the ingredients and remembers what your family keeps coming back to.",
    bullets: ['Breakfast, lunch, dinner + snacks', 'One-tap: ingredients to shopping list', 'Recipe box remembers the family favourites', 'Drag & drop meals across the week'],
    mock: <MealsMock />,
  },
  {
    id: 'shop',
    eyebrow: <div className="eyebrow-sec">Shopping</div>,
    title: (<>A list that <em>sorts</em> itself.</>),
    desc: "Items auto-group into sensible categories — produce, dairy, meat — so the list reads in the order you shop. Snap a receipt and Housemait automatically checks off everything you've bought.",
    bullets: ['Create as many lists as your family needs', 'Smart categories keep items grouped sensibly', 'Receipt scanning in 2 seconds', '"Previously purchased" memory'],
    mock: <ShoppingMock />,
  },
  {
    id: 'terms',
    eyebrow: <div className="eyebrow-sec">School Term Dates</div>,
    title: (<>UK school term dates, <em>imported in one&nbsp;click.</em></>),
    desc: "Select your child's school and Housemait automatically imports all term dates, half terms, and INSET days straight into your family calendar.",
    bullets: ['Search any school in England, Scotland, Wales & NI', 'Term dates, half terms & INSET days imported automatically', 'Syncs with your family calendar so nothing clashes', 'Supports multiple children at different schools'],
    mock: <SchoolTermsMock />,
  },
]

function Showcase() {
  const [active, setActive] = useState(0)
  const trigRefs = useRef([])

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) setActive(Number(e.target.dataset.idx))
        })
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    )
    trigRefs.current.forEach(el => el && obs.observe(el))
    return () => obs.disconnect()
  }, [])

  const Panel = ({ it }) => (
    <>
      {it.eyebrow}
      <h3>{it.title}</h3>
      <p>{it.desc}</p>
      <ul className="bullets">
        {it.bullets.map(b => (<li key={b}><span className="check">✓</span> {b}</li>))}
      </ul>
      {it.ctaLabel && (
        <a href={it.ctaHref === 'SIGNUP' ? SIGNUP_URL : it.ctaHref} className="btn btn-primary" style={{ marginTop: 28 }}>{it.ctaLabel}</a>
      )}
    </>
  )

  return (
    <section className="section-white sec-block showcase" id="how">
      <div className="showcase-pin">
        <div className="showcase-stage">
          <div className="wrap showcase-grid">
            <div className="showcase-left">
              {SHOWCASE.map((it, i) => (
                <div key={it.id} className={`showcase-panel col-text${active === i ? ' on' : ''}`}>
                  <Panel it={it} />
                </div>
              ))}
            </div>
            <div className="showcase-right">
              {SHOWCASE.map((it, i) => (
                <div key={it.id} className={`showcase-mock${active === i ? ' on' : ''}`}>
                  {it.mock}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="showcase-trigs" aria-hidden="true">
          {SHOWCASE.map((_, i) => (
            <div
              key={i}
              ref={el => (trigRefs.current[i] = el)}
              data-idx={i}
              className="showcase-trig"
              style={{ top: `${i * 80}vh` }}
            />
          ))}
        </div>
      </div>
      <div className="wrap showcase-mobile">
        {SHOWCASE.map(it => (
          <div key={it.id} className="showcase-mitem">
            <div className="col-text"><Panel it={it} /></div>
            <div className="showcase-mitem-mock">{it.mock}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function LandingPage() {
  const [billing, setBilling] = useState('monthly')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showFab, setShowFab] = useState(false)
  const price = PRICING[billing]

  useEffect(() => {
    const onScroll = () => setShowFab(window.scrollY > 1500)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lp-v2">
      {/* NAV */}
      <nav className="top">
        <div className="wrap inner">
          <a className="logo" href="#">
            <img src="/assets/logo.png" alt="housemait" />
          </a>
          <ul>
            {NAV_LINKS.map(l => (
              <li key={l.href}><a href={l.href}>{l.label}</a></li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a href={SIGNIN_URL} className="btn btn-ghost">Sign in</a>
            <a href={SIGNUP_URL} className="btn btn-primary">Start free trial</a>
            <button
              type="button"
              className="nav-toggle"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? (
                  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                ) : (
                  <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
                )}
              </svg>
            </button>
          </div>
        </div>
        <div className={`mobile-menu${menuOpen ? ' open' : ''}`}>
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
          ))}
          <a href={SIGNIN_URL} onClick={() => setMenuOpen(false)}>Sign in</a>
          <a href={SIGNUP_URL} className="btn btn-primary" style={{ marginTop: 12, justifyContent: 'center' }} onClick={() => setMenuOpen(false)}>Start 30-day free trial</a>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">
              <span className="dot" style={{ background: '#25D366', boxShadow: '0 0 0 4px rgba(37,211,102,.22)' }} />
              New · WhatsApp AI assistant for your household
            </span>
            <h1 className="display">
              The quiet hum<br />
              of a <em>family</em> that<br />
              actually runs&nbsp;on&nbsp;time.
            </h1>
            <p className="lede">
              Housemait is the AI that holds your family's calendar, shopping, tasks and meals in one place — and answers on WhatsApp — so the mental load stops landing on one person.
            </p>
            <div className="hero-cta">
              <a href={SIGNUP_URL} className="btn btn-primary">
                Start 30-day free trial <ArrowRight />
              </a>
            </div>
            <div className="hero-meta">
              <span className="stars">★★★★★</span>
              <span>4.9 · 2,100+ families</span>
              <span className="divider" />
              <span>No credit card to start</span>
            </div>
            <div className="quicks">
              {QUICK_CHIPS.map(c => (
                <span className="chip" key={c.label}>
                  <span className="cdot" style={{ background: c.color }} />
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          <div className="collage" aria-hidden="false">
            <div className="blob" />
            <div className="blob2" />
            <div className="photo">
              <img src="/assets/family-hero.png" alt="Family laughing together in the kitchen" />
            </div>
            <div className="app">
              <div className="app-mock">
                <div className="app-mock-head">
                  <div className="kicker">Tuesday · 21 April</div>
                  <div className="greet">Good morning, <em>everyone.</em></div>
                </div>
                <div className="app-mock-sec">
                  <div className="app-mock-sec-head"><span>Today</span><span className="meta">4 events</span></div>
                  <div className="app-mock-row">
                    <span className="bar" style={{ background: 'var(--purple)' }} />
                    <span className="time">08:30</span>
                    <span className="title">School run · Ben</span>
                  </div>
                  <div className="app-mock-row">
                    <span className="bar" style={{ background: 'var(--coral)' }} />
                    <span className="time">10:00</span>
                    <span className="title">Vet · Luna</span>
                  </div>
                  <div className="app-mock-row">
                    <span className="bar" style={{ background: 'var(--sage)' }} />
                    <span className="time">15:45</span>
                    <span className="title">Swimming · Sofia</span>
                  </div>
                </div>
                <div className="app-mock-sec">
                  <div className="app-mock-sec-head"><span>Tonight</span></div>
                  <div className="app-mock-meal">
                    <span className="em">🍝</span>
                    <span className="mt">One-pot pasta</span>
                    <span className="ready">Ready</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="sticker s1">
              <div className="ic">✓</div>
              <div>Beef sausages<br /><span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Added to shopping list</span></div>
            </div>
            <div className="sticker s2">
              <div className="ic">🍝</div>
              <div>Pasta night<br /><span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Planned for Tuesday</span></div>
            </div>
            <div className="sticker s3">
              <div className="ic">✦</div>
              <div style={{ fontSize: 12.5 }}>Receipt scanned in 2s</div>
            </div>
          </div>
        </div>
      </header>

      {/* FEATURE STRIP */}
      <section className="strip" id="features">
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 40, flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div className="eyebrow-sec">Everything in one place</div>
              <h2 className="sec" style={{ margin: 0 }}>
                Your home <em>intelligently&nbsp;organised</em> with AI.
              </h2>
            </div>
            <p style={{ maxWidth: 360, color: 'var(--ink-soft)', margin: 0 }}>
              From Sunday meal plans to Friday dentist reminders — Housemait keeps the whole house in sync.
            </p>
          </div>
          <div className="feat-grid">
            <div className="feat c1">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <h3>Shared calendar</h3>
              <p>One month view for everyone in the house. Layer events by person, colour-coded, with conflict detection.</p>
            </div>
            <div className="feat c2">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
              </div>
              <h3>Smart shopping</h3>
              <p>Auto-sorted into categories and shared with the whole household in real time. Add items by voice, photo or meal plan.</p>
            </div>
            <div className="feat c3">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              </div>
              <h3>Family tasks</h3>
              <p>Columns per person, recurring chores, and gentle nudges. The laundry never gets lost in a group&nbsp;chat again.</p>
            </div>
            <div className="feat c4">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11h.01M11 15h.01M16 16h.01M3 3h7v7H3z" /><path d="M14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" /></svg>
              </div>
              <h3>Meal planning</h3>
              <p>Drag from your recipe box, auto-generate the shop, reuse last week's favourites. Dinner sorted by Sunday.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI PROMPT SHOWCASE */}
      <section className="sec-block">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="eyebrow-sec">The AI that gets the brief</div>
            <h2 className="sec" style={{ margin: '0 auto 16px' }}>
              Just tell it what's happening. <em>It&nbsp;does&nbsp;the&nbsp;rest.</em>
            </h2>
            <p className="sec-lede" style={{ margin: '0 auto' }}>
              Type, snap, or forward an email. Housemait turns real life into the right calendar entry, shopping line, task, or meal.
            </p>
          </div>

          <div className="ai-demo">
            <div className="ai-input">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
              <div className="txt">"Finn has a dentist on Thursday at 4, and we're out of milk — and let's plan three easy dinners this week"</div>
              <div className="send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
              </div>
            </div>

            <div className="ai-results">
              <div className="aicard">
                <div className="head">
                  <span className="pill" style={{ background: 'var(--purple-soft)', color: 'var(--purple-deep)' }}>Calendar</span>
                  Thu 30 April
                </div>
                <div className="title">Finn — Dentist</div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>4:00 PM · 45 min<br />📍 Bellingham Dental, Bristol</div>
                <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid rgba(27,20,36,.06)', fontSize: 13, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--purple)' }} />
                  Reminder set for 30 min before
                </div>
              </div>
              <div className="aicard">
                <div className="head">
                  <span className="pill" style={{ background: 'var(--sage-soft)', color: '#3f6b3a' }}>Shopping</span>
                  Added to list
                </div>
                <div className="title">2 items auto-categorised</div>
                <ul>
                  <li>
                    <span className="cb" />
                    <span style={{ background: 'var(--sky-soft)', padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase', color: '#4a6a94' }}>Dairy</span>
                    Milk · 2L
                  </li>
                  <li>
                    <span className="cb" />
                    <span style={{ background: 'var(--coral-soft)', padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase', color: '#a84522' }}>Meat</span>
                    Chicken · 1kg
                  </li>
                </ul>
              </div>
              <div className="aicard">
                <div className="head">
                  <span className="pill" style={{ background: 'var(--butter-soft)', color: '#8a5c1a' }}>Meals</span>
                  This week
                </div>
                <div className="title">3 dinners planned</div>
                <ul>
                  <li>🍝 Tue — One-pot pasta</li>
                  <li>🌮 Wed — Sheet-pan fajitas</li>
                  <li>🍛 Thu — Quick butter chicken</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHATSAPP */}
      <section id="whatsapp" className="section-white sec-block">
        <div className="wrap">
          <div className="wa-section">
            <div className="wa-grid">
              <div>
                <span className="wa-badge">
                  <span className="ic">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.46 0 .1 5.34.1 11.9c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.65a11.9 11.9 0 0 0 5.75 1.47h.01c6.59 0 11.94-5.34 11.94-11.9a11.8 11.8 0 0 0-3.48-8.44z" /></svg>
                  </span>
                  WhatsApp AI Assistant
                </span>
                <h3 style={{ fontFamily: "'Instrument Serif',serif", fontWeight: 400, fontSize: 'clamp(36px,4.4vw,56px)', lineHeight: 1.05, letterSpacing: '-.015em', margin: '18px 0' }}>
                  Your family's AI assistant, <em style={{ fontStyle: 'italic', color: 'var(--purple)' }}>right in WhatsApp.</em>
                </h3>
                <p style={{ color: 'var(--ink-soft)', fontSize: 17, maxWidth: 480, margin: 0 }}>
                  No new app to learn. Just message the Housemait bot on WhatsApp and it takes care of the rest. It's like having a personal assistant that never sleeps.
                </p>
                <ul className="bullets" style={{ marginTop: 28 }}>
                  <li><span className="check">✓</span> Add items to your shopping list by just texting</li>
                  <li><span className="check">✓</span> Create and assign tasks to family members</li>
                  <li><span className="check">✓</span> Plan meals and get recipe suggestions</li>
                  <li><span className="check">✓</span> Send voice notes — we'll transcribe them into actions</li>
                </ul>
              </div>
              <div style={{ position: 'relative' }}>
                <div className="wa-phone">
                  <div className="wa-head">
                    <div className="wa-avatar">hm</div>
                    <div>
                      <div className="wa-name">housemait</div>
                      <div className="wa-status">Family Bot · online</div>
                    </div>
                  </div>
                  <div className="wa-log">
                    <div className="wa-bubble out">Can you add milk, bread and eggs to the shopping list?<span className="t">7:42 ✓✓</span></div>
                    <div className="wa-bubble in">
                      <div className="sys">✓ Added to list</div>
                      Done! I've added 3 items:<br />• Milk (dairy)<br />• Bread (bakery)<br />• Eggs (dairy)<br /><br />Anything else?
                      <span className="t">7:42</span>
                    </div>
                    <div className="wa-bubble out">What's for dinner tonight?<span className="t">7:43 ✓✓</span></div>
                    <div className="wa-bubble in">
                      Tonight's meal plan: Chicken stir-fry 🥢<br /><br />Need me to add the ingredients to your shopping list?
                      <span className="t">7:43</span>
                    </div>
                    <div className="wa-bubble out" style={{ padding: '8px 12px' }}>
                      <div className="wa-voice">
                        <span className="mic">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2" /></svg>
                        </span>
                        <span className="wave">
                          {[5, 12, 7, 16, 9, 4, 14, 8, 11, 6, 15, 10, 7, 13, 5, 17, 9, 12, 6, 10, 14, 8].map((h, i) => (
                            <span key={i} className={i < 9 ? 'played' : ''} style={{ height: h }} />
                          ))}
                        </span>
                        <span className="dur">0:03</span>
                      </div>
                      <span className="t">7:44 ✓✓</span>
                    </div>
                    <div className="wa-bubble in">Got it! I've added "Pick up dry cleaning" to Sarah's tasks for tomorrow.<span className="t">7:44</span></div>
                  </div>
                </div>
                <div className="wa-float-sticker" style={{ top: -14, right: '6%', transform: 'rotate(4deg)', background: 'var(--coral-soft)', color: '#a84522' }}>3 items added ✓</div>
                <div className="wa-float-sticker" style={{ top: '34%', left: '-6%', transform: 'rotate(-4deg)', background: 'var(--sage-soft)', color: '#2e5a2a' }}>Meal planned 🍽️</div>
                <div className="wa-float-sticker" style={{ bottom: '8%', right: '-4%', transform: 'rotate(3deg)', background: 'var(--purple-soft)', color: 'var(--purple-deep)' }}>Task assigned to Dad</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Showcase />

      {/* TESTIMONIALS */}
      <section id="stories" className="section-cream sec-block">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="eyebrow-sec">Loved by actual parents</div>
            <h2 className="sec" style={{ margin: '0 auto' }}>
              A little more <em>calm,</em><br />a lot fewer group&nbsp;chats.
            </h2>
          </div>
          <div className="testis">
            <div className="testi">
              <div className="stars">★★★★★</div>
              <blockquote>"The Sunday planning argument is over. We do it in 12 minutes with a coffee. I didn't realise how much of it I was carrying alone."</blockquote>
              <div className="who">
                <div className="avatar">SK</div>
                <div>
                  <div className="name">Sarah K.</div>
                  <div className="role">Mum of 3 · Bristol</div>
                </div>
              </div>
            </div>
            <div className="testi hl">
              <div className="stars">★★★★★</div>
              <blockquote>"I forwarded a school PDF to Housemait at 10pm. By morning every date was on the calendar, and the permission slip was on my task list. Magic."</blockquote>
              <div className="who">
                <div className="avatar">JM</div>
                <div>
                  <div className="name">James M.</div>
                  <div className="role">Dad of 2 · Manchester</div>
                </div>
              </div>
            </div>
            <div className="testi">
              <div className="stars">★★★★★</div>
              <blockquote>"We were the 14-apps-and-a-whiteboard family. Now it's one app and we actually sit down at dinner together. That's the real review."</blockquote>
              <div className="who">
                <div className="avatar">PR</div>
                <div>
                  <div className="name">Priya R.</div>
                  <div className="role">Mum of 2 · London</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* PRICING */}
      <section id="pricing" className="section-white sec-block">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div className="eyebrow-sec">Pricing</div>
            <h2 className="sec" style={{ margin: '0 auto' }}>
              Less than a <em>takeaway</em> a month.
            </h2>
            <p className="sec-lede" style={{ margin: '14px auto 0' }}>
              30-day free trial. Cancel any time. One plan covers your whole household.
            </p>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="billing-toggle" role="tablist">
              <button
                type="button"
                className={billing === 'monthly' ? 'active' : ''}
                onClick={() => setBilling('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={billing === 'annual' ? 'active' : ''}
                onClick={() => setBilling('annual')}
              >
                Annual <span className="save">SAVE 17%</span>
              </button>
            </div>
          </div>

          <div className="single-plan">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Housemait</div>
              <div style={{ color: 'var(--ink-soft)', fontSize: 14.5 }}>Everything your household needs</div>
              <div className="price-display">
                <span className="amount">{price.amount}</span>
                <span className="per">{price.per}</span>
              </div>
              <div className="billed">{price.billed}</div>
            </div>
            <ul>
              {PLAN_FEATURES.map(f => (
                <li key={f}><span className="check">✓</span> {f}</li>
              ))}
            </ul>
            <a href={SIGNUP_URL} className="btn btn-primary">Start your free 30-day trial</a>
          </div>

          <div style={{ display: 'flex', gap: 28, justifyContent: 'center', flexWrap: 'wrap', marginTop: 36, color: 'var(--ink-soft)', fontSize: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--sage)', fontWeight: 700 }}>✓</span> 30-day free trial</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--sage)', fontWeight: 700 }}>✓</span> No credit card to start</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--sage)', fontWeight: 700 }}>✓</span> Cancel anytime</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--sage)', fontWeight: 700 }}>✓</span> GDPR compliant</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="section-cream sec-block">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="eyebrow-sec">FAQ</div>
            <h2 className="sec" style={{ margin: '0 auto' }}>Questions, <em>answered.</em></h2>
          </div>
          <div className="faq">
            {FAQS.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>{f.q}</summary>
                <div className="answer">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="sec-block" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta">
            <div className="bg1" />
            <div className="bg2" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h2>Give your family<br />a <em>quieter</em> week.</h2>
              <p>Set Housemait up in under 5 minutes. Most families feel lighter by Sunday.</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a href={SIGNUP_URL} className="btn btn-primary">Start 30-day free trial</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="site">
        <div className="wrap">
          <div className="fgrid">
            <div>
              <img src="/assets/logo.png" alt="housemait" style={{ height: 26 }} />
              <p className="tag">Family life, organised. AI-powered household management for modern UK families.</p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#whatsapp">WhatsApp Bot</a></li>
                <li><a href="#pricing">Pricing</a></li>
                <li><a href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4>Company</h4>
              <ul>
                <li><a href="https://housemait.com/privacy">Privacy Policy</a></li>
                <li><a href="https://housemait.com/terms">Terms of Service</a></li>
                <li><a href="mailto:hello@housemait.com">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4>Get Started</h4>
              <ul>
                <li><a href={SIGNUP_URL}>Sign Up</a></li>
                <li><a href={SIGNIN_URL}>Log In</a></li>
              </ul>
            </div>
          </div>
          <div className="bottom">
            <span>© {new Date().getFullYear()} Housemait. All rights reserved.</span>
            <span>Made with ❤️ for UK families</span>
          </div>
        </div>
      </footer>

      <a href={SIGNUP_URL} className={`fab-cta${showFab ? ' show' : ''}`}>
        Get Started <ArrowRight />
      </a>
    </div>
  )
}
