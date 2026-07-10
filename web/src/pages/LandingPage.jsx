import { useEffect, useRef, useState } from 'react'
import '../landing.css'
import { useLocale } from '../hooks/useLocale'
import HreflangTags from '../components/HreflangTags'
import { APP_STORE_URL, APP_STORE_CONFIGURED, isIos } from '../lib/app-store'

const SIGNUP_URL = '/signup'
const SIGNIN_URL = '/login'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'WhatsApp', href: '#whatsapp' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

/** Build the FAQ list with pricing strings interpolated from the active
 *  locale. Most answers don't reference price/region, so they're shared
 *  verbatim across locales; only the pricing answer varies. */
function buildFaqs(locale) {
  const p = locale.pricing
  return [
    {
      q: 'How does the free trial work?',
      a: "You get full access to every Housemait feature for 30 days, no credit card required to start. We'll only ask for payment details at the end of the trial if you want to continue. If you do nothing, your account simply pauses.",
    },
    {
      q: 'How much does Housemait cost after the trial?',
      a: `Housemait is ${p.monthly}/month or ${p.annual}/year (which works out to about ${p.monthlyEquivalent}/month, roughly 2 months free). Both plans include everything. There are no feature gates. You can switch between plans or cancel anytime.`,
    },
    {
      q: 'How does the WhatsApp bot work?',
      a: 'Each family member messages the Housemait bot directly on WhatsApp. Just send a message to add items, assign tasks, plan meals or check the shopping list. The bot understands natural language and even voice notes.',
    },
    {
      q: 'Can I share documents and photos with my household?',
      a: "Yes. Housemait has a secure Documents section where you can upload school letters, appointment slips, receipts, family photos and more. Everyone in the household has access, so no more digging through email attachments.",
    },
    {
      q: 'Can I use Housemait without WhatsApp?',
      a: 'Absolutely. The web app has everything you need. WhatsApp is an optional add-on for families who prefer chatting over apps.',
    },
    {
      q: 'How many people can be in a household?',
      a: "There's no limit. Invite as many family members as you need: parents, grandparents, older kids, au pairs, anyone who helps run the household. One subscription covers everyone.",
    },
    {
      q: 'Is my family data safe?',
      a: "Your privacy is paramount. We're fully GDPR compliant, your data is encrypted, and we never sell or share your family's information with third parties.",
    },
  ]
}

/** Build the two pricing cards (monthly / annual) from the locale's
 *  pricing strings. The billing-frequency labels are locale-agnostic, so
 *  they stay hardcoded. */
function buildPricing(locale) {
  return {
    monthly: { amount: locale.pricing.monthly, per: '/month', billed: 'Billed monthly after your 30-day trial' },
    annual:  { amount: locale.pricing.annual,  per: '/year',  billed: 'Billed annually. 2 months free' },
  }
}

/** Pricing-card feature list. The school-terms bullet is UK-only -
 *  see locale.schoolTerms - so the list is built dynamically. */
function buildPlanFeatures(locale) {
  const features = [
    'Unlimited household members',
    'Shared lists, tasks & calendar',
    'AI-powered WhatsApp assistant',
  ]
  // School-terms line text comes from the active locale (UK calls them
  // "INSET days"; SA calls them "holidays"). Locales without a
  // schoolTerms config omit the line entirely.
  if (locale.schoolTerms?.planFeature) {
    features.push(locale.schoolTerms.planFeature)
  }
  features.push(
    'Meal planner & recipe library',
    'Documents & photos vault',
    'Receipt scanner',
    'Weekly family digest',
  )
  return features
}

/** Testimonial quotes - universal across locales. The reviewer names,
 *  roles, and cities are localised via `locale.reviews` so an Austin
 *  parent doesn't see "Bristol" in the social proof set. The order
 *  here matters: REVIEW_QUOTES[i] pairs with locale.reviews[i]. */
const REVIEW_QUOTES = [
  "The Sunday planning argument is over. We do it in 12 minutes with a coffee. I didn't realise how much of it I was carrying alone.",
  "I forwarded a school PDF to Housemait at 10pm. By morning every date was on the calendar, and the permission slip was on my task list. Magic.",
  "We were the 14-apps-and-a-whiteboard family. Now it's one app and we actually sit down at dinner together. That's the real review.",
]

const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Calendar mock for the showcase. parentTerm is locale-dependent
 *  (Mum vs Mom) and only appears on the assignee meta line of two of
 *  the sample events. Default keeps the historical UK wording. */
const CalendarMock = ({ parentTerm = 'Mum' }) => (
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
            <div className="cal-meta">{parentTerm} · 25 min</div>
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
            <div className="cal-meta">{parentTerm} · 1 hr</div>
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

/** Tasks mock for the showcase. completedTask is the line-through item
 *  at the top - locale-dependent because "Book MOT for the Volvo"
 *  doesn't translate (US says "oil change", AU says "rego inspection",
 *  ZA says "car service" etc). Default keeps the historical UK wording. */
const TasksMock = ({ completedTask = 'Book MOT for the Volvo' }) => (
  <div className="shot-wrap coral">
    <div className="mock">
      <div className="mock-head">
        <h4>This week's tasks</h4>
        <a className="mock-link">All →</a>
      </div>
      <ul className="mock-list">
        <li>
          <span className="task-cb done">✓</span>
          <div style={{ flex: 1, textDecoration: 'line-through', color: 'var(--ink-soft)' }}>{completedTask}</div>
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

/** School-terms feature mock. The data shape is dictated by
 *  locale.schoolTerms.mock - see /lib/locales.js for the source of truth.
 *  Takes a `data` prop rather than reading the locale itself so the mock
 *  stays a pure rendering component (easier to test in isolation, no
 *  hook dependency). */
const SchoolTermsMock = ({ data }) => {
  if (!data) return null
  return (
    <div className="shot-wrap coral">
      <div className="mock">
        <div className="mock-head">
          <h4>🏫 School details</h4>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: data.yearLabel ? '1fr 100px' : '1fr', gap: 10, marginBottom: 20 }}>
          <div className="mock-field">
            <span className="label">School</span>
            <span className="value">{data.schoolName}</span>
          </div>
          {data.yearLabel && (
            <div className="mock-field">
              <span className="label">{data.yearLabel}</span>
              <span className="value">{data.yearValue}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--coral)' }}>
            <span>📅</span> Term dates imported
          </div>
          <span className="mock-chip synced">✓ Synced</span>
        </div>
        <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '4px 16px 8px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', margin: '14px 0 4px' }}>{data.academicYear}</div>
          {data.terms.map((term) => (
            <div className="term-row" key={term.name}>
              <span className={`term-pill ${term.pillClass}`}>{term.name}</span>
              <div style={{ flex: 1 }}>
                <div className="term-dates">{term.dates}</div>
                {term.breakDates && (
                  <div className="term-half">{term.breakLabel}: {term.breakDates}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {data.warning && (
          <div className="mock-warning"><span>{data.warning}</span></div>
        )}
      </div>
    </div>
  )
}

const SHOWCASE = [
  {
    id: 'cal',
    eyebrow: <div className="eyebrow-sec">Shared Calendar</div>,
    title: (<>Every date, <em>every&nbsp;body</em>, on one&nbsp;page.</>),
    desc: "No more surprise birthday parties you found out about the night before. See the whole month for the whole family, add shared events in one tap, and get a heads-up when two people are double-booked.",
    bullets: ['Colour-coded per family member', 'Connects with Google, Apple, Outlook', 'Forward a school email and it becomes an event', '"What\'s on today" widget for the fridge tablet'],
    mock: <CalendarMock />,
  },
  {
    id: 'tasks',
    eyebrow: <div className="eyebrow-sec">Tasks</div>,
    title: (<>The mental load, <em>finally</em> split fairly.</>),
    desc: "Columns per family member, so nothing lives in one person's head. Recurring chores repeat themselves, and Housemait does the chasing, so nobody has to be the nag.",
    bullets: ['Assign by name, not by guilt', 'Recurring tasks (bins, vet, MOT)', 'Kid-safe view for younger family members', 'Weekly digest: who did what'],
    mock: <TasksMock />,
  },
  {
    id: 'meals',
    eyebrow: <div className="eyebrow-sec">Meal Plan</div>,
    title: (<>Sunday planning, <em>finally&nbsp;fun.</em></>),
    desc: "No more staring into the fridge at 5pm. Drag recipes onto the week, and Housemait builds the shopping list from the ingredients and remembers the meals your family actually eats.",
    bullets: ['Breakfast, lunch, dinner + snacks', 'One-tap: ingredients to shopping list', 'Recipe box remembers the family favourites', 'Drag & drop meals across the week'],
    mock: <MealsMock />,
  },
  {
    id: 'shop',
    eyebrow: <div className="eyebrow-sec">Shopping</div>,
    title: (<>A list that <em>sorts</em> itself.</>),
    desc: "No more doubling back to the dairy aisle. Items auto-group into categories so the list reads in the order you shop, and snapping the receipt checks off everything you've bought.",
    bullets: ['Create as many lists as your family needs', 'Smart categories keep items grouped sensibly', 'Receipt scanning in 2 seconds', '"Previously purchased" memory'],
    mock: <ShoppingMock />,
  },
  // The 'terms' entry is appended in the component body when the active
  // locale has schoolTerms content configured (currently GB + ZA). Each
  // locale brings its own title prefix, bullets, and mock data so the
  // section advertises a country-appropriate school calendar.
]

/** Build the locale-specific school-terms showcase item from
 *  locale.schoolTerms data, or return null if the locale doesn't have
 *  school terms enabled. */
function buildSchoolTermsItem(locale) {
  const st = locale.schoolTerms
  if (!st) return null
  return {
    id: 'terms',
    eyebrow: <div className="eyebrow-sec">School Term Dates</div>,
    title: (<>{st.titlePrefix}, <em>imported in one&nbsp;click.</em></>),
    desc: st.desc,
    bullets: st.bullets,
    mock: <SchoolTermsMock data={st.mock} />,
  }
}

function Showcase({ items }) {
  const [active, setActive] = useState(0)
  const trigRefs = useRef([])
  const pinRef = useRef(null)

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
  }, [items])

  // Plain feature name for a dot's label — pulled from the eyebrow node
  // (e.g. "Shared Calendar"), with a numeric fallback.
  const dotLabel = (it, i) => {
    const text = it?.eyebrow?.props?.children
    return typeof text === 'string' ? text : `Feature ${i + 1}`
  }

  // Clicking a dot scrolls to the band of the pinned section where that
  // feature is active. We compute the target manually and clamp it into
  // the stage's pinned range rather than scrollIntoView-ing the trigger:
  // each trigger is 80vh tall and trigger 0 sits at the pin's top, so
  // centring it resolves to ~10vh ABOVE the pin, which un-sticks the
  // stage and reads as an unwanted jump upward. Clamping the target to
  // >= the pin's top keeps the stage pinned for every dot.
  const goToFeature = (i) => {
    const pin = pinRef.current
    if (!pin || typeof window === 'undefined') return
    const vh = window.innerHeight
    const pinTop = pin.getBoundingClientRect().top + window.scrollY
    const maxStick = pinTop + pin.offsetHeight - vh
    // Trigger i (80vh tall) centres in the viewport at this scroll offset.
    const target = pinTop + (i * 0.8 - 0.1) * vh
    const clamped = Math.max(pinTop, Math.min(target, maxStick))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: clamped, behavior: reduce ? 'auto' : 'smooth' })
  }

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
      <div className="showcase-pin" ref={pinRef}>
        <div className="showcase-stage">
          <div className="wrap showcase-grid">
            <div className="showcase-left">
              {items.map((it, i) => (
                <div key={it.id} className={`showcase-panel col-text${active === i ? ' on' : ''}`}>
                  <Panel it={it} />
                </div>
              ))}
            </div>
            <div className="showcase-right">
              {items.map((it, i) => (
                <div key={it.id} className={`showcase-mock${active === i ? ' on' : ''}`}>
                  {it.mock}
                </div>
              ))}
            </div>
          </div>
          <nav className="showcase-dots" aria-label="Feature navigation">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`showcase-dot${active === i ? ' on' : ''}`}
                aria-label={`Go to ${dotLabel(it, i)}`}
                aria-current={active === i ? 'true' : undefined}
                onClick={() => goToFeature(i)}
              />
            ))}
          </nav>
        </div>
        <div className="showcase-trigs" aria-hidden="true">
          {items.map((_, i) => (
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
        {items.map(it => (
          <div key={it.id} className="showcase-mitem">
            <div className="col-text"><Panel it={it} /></div>
            <div className="showcase-mitem-mock">{it.mock}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** "Download App" pill + QR popover with auto-flip placement.
 *
 * Defaults to popover-below-button. On pointer/keyboard activation we
 * measure how much space is below the wrapper in the viewport and
 * flip the popover above the button when there isn't enough room.
 * Why on activation rather than at mount: the visitor may scroll
 * between renders and the popover's correct placement depends on the
 * button's *current* viewport position, not its position when the
 * page first painted.
 *
 * The pill is a <button>, not a link — clicking does nothing. The
 * QR is the affordance. type="button" keeps it Tab-focusable, so
 * keyboard users can also reveal the popover via :focus-within.
 */
function DownloadQR({ preferUp = false }) {
  const wrapperRef = useRef(null)
  const [placement, setPlacement] = useState(preferUp ? 'top' : 'bottom')

  const recompute = () => {
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // ~200 = popover height (182) + gap (12) + small buffer.
    const NEED = 200
    if (preferUp) {
      // Used inside the bottom CTA card, which has overflow:hidden — a
      // downward popover would be clipped by the card edge. Open upward
      // (into the card, over the heading) and only fall back to below if
      // there genuinely isn't room above.
      setPlacement(rect.top < NEED ? 'bottom' : 'top')
    } else {
      // If less than NEED fits below the button before the viewport edge,
      // flip the popover above the button instead.
      setPlacement(window.innerHeight - rect.bottom < NEED ? 'top' : 'bottom')
    }
  }

  return (
    <span
      ref={wrapperRef}
      className="download-pill-wrapper"
      data-placement={placement}
      onMouseEnter={recompute}
      onFocus={recompute}
    >
      <a
        href={APP_STORE_URL}
        className="btn btn-primary download-pill"
        aria-label="Download Housemait on the App Store, or hover to scan the QR code"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M17.05 12.54c-.03-3.05 2.49-4.51 2.6-4.58-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.66 1.1-4.6 1.1-.95 0-2.42-1.07-3.98-1.04-2.05.03-3.94 1.19-4.99 3.02-2.13 3.7-.54 9.17 1.53 12.17 1.02 1.47 2.23 3.12 3.81 3.06 1.54-.06 2.12-.99 3.97-.99 1.85 0 2.38.99 3.99.96 1.65-.03 2.7-1.5 3.7-2.97 1.17-1.7 1.65-3.35 1.67-3.43-.04-.02-3.2-1.23-3.3-4.91zM14.02 3.6c.84-1.02 1.41-2.43 1.25-3.85-1.21.05-2.68.81-3.55 1.83-.78.9-1.46 2.35-1.28 3.73 1.36.11 2.74-.69 3.58-1.71z" />
        </svg>
        Download on the App Store
      </a>
      <span className="qr-popover" role="tooltip">
        <img src="/assets/app-store-qr.svg" alt="QR code linking to the Housemait App Store page" width="150" height="150" />
      </span>
    </span>
  )
}

// Waveform bar heights for the voice-note bubble (px); the first 9 are
// "played" (filled), the rest are upcoming (faint).
const WA_WAVE = [5, 12, 7, 16, 9, 4, 14, 8, 11, 6, 15, 10, 7, 13, 5, 17, 9, 12, 6, 10, 14, 8]

// The scripted WhatsApp exchange shown in the phone mock. `think` is how
// long the bot "types" (ms) before an incoming reply appears.
const WA_MESSAGES = [
  { side: 'out', time: '7:42 ✓✓', body: 'Can you add milk, bread and eggs to the shopping list?' },
  { side: 'in', time: '7:42', think: 1200, body: (
    <>
      <div className="sys">✓ Added to list</div>
      Done! I've added 3 items:<br />• Milk (dairy)<br />• Bread (bakery)<br />• Eggs (dairy)<br /><br />Anything else?
    </>
  ) },
  { side: 'out', time: '7:43 ✓✓', body: "What's for dinner tonight?" },
  { side: 'in', time: '7:43', think: 1200, body: (
    <>Tonight's meal plan: Chicken stir-fry 🥢<br /><br />Need me to add the ingredients to your shopping list?</>
  ) },
  { side: 'out', time: '7:44 ✓✓', voice: true },
  { side: 'in', time: '7:44', think: 1300, body: 'Got it! I\'ve added "Pick up dry cleaning" to Sarah\'s tasks for tomorrow.' },
]

/** Animated WhatsApp phone mock. When the phone scrolls into view the
 *  scripted exchange plays out one message at a time — a typing indicator
 *  precedes each bot reply — with the log anchored to the newest message
 *  so older ones scroll off the top like a real thread. Under
 *  prefers-reduced-motion the full thread renders at once, no timers. */
function WhatsAppPhone() {
  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(false)
  const phoneRef = useRef(null)
  const logRef = useRef(null)
  const timers = useRef([])

  // Keep the thread pinned to the newest message as it plays out (and on
  // the reduced-motion path, open on the latest). The log stays freely
  // scrollable afterwards so you can read back to the start.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [shown, typing])

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(WA_MESSAGES.length); return }

    const el = phoneRef.current
    if (!el) return
    let started = false
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting || started) return
        started = true
        let delay = 450
        WA_MESSAGES.forEach((m, i) => {
          if (m.side === 'in') {
            timers.current.push(setTimeout(() => setTyping(true), delay))
            delay += m.think || 1100
            timers.current.push(setTimeout(() => { setTyping(false); setShown(i + 1) }, delay))
            delay += 650
          } else {
            timers.current.push(setTimeout(() => setShown(i + 1), delay))
            delay += 800
          }
        })
      })
    }, { threshold: 0.35 })
    io.observe(el)
    return () => { io.disconnect(); timers.current.forEach(clearTimeout) }
  }, [])

  return (
    <div className="wa-phone" ref={phoneRef}>
      <div className="wa-head">
        <img className="wa-avatar" src="/housemait-iOS-icon.png" alt="housemait" />
        <div>
          <div className="wa-name">housemait</div>
          <div className="wa-status">Family Bot · online</div>
        </div>
      </div>
      <div className="wa-log" ref={logRef}>
        {WA_MESSAGES.slice(0, shown).map((m, i) => (
          <div key={i} className={`wa-bubble ${m.side}`} style={m.voice ? { padding: '8px 12px' } : undefined}>
            {m.voice ? (
              <div className="wa-voice">
                <span className="mic">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2" /></svg>
                </span>
                <span className="wave">
                  {WA_WAVE.map((h, j) => (<span key={j} className={j < 9 ? 'played' : ''} style={{ height: h }} />))}
                </span>
                <span className="dur">0:03</span>
              </div>
            ) : m.body}
            <span className="t">{m.time}</span>
          </div>
        ))}
        {typing && (
          <div className="wa-bubble in wa-typing">
            <span className="wa-dots"><i /><i /><i /></span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LandingPage() {
  const locale = useLocale()
  const [billing, setBilling] = useState('monthly')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showFab, setShowFab] = useState(false)
  // iOS detection drives the hero CTA swap (App Store as primary,
  // trial as secondary). We compute on mount rather than at render to
  // avoid SSR/hydration mismatches if we ever pre-render. Hidden
  // entirely until the App Store ID is configured so we never ship a
  // broken Apple link to production.
  const [iosVisitor, setIosVisitor] = useState(false)
  useEffect(() => {
    if (APP_STORE_CONFIGURED) setIosVisitor(isIos())
  }, [])
  const pricing = buildPricing(locale)
  const price = pricing[billing]
  const faqs = buildFaqs(locale)
  const planFeatures = buildPlanFeatures(locale)
  // Feature scrollytelling - three locale-aware overrides on the
  // SHOWCASE entries:
  //   • cal:   the assignee meta line on two events ("Mum" vs "Mom")
  //   • tasks: the line-through completed task ("Book MOT for the Volvo"
  //            vs locale-specific equivalent), plus the recurring-tasks
  //            bullet ("(bins, vet, MOT)" vs locale-specific)
  // Everything else stays universal.
  const universalItems = SHOWCASE.map(it => {
    if (it.id === 'cal') {
      return { ...it, mock: <CalendarMock parentTerm={locale.demo.parentTerm} /> }
    }
    if (it.id === 'tasks') {
      return {
        ...it,
        mock: <TasksMock completedTask={locale.demo.completedTaskExample} />,
        bullets: it.bullets.map(b =>
          b.startsWith('Recurring tasks (')
            ? `Recurring tasks (${locale.demo.recurringTasksExample})`
            : b
        ),
      }
    }
    return it
  })
  const termsItem = buildSchoolTermsItem(locale)
  const showcaseItems = termsItem ? [...universalItems, termsItem] : universalItems

  useEffect(() => {
    document.title = 'AI Family Organiser - Calendar, Tasks, Meals & Lists | Housemait'
  }, [])

  useEffect(() => {
    const onScroll = () => setShowFab(window.scrollY > 1500)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll-reveal: elements tagged .reveal fade-up the first time they
  // enter the viewport, then unobserve (one-shot, no re-animation on
  // scroll-back). The showcase section is deliberately untagged — it has
  // its own IntersectionObserver choreography and a position:sticky pin
  // that shouldn't gain ancestors with transforms. prefers-reduced-motion
  // is handled in CSS (reveal elements render fully visible, no
  // transition), so this observer is a harmless no-op there.
  useEffect(() => {
    const els = document.querySelectorAll('.lp-v2 .reveal')
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12 }
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <div className="lp-v2">
      <HreflangTags locale={locale} />
      {/* NAV */}
      <nav className="top">
        <div className="wrap inner">
          <a className="logo" href="#">
            <img src="/housemait-logo-web.svg" alt="housemait" />
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
          {/* On iPhone visitors we still drop the trial CTA from the mobile
              menu — they're pushed toward the App Store instead (hero badge +
              'Get Housemait' FAB) and an in-Safari signup would just create an
              account they'd re-authenticate inside the native app. Sign in,
              though, stays for everyone: existing users need a way back in
              regardless of platform. */}
          {!iosVisitor && (
            <a href={SIGNUP_URL} className="btn btn-primary" style={{ marginTop: 12, justifyContent: 'center' }} onClick={() => setMenuOpen(false)}>Start 30-day free trial</a>
          )}
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">
              <span className="dot" style={{ background: '#25D366', boxShadow: '0 0 0 4px rgba(37,211,102,.22)' }} />
              New · WhatsApp assistant for your household
            </span>
            <h1 className="display">
              The quiet hum<br />
              of <em>family life</em>,<br />
              made easy with&nbsp;AI.
            </h1>
            <p className="lede">
              Housemait restores calm and order to family life. It holds the calendar, shopping, tasks and meals in one place, and answers on WhatsApp, so the mental load stops landing on one person.
            </p>
            <div className="hero-cta">
              {/* Hero CTA — the styled "Download on the App Store" pill
                  shows on every device (on desktop it reveals a QR popover
                  on hover to scan straight to a phone; on touch it opens
                  the App Store directly). The "Try it on the web" fallback
                  is shown to desktop/Android but hidden for iPhone visitors
                  — they're already on the device the app installs to. The
                  pill is only rendered when the App Store ID has been
                  configured in lib/app-store.js. */}
              {APP_STORE_CONFIGURED && <DownloadQR />}
              {!iosVisitor && (
                <a href={SIGNUP_URL} className="btn btn-outline try-online-pill">
                  Try it on the web
                </a>
              )}
            </div>
            <div className="hero-price">
              Free 30-day trial. No card to start. Cancel anytime.
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
              <div>Bananas<br /><span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Added to shopping list</span></div>
            </div>
            <div className="sticker s2">
              <div className="ic">🍝</div>
              <div>Pasta night<br /><span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Planned for Tuesday</span></div>
            </div>
            <div className="sticker s3">
              <div className="ic">✦</div>
              <div>Grocery receipt scanned<br /><span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>6 items marked as bought</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* FEATURE STRIP */}
      <section className="strip" id="features">
        <div className="wrap">
          <div className="reveal" style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 40, flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div className="eyebrow-sec">Everything in one place</div>
              <h2 className="sec" style={{ margin: 0 }}>
                Family life <em>intelligently&nbsp;organised.</em>
              </h2>
            </div>
            <p style={{ maxWidth: 360, color: 'var(--ink-soft)', margin: 0 }}>
              One parent holding every date, list and dinner plan in their head isn't a system. Housemait is.
            </p>
          </div>
          {/* Pain-led feature cards: each opens with the thing families
              actually say out loud (the pain), then the one-line fix.
              The kicker keeps the feature name for scannability. */}
          <div className="feat-grid">
            <div className="feat c1 reveal">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <div className="kicker">Shared calendar</div>
              <h3>"You never told me about that."</h3>
              <p>Now everyone sees the same month: colour-coded per person, with a heads-up the moment two plans collide.</p>
            </div>
            <div className="feat c2 reveal">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
              </div>
              <div className="kicker">Smart shopping</div>
              <h3>"We're out of milk. Again."</h3>
              <p>One live list everyone adds to, sorted into aisles, and checked off by snapping the receipt.</p>
            </div>
            <div className="feat c3 reveal">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              </div>
              <div className="kicker">Family tasks</div>
              <h3>"Why am I the one who remembers the bins?"</h3>
              <p>Chores assigned by name, repeating on schedule, with Housemait doing the chasing instead of you.</p>
            </div>
            <div className="feat c4 reveal">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11h.01M11 15h.01M16 16h.01M3 3h7v7H3z" /><path d="M14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" /></svg>
              </div>
              <div className="kicker">Meal planning</div>
              <h3>"It's 5pm. What's for dinner?"</h3>
              <p>Plan the week in minutes on Sunday. The shopping list builds itself from the ingredients.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI PROMPT SHOWCASE */}
      <section className="sec-block">
        <div className="wrap">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="eyebrow-sec">The AI that gets the brief</div>
            <h2 className="sec" style={{ margin: '0 auto 16px' }}>
              Just say it. <em>It's&nbsp;sorted.</em>
            </h2>
            <p className="sec-lede" style={{ margin: '0 auto' }}>
              Type it, snap it, or forward the email, and Housemait files real life into the right calendar entry, shopping line, task or meal.
            </p>
          </div>

          <div className="ai-demo reveal">
            <div className="ai-input">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
              <div className="txt">"Finn has a dentist on Thursday at 4, we're out of milk, and let's plan three easy dinners this week"</div>
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
                <div className="title">Finn · Dentist</div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>4:00 PM · 45 min<br />📍 {locale.demo.dentistLocation}</div>
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
                    Milk · {locale.demo.milkSize}
                  </li>
                  <li>
                    <span className="cb" />
                    <span style={{ background: 'var(--coral-soft)', padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase', color: '#a84522' }}>Meat</span>
                    Chicken · {locale.demo.chickenSize}
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
                  <li>🍝 Tue · One-pot pasta</li>
                  <li>🌮 Wed · Sheet-pan fajitas</li>
                  <li>🍛 Thu · Quick butter chicken</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHATSAPP */}
      <section id="whatsapp" className="section-white sec-block">
        <div className="wrap">
          <div className="wa-section reveal">
            <div className="wa-grid">
              <div>
                <span className="wa-badge">
                  <span className="ic">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.46 0 .1 5.34.1 11.9c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.65a11.9 11.9 0 0 0 5.75 1.47h.01c6.59 0 11.94-5.34 11.94-11.9a11.8 11.8 0 0 0-3.48-8.44z" /></svg>
                  </span>
                  WhatsApp AI Assistant
                </span>
                <h3 style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 'clamp(36px,4.4vw,56px)', lineHeight: 1.05, letterSpacing: '-.015em', margin: '18px 0' }}>
                  Your family's assistant, <em style={{ fontStyle: 'normal', color: 'var(--purple)' }}>right in WhatsApp.</em>
                </h3>
                <p style={{ color: 'var(--ink-soft)', fontSize: 17, maxWidth: 480, margin: 0 }}>
                  Your family already lives in WhatsApp, so Housemait does too. No new app for the household to ignore: message the bot the way you'd message each other, and everything lands in the right place, filed and remembered.
                </p>
                <ul className="bullets" style={{ marginTop: 28 }}>
                  <li><span className="check">✓</span> Add items to your shopping list by just texting</li>
                  <li><span className="check">✓</span> Create and assign tasks to family members</li>
                  <li><span className="check">✓</span> Plan meals and get recipe suggestions</li>
                  <li><span className="check">✓</span> Send voice notes and we'll transcribe them into actions</li>
                </ul>
              </div>
              <div style={{ position: 'relative' }}>
                <WhatsAppPhone />
                <div className="wa-float-sticker" style={{ top: -14, right: '6%', transform: 'rotate(4deg)', background: 'var(--coral-soft)', color: '#a84522' }}>3 items added ✓</div>
                <div className="wa-float-sticker" style={{ top: '34%', left: '-6%', transform: 'rotate(-4deg)', background: 'var(--sage-soft)', color: '#2e5a2a' }}>Meal planned 🍽️</div>
                <div className="wa-float-sticker" style={{ bottom: '8%', right: '-4%', transform: 'rotate(3deg)', background: 'var(--purple-soft)', color: 'var(--purple-deep)' }}>Task assigned to Dad</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Showcase items={showcaseItems} />

      {/* TESTIMONIALS */}
      <section id="stories" className="section-cream sec-block">
        <div className="wrap">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="eyebrow-sec">Loved by actual parents</div>
            <h2 className="sec" style={{ margin: '0 auto' }}>
              A little more <em>calm,</em><br />a lot fewer group&nbsp;chats.
            </h2>
          </div>
          <div className="testis">
            {locale.reviews.map((r, i) => (
              <div key={r.name} className={`testi reveal${i === 1 ? ' hl' : ''}`}>
                <div className="stars">★★★★★</div>
                <blockquote>"{REVIEW_QUOTES[i]}"</blockquote>
                <div className="who">
                  <div className="avatar">{r.initials}</div>
                  <div>
                    <div className="name">{r.name}</div>
                    <div className="role">{r.role}{r.city ? ` · ${r.city}` : ''}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* PRICING */}
      <section id="pricing" className="section-white sec-block">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div className="eyebrow-sec">Pricing</div>
            <h2 className="sec" style={{ margin: '0 auto' }}>
              Less than <em>{locale.pricing.compareReference}</em> a month.
            </h2>
            <p className="sec-lede" style={{ margin: '14px auto 0' }}>
              One plan with everything in it, covering your whole household. No tiers to compare, nothing to unlock. 30-day free trial, cancel any time.
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

          <div className="single-plan reveal">
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
              {planFeatures.map(f => (
                <li key={f}><span className="check">✓</span> {f}</li>
              ))}
            </ul>
            {/* Hidden on iPhone visitors — they're funnelled to the App
                Store via the hero badge / Smart Banner / FAB, and an
                in-Safari signup would create an account they'd have to
                re-authenticate inside the native app. */}
            {!iosVisitor && (
              <a href={SIGNUP_URL} className="btn btn-primary">Start your free 30-day trial</a>
            )}
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
            {faqs.map((f, i) => (
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
          <div className="cta reveal">
            <div className="bg1" />
            <div className="bg2" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h2>Try Housemait <em>free</em><br />for 30&nbsp;days.</h2>
              <p>Set Housemait up in under 5 minutes. Your calmer family life starts here.</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                {APP_STORE_CONFIGURED && <DownloadQR preferUp />}
                {!iosVisitor && (
                  <a href={SIGNUP_URL} className="btn btn-outline try-online-pill">
                    Try it on the web
                  </a>
                )}
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
              <img src="/housemait-logo-web.svg" alt="housemait" style={{ height: 26 }} />
              <p className="tag">Family life, organised. AI-powered household management for {locale.audienceTagline}.</p>
              <div className="social">
                <a href="https://linkedin.com/company/housemait/" target="_blank" rel="noopener noreferrer" aria-label="Housemait on LinkedIn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3v9zM6.5 8.25A1.75 1.75 0 1 1 8.25 6.5 1.75 1.75 0 0 1 6.5 8.25zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
                  </svg>
                </a>
                <a href="https://www.facebook.com/housemait" target="_blank" rel="noopener noreferrer" aria-label="Housemait on Facebook">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.19 2.24.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7A9.96 9.96 0 0 0 22 12.06z" />
                  </svg>
                </a>
              </div>
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
                <li><a href="/support">Contact</a></li>
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
            <span>{locale.footerNote}</span>
          </div>
        </div>
      </footer>

      {/* Mobile-only floating CTA. iOS visitors get a 'Get Housemait'
          button that deep-links to the App Store, since the phone they're
          browsing on is also the phone they'd install the app on. Android
          visitors keep the 'Get Started' web signup path because they
          can't install the iOS app on their device. */}
      <a
        href={iosVisitor ? APP_STORE_URL : SIGNUP_URL}
        className={`fab-cta${showFab ? ' show' : ''}`}
      >
        {iosVisitor ? 'Get Housemait' : 'Get Started'} <ArrowRight />
      </a>
    </div>
  )
}
