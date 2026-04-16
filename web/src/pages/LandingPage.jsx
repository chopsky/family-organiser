import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

const SIGNUP_URL = '/signup'
const LOGIN_URL = '/login'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'WhatsApp', href: '#whatsapp' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'FAQ', href: '#faq' },
]

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
    title: 'Shopping Lists',
    description: 'Create and share lists with your family. Items are auto-categorised by aisle so shopping trips are a breeze.',
    color: 'sage',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: 'Task Management',
    description: 'Assign tasks to family members with due dates. Everyone stays accountable and nothing falls through the cracks.',
    color: 'plum',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M8 14h.01" /><path d="M12 14h.01" /><path d="M16 14h.01" /><path d="M8 18h.01" /><path d="M12 18h.01" />
      </svg>
    ),
    title: 'School Term Dates',
    description: 'Select your child\'s school and auto-import all term dates, half terms and INSET days into your calendar. Every UK school supported.',
    color: 'coral',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M3 3h7v7H3z" /><path d="M14 3h7v7h-7z" /><path d="M3 14h7v7H3z" /><path d="M17 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /><path d="M14 14h3.5" /><path d="M20 17.5V21h-3.5" />
      </svg>
    ),
    title: 'Meal Planner',
    description: 'Plan your family\'s meals for the week and send ingredients straight to your shopping list with one tap.',
    color: 'sage',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    title: 'Family Calendar',
    description: 'A shared calendar colour-coded by family member. See everyone\'s events, activities and appointments in one place.',
    color: 'plum',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: 'Receipt Scanner',
    description: 'Snap a photo of your receipt and Housemait automatically checks off what you bought from the shopping list.',
    color: 'coral',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Create your household',
    description: 'Sign up and invite your family members. Everyone gets their own account linked to your shared household.',
  },
  {
    num: '02',
    title: 'Start organising',
    description: 'Type naturally — our AI classifies what goes on the shopping list versus what becomes a task or meal plan.',
  },
  {
    num: '03',
    title: 'Connect WhatsApp',
    description: 'Add the Housemait bot on WhatsApp. Each family member messages it directly to manage lists, tasks and meals.',
  },
  {
    num: '04',
    title: 'Stay in sync',
    description: 'Scan receipts after shopping, get weekly digests, and watch your household run like clockwork.',
  },
]

const FAQS = [
  {
    q: 'Is Housemait free?',
    a: 'Yes. Housemait is completely free for families to use. We believe every household deserves great organisation tools.',
  },
  {
    q: 'How does the WhatsApp bot work?',
    a: 'Each family member messages the Housemait bot directly on WhatsApp. Just send a message to add items, assign tasks, plan meals or check the shopping list. The bot understands natural language and even voice notes.',
  },
  {
    q: 'How does the receipt scanner work?',
    a: "Take a photo of your grocery receipt and Housemait uses AI to read the items. It automatically ticks off matching items from your shopping list so you know exactly what's been bought.",
  },
  {
    q: 'Can I use Housemait without WhatsApp?',
    a: 'Absolutely. The web app has everything you need. WhatsApp is an optional add-on for families who prefer chatting over apps.',
  },
  {
    q: 'How many people can be in a household?',
    a: "There's no limit. Invite as many family members as you need — parents, grandparents, older kids, au pairs, anyone who helps run the household.",
  },
  {
    q: 'Is my family data safe?',
    a: "Your privacy is paramount. We're fully GDPR compliant, your data is encrypted, and we never sell or share your family's information with third parties.",
  },
]

const WA_MESSAGES = [
  { from: 'user', text: 'Can you add milk, bread and eggs to the shopping list?' },
  { from: 'bot', text: "Done! I've added 3 items to your shopping list:\n• Milk (dairy)\n• Bread (bakery)\n• Eggs (dairy)\n\nAnything else?" },
  { from: 'user', text: "What's for dinner tonight?" },
  { from: 'bot', text: "Tonight's meal plan: Chicken Stir-fry 🥘\n\nNeed me to add the ingredients to your shopping list?" },
  { from: 'user', text: '🎤 0:03', isVoice: true },
  { from: 'bot', text: "Got it! I've added \"Pick up dry cleaning\" to Sarah's tasks for tomorrow." },
]

/* ─── Small Components ─── */

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-light-grey">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-6 text-left cursor-pointer group"
      >
        <span className="text-lg font-medium text-charcoal pr-8 font-sans">{q}</span>
        <span className={`text-2xl text-plum transition-transform duration-300 shrink-0 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-48 pb-6' : 'max-h-0'}`}>
        <p className="text-warm-grey leading-relaxed">{a}</p>
      </div>
    </div>
  )
}

function WhatsAppBubble({ from, text, isVoice }) {
  const isUser = from === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
          isUser
            ? 'bg-wa-light text-charcoal rounded-tr-sm'
            : 'bg-white text-charcoal rounded-tl-sm shadow-sm'
        }`}
        style={{ whiteSpace: 'pre-line' }}
      >
        {isVoice ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-wa-green/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2" className="w-4 h-4">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </div>
            <div className="flex gap-0.5 items-center h-6">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="w-0.5 bg-wa-green/60 rounded-full" style={{ height: `${Math.random() * 16 + 4}px` }} />
              ))}
            </div>
            <span className="text-xs text-warm-grey ml-1">0:03</span>
          </div>
        ) : (
          text
        )}
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, description, color }) {
  const bgMap = {
    sage: 'bg-sage-light',
    plum: 'bg-plum-light',
    coral: 'bg-coral-light',
    wa: 'bg-[#E8F5E9]',
  }
  const textMap = {
    sage: 'text-sage',
    plum: 'text-plum',
    coral: 'text-coral',
    wa: 'text-[#25D366]',
  }
  return (
    <div className="bg-white rounded-2xl p-7 shadow-[0_2px_8px_rgba(107,63,160,0.06)] hover:shadow-[0_4px_16px_rgba(107,63,160,0.08)] hover:-translate-y-1 transition-all duration-300">
      <div className={`w-12 h-12 rounded-xl ${bgMap[color]} ${textMap[color]} flex items-center justify-center mb-5`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-charcoal mb-2 font-sans">{title}</h3>
      <p className="text-warm-grey leading-relaxed text-[15px]">{description}</p>
    </div>
  )
}

/* ─── Scroll Reveal Hook ─── */

function useScrollReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = 'translateY(24px)'
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out'
          el.style.opacity = '1'
          el.style.transform = 'translateY(0)'
          observer.unobserve(el)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

/* ─── Main App ─── */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const whatsappRef = useScrollReveal()
  const featuresRef = useScrollReveal()
  const stepsRef = useScrollReveal()
  const previewRef = useScrollReveal()
  const mealsRef = useScrollReveal()
  const faqRef = useScrollReveal()

  return (
    <div className="landing-page min-h-screen bg-cream font-sans antialiased">
      {/* ═══ Navbar ═══ */}
      <nav className="sticky top-0 z-50 glass border-b border-light-grey">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/housemait-logo2.png" alt="Housemait" className="h-7" />
          </a>
          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-warm-grey hover:text-plum transition-colors duration-200">{l.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <a
              href={SIGNUP_URL}
              className="hidden sm:inline-flex bg-plum hover:bg-plum-dark text-white text-sm font-semibold px-6 py-2.5 rounded-full transition-colors duration-200"
            >
              Get started
            </a>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-charcoal"
              aria-label="Toggle menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
                {mobileMenuOpen ? (
                  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                ) : (
                  <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
                )}
              </svg>
            </button>
          </div>
        </div>
        {/* Mobile menu */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ${mobileMenuOpen ? 'max-h-72' : 'max-h-0'}`}>
          <div className="px-5 pb-6 pt-2 flex flex-col gap-4">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-charcoal hover:text-plum transition-colors">{l.label}</a>
            ))}
            <a href={SIGNUP_URL} className="bg-plum text-white text-sm font-semibold px-6 py-3 rounded-full text-center transition-colors hover:bg-plum-dark mt-2">
              Get started — it's free
            </a>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-plum-light via-plum-light/40 to-cream" />
        {/* Decorative blobs */}
        <div className="absolute top-20 right-[10%] w-[400px] h-[400px] rounded-full opacity-40 animate-float" style={{ background: 'radial-gradient(circle, rgba(107,63,160,0.1) 0%, transparent 70%)' }} />
        <div className="absolute top-60 left-[5%] w-[350px] h-[350px] rounded-full opacity-40 animate-float-delayed" style={{ background: 'radial-gradient(circle, rgba(232,114,74,0.08) 0%, transparent 70%)' }} />
        <div className="absolute bottom-20 right-[30%] w-[300px] h-[300px] rounded-full opacity-30 animate-float-slow" style={{ background: 'radial-gradient(circle, rgba(125,174,130,0.08) 0%, transparent 70%)' }} />

        {/* Floating emoji cards — pinned relative to the content edge so they never crowd the text */}
        <div className="absolute top-[14%] hidden lg:flex w-[58px] h-[58px] items-center justify-center rounded-2xl text-4xl select-none pointer-events-none shadow-lg rotate-[-12deg] animate-float" style={{ background: 'rgba(232,114,74,0.12)', left: 'calc(50% - 430px)' }} aria-hidden="true">🗓️</div>
        <div className="absolute top-[18%] hidden lg:flex w-[58px] h-[58px] items-center justify-center rounded-2xl text-4xl select-none pointer-events-none shadow-lg rotate-[10deg] animate-float-delayed" style={{ background: 'rgba(107,63,160,0.12)', right: 'calc(50% - 420px)' }} aria-hidden="true">🛒</div>
        <div className="absolute top-[46%] hidden lg:flex w-[58px] h-[58px] items-center justify-center rounded-2xl text-4xl select-none pointer-events-none shadow-lg rotate-[6deg] animate-float-slow" style={{ background: 'rgba(232,114,74,0.12)', left: 'calc(50% - 500px)' }} aria-hidden="true">🍝</div>
        <div className="absolute top-[48%] hidden lg:flex w-[58px] h-[58px] items-center justify-center rounded-2xl text-4xl select-none pointer-events-none shadow-lg rotate-[-6deg] animate-float" style={{ background: 'rgba(125,174,130,0.15)', right: 'calc(50% - 510px)' }} aria-hidden="true">✅</div>

        <div className="relative max-w-6xl mx-auto px-5 md:px-8 pt-16 md:pt-24 pb-20 md:pb-32">
          <div className="max-w-3xl mx-auto text-center">
            {/* Announcement pill */}
            <div className="inline-flex items-center gap-2 bg-plum text-white text-sm px-4 py-1.5 rounded-full mb-8 shadow-[0_4px_16px_rgba(107,63,160,0.2)]">
              <span className="bg-coral text-white text-xs font-bold px-2 py-0.5 rounded-full">NEW</span>
              <span className="font-medium">WhatsApp AI assistant for the whole family</span>
              <span className="ml-0.5">&rarr;</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-charcoal mb-6 leading-[1.08]">
              Family life,<br />
              <span className="text-coral">beautifully</span> organised
            </h1>

            {/* Subtext */}
            <p className="text-lg md:text-xl text-warm-grey max-w-2xl mx-auto mb-10 leading-relaxed">
              Shopping lists, meal plans, tasks and calendars — managed together from one app or via WhatsApp. Powered by AI that actually understands family life.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={SIGNUP_URL}
                className="bg-plum hover:bg-plum-dark text-white font-semibold px-8 py-3.5 rounded-full text-base transition-all duration-200 shadow-[0_4px_16px_rgba(107,63,160,0.25)] hover:shadow-[0_8px_24px_rgba(107,63,160,0.3)]"
              >
                Get started — it's free
              </a>
              <a
                href="#features"
                className="text-plum hover:text-plum-dark font-medium text-base transition-colors duration-200 flex items-center gap-1"
              >
                See how it works
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mt-0.5"><path d="M7 13l5 5 5-5M7 6l5 5 5-5" /></svg>
              </a>
            </div>
          </div>

          {/* Hero floating cards */}
          <div className="relative mt-16 md:mt-24 max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Shopping list card */}
              <div className="bg-white rounded-2xl p-4 shadow-[0_4px_16px_rgba(107,63,160,0.08)] animate-float" style={{ animationDelay: '0s' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-sage-light flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#7DAE82" strokeWidth="2" className="w-3.5 h-3.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /></svg>
                  </div>
                  <span className="text-xs font-semibold text-charcoal">Shopping</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded border-[1.5px] border-light-grey" /><span className="text-xs text-warm-grey">Milk</span></div>
                  <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded border-[1.5px] border-light-grey" /><span className="text-xs text-warm-grey">Bread</span></div>
                  <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded bg-sage flex items-center justify-center"><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12" /></svg></div><span className="text-xs text-warm-grey line-through">Eggs</span></div>
                </div>
              </div>

              {/* Calendar event card */}
              <div className="bg-white rounded-2xl p-4 shadow-[0_4px_16px_rgba(107,63,160,0.08)] animate-float-delayed" style={{ animationDelay: '0.5s' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-plum-light flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#6B3FA0" strokeWidth="2" className="w-3.5 h-3.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </div>
                  <span className="text-xs font-semibold text-charcoal">Today</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-plum" /><span className="text-xs text-charcoal">School run</span><span className="text-[10px] text-warm-grey ml-auto">8:30</span></div>
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-coral" /><span className="text-xs text-charcoal">Dentist</span><span className="text-[10px] text-warm-grey ml-auto">10:00</span></div>
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-sage" /><span className="text-xs text-charcoal">Football</span><span className="text-[10px] text-warm-grey ml-auto">16:00</span></div>
                </div>
              </div>

              {/* WhatsApp bubble card */}
              <div className="bg-white rounded-2xl p-4 shadow-[0_4px_16px_rgba(107,63,160,0.08)] animate-float-slow" style={{ animationDelay: '1s' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-[#E8F5E9] flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="#25D366" className="w-3.5 h-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                  </div>
                  <span className="text-xs font-semibold text-charcoal">WhatsApp</span>
                </div>
                <div className="bg-wa-light rounded-lg px-3 py-2 mb-1.5">
                  <p className="text-[11px] text-charcoal">Add milk and bread please!</p>
                </div>
                <div className="bg-white border border-light-grey rounded-lg px-3 py-2">
                  <p className="text-[11px] text-charcoal">Done! Added 2 items ✓</p>
                </div>
              </div>

              {/* Meal plan card */}
              <div className="bg-white rounded-2xl p-4 shadow-[0_4px_16px_rgba(107,63,160,0.08)] animate-float" style={{ animationDelay: '1.5s' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-coral-light flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#E8724A" strokeWidth="2" className="w-3.5 h-3.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>
                  </div>
                  <span className="text-xs font-semibold text-charcoal">Meals</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-plum bg-plum-light px-1.5 py-0.5 rounded">MON</span><span className="text-xs text-charcoal">Pasta Bake</span></div>
                  <div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-sage bg-sage-light px-1.5 py-0.5 rounded">TUE</span><span className="text-xs text-charcoal">Fish & Chips</span></div>
                  <div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-coral bg-coral-light px-1.5 py-0.5 rounded">WED</span><span className="text-xs text-charcoal">Stir-fry</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Social Proof Bar ═══ */}
      <section className="bg-white border-y border-light-grey">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-8 md:py-10">
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12">
            <p className="text-warm-grey font-medium text-sm">Trusted by families across the UK</p>
            <div className="flex items-center gap-4 md:gap-8">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {['bg-plum', 'bg-coral', 'bg-sage', 'bg-[#E0A458]', 'bg-[#5B9BD5]'].map((bg, i) => (
                    <div key={i} className={`w-7 h-7 rounded-full ${bg} border-2 border-white flex items-center justify-center`}>
                      <span className="text-white text-[9px] font-bold">{['GS', 'JD', 'AT', 'MR', 'KP'][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="h-6 w-px bg-light-grey" />
              <div className="flex items-center gap-1.5">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} viewBox="0 0 20 20" fill="#E8724A" className="w-4 h-4">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
                <span className="text-xs font-semibold text-charcoal ml-1">5.0</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ WhatsApp Feature Showcase ═══ */}
      <section id="whatsapp" className="py-20 md:py-32 overflow-hidden">
        <div ref={whatsappRef} className="max-w-6xl mx-auto px-5 md:px-8">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
            {/* Text */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <svg viewBox="0 0 24 24" fill="#25D366" className="w-5 h-5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                <span className="text-sm font-semibold text-coral uppercase tracking-wide">WhatsApp AI Assistant</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-charcoal mb-5 leading-tight">
                Your family's AI assistant, right in WhatsApp
              </h2>
              <p className="text-warm-grey text-lg leading-relaxed mb-8">
                No new app to learn. Just message the Housemait bot on WhatsApp and it takes care of the rest. It's like having a personal assistant that never sleeps.
              </p>
              <div className="space-y-4">
                {[
                  'Add items to your shopping list by just texting',
                  'Create and assign tasks to family members',
                  'Plan meals and get recipe suggestions',
                  'Send voice notes — we\'ll transcribe them into actions',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-sage-light flex items-center justify-center mt-0.5 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#7DAE82" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <span className="text-charcoal">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phone mockup */}
            <div className="relative flex justify-center">
              {/* Floating notification badges */}
              <div className="absolute -top-4 -right-2 md:right-0 bg-coral-light text-coral text-xs font-semibold px-3 py-1.5 rounded-full shadow-[0_4px_16px_rgba(232,114,74,0.15)] animate-float z-10">
                3 items added ✓
              </div>
              <div className="absolute top-1/3 -left-4 md:-left-8 bg-sage-light text-sage text-xs font-semibold px-3 py-1.5 rounded-full shadow-[0_4px_16px_rgba(125,174,130,0.15)] animate-float-delayed z-10">
                Meal planned 🍽️
              </div>
              <div className="absolute bottom-16 -right-2 md:right-0 bg-plum-light text-plum text-xs font-semibold px-3 py-1.5 rounded-full shadow-[0_4px_16px_rgba(107,63,160,0.15)] animate-float-slow z-10">
                Task assigned to Dad
              </div>

              {/* Phone frame */}
              <div className="w-[280px] md:w-[300px] bg-charcoal rounded-[40px] p-3 shadow-[0_8px_24px_rgba(107,63,160,0.15)]">
                <div className="bg-white rounded-[28px] overflow-hidden">
                  {/* WhatsApp header */}
                  <div className="bg-wa-dark px-4 py-3 flex items-center gap-3">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-5 h-5"><path d="M15 19l-7-7 7-7" /></svg>
                    <div className="w-8 h-8 rounded-full bg-plum flex items-center justify-center">
                      <span className="text-white text-xs font-bold">hm</span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold leading-tight">housemait</p>
                      <p className="text-[#93CCAB] text-[10px]">Family Bot</p>
                    </div>
                  </div>

                  {/* Chat area */}
                  <div className="bg-wa-bg px-3 py-3 min-h-[340px] md:min-h-[380px]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'1\' fill=\'rgba(0,0,0,0.03)\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'200\' height=\'200\' fill=\'url(%23p)\'/%3E%3C/svg%3E")' }}>
                    {WA_MESSAGES.map((msg, i) => (
                      <WhatsAppBubble key={i} {...msg} />
                    ))}
                    {/* Typing indicator */}
                    <div className="flex justify-start">
                      <div className="bg-white rounded-xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-warm-grey animate-typing" />
                        <div className="w-2 h-2 rounded-full bg-warm-grey animate-typing" style={{ animationDelay: '0.2s' }} />
                        <div className="w-2 h-2 rounded-full bg-warm-grey animate-typing" style={{ animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  </div>

                  {/* Input bar */}
                  <div className="bg-[#F0F0F0] px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 bg-white rounded-full px-4 py-2">
                      <span className="text-xs text-warm-grey">Type a message</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-wa-teal flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section id="features" className="bg-cream py-20 md:py-32">
        <div ref={featuresRef} className="max-w-6xl mx-auto px-5 md:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-bold text-charcoal mb-4">
              Everything your household needs
            </h2>
            <p className="text-warm-grey text-lg max-w-2xl mx-auto">
              Built for real families who want less chaos and more time together.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <FeatureCard key={i} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ How It Works ═══ */}
      <section id="how-it-works" className="bg-white py-20 md:py-32">
        <div ref={stepsRef} className="max-w-6xl mx-auto px-5 md:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-bold text-charcoal mb-4">
              Up and running in minutes
            </h2>
            <p className="text-warm-grey text-lg max-w-2xl mx-auto">
              No complicated setup. Just sign up and start organising.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((s, i) => (
              <div key={s.num} className="relative bg-cream rounded-2xl p-7">
                {/* Large background number */}
                <span className="absolute top-4 right-6 text-6xl font-bold text-plum/10 font-display select-none">{s.num}</span>
                {/* Connecting line (desktop) */}
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 w-6 border-t-2 border-dashed border-plum/20" />
                )}
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-plum-light flex items-center justify-center mb-4">
                    <span className="text-plum font-bold text-sm">{s.num}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-charcoal mb-2 font-sans">{s.title}</h3>
                  <p className="text-warm-grey leading-relaxed text-[15px]">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ App Preview ═══ */}
      <section className="relative bg-gradient-to-br from-plum to-plum-dark py-20 md:py-32 overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,109,181,0.3) 0%, transparent 70%)' }} />

        <div ref={previewRef} className="relative max-w-6xl mx-auto px-5 md:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
              See your household at a glance
            </h2>
            <p className="text-white/70 text-lg max-w-2xl mx-auto">
              A beautiful dashboard that brings your family's entire life into one calm, organised view.
            </p>
          </div>

          {/* Browser frame mockup */}
          <div className="max-w-4xl mx-auto" style={{ perspective: '1000px' }}>
            <div className="bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.2)] overflow-hidden" style={{ transform: 'rotateX(2deg)' }}>
              {/* Browser chrome */}
              <div className="bg-[#F5F3F7] px-4 py-3 flex items-center gap-3 border-b border-light-grey">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                  <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                  <div className="w-3 h-3 rounded-full bg-[#28CA41]" />
                </div>
                <div className="flex-1 bg-white rounded-md px-3 py-1 text-xs text-warm-grey text-center mx-8">
                  housemait.app
                </div>
              </div>
              {/* App mockup */}
              <div className="flex min-h-[300px] md:min-h-[400px]">
                {/* Sidebar */}
                <div className="hidden md:flex w-[200px] bg-white border-r border-light-grey flex-col p-4 shrink-0">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-7 h-7 rounded-lg bg-plum flex items-center justify-center">
                      <span className="text-white text-[9px] font-bold">hm</span>
                    </div>
                    <span className="text-sm font-bold text-charcoal">housemait</span>
                  </div>
                  <div className="space-y-1">
                    {['Home', 'Shopping', 'Tasks', 'Calendar', 'Meals', 'Family'].map((item, i) => (
                      <div key={item} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${i === 0 ? 'bg-plum-light text-plum font-semibold' : 'text-warm-grey'}`}>
                        <div className={`w-4 h-4 rounded ${i === 0 ? 'bg-plum/20' : 'bg-light-grey'}`} />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Main content */}
                <div className="flex-1 bg-cream p-5 md:p-8">
                  <div className="mb-5">
                    <h3 className="text-lg md:text-xl font-bold text-charcoal font-display">Good morning, Sarah! 👋</h3>
                    <p className="text-xs text-warm-grey">Thursday 26 March 2026 · 4 events today</p>
                  </div>
                  {/* AI bar */}
                  <div className="bg-white rounded-xl border border-light-grey px-4 py-2.5 mb-5 flex items-center">
                    <span className="text-xs text-warm-grey">Ask AI to create events, tasks, recipes...</span>
                    <div className="ml-auto w-6 h-6 rounded-full bg-plum flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="white" className="w-3 h-3"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Schedule card */}
                    <div className="bg-white rounded-xl p-3.5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-charcoal">Today's schedule</span>
                        <span className="text-[10px] text-plum font-semibold">View →</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-plum" /><span className="text-[11px] text-charcoal">School run</span><span className="text-[9px] text-warm-grey ml-auto">8:30</span></div>
                        <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-coral" /><span className="text-[11px] text-charcoal">Dentist</span><span className="text-[9px] text-warm-grey ml-auto">10:00</span></div>
                        <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-sage" /><span className="text-[11px] text-charcoal">Football practice</span><span className="text-[9px] text-warm-grey ml-auto">16:00</span></div>
                      </div>
                    </div>
                    {/* Tasks card */}
                    <div className="bg-white rounded-xl p-3.5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-charcoal">Tasks</span>
                        <span className="text-[10px] text-plum font-semibold">View all →</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded border-[1.5px] border-light-grey" /><span className="text-[11px] text-charcoal">Fix kitchen tap</span></div>
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded border-[1.5px] border-light-grey" /><span className="text-[11px] text-charcoal">Book dentist</span></div>
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-sage flex items-center justify-center"><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-2 h-2"><polyline points="20 6 9 17 4 12" /></svg></div><span className="text-[11px] text-warm-grey line-through">Order uniform</span></div>
                      </div>
                    </div>
                    {/* Grocery card */}
                    <div className="bg-white rounded-xl p-3.5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-charcoal">Shopping list</span>
                        <span className="text-[10px] text-plum font-semibold">Open →</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-sage bg-sage-light px-1.5 py-0.5 rounded">DAIRY</span><span className="text-[11px] text-charcoal">Milk, Eggs</span></div>
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-coral bg-coral-light px-1.5 py-0.5 rounded">MEAT</span><span className="text-[11px] text-charcoal">Chicken thighs</span></div>
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-plum bg-plum-light px-1.5 py-0.5 rounded">VEG</span><span className="text-[11px] text-charcoal">Broccoli, Peppers</span></div>
                      </div>
                    </div>
                    {/* Meals card */}
                    <div className="bg-white rounded-xl p-3.5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-charcoal">This week's meals</span>
                        <span className="text-[10px] text-plum font-semibold">Plan →</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-sage bg-sage-light px-1.5 py-0.5 rounded">THU</span><span className="text-[11px] text-charcoal">Chicken Stir-fry</span></div>
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-warm-grey bg-light-grey px-1.5 py-0.5 rounded">FRI</span><span className="text-[11px] text-warm-grey italic">Not planned yet</span></div>
                        <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-warm-grey bg-light-grey px-1.5 py-0.5 rounded">SAT</span><span className="text-[11px] text-warm-grey italic">Not planned yet</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Meal Planning Section ═══ */}
      <section className="bg-cream py-20 md:py-32">
        <div ref={mealsRef} className="max-w-6xl mx-auto px-5 md:px-8">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
            {/* Visual — meal plan mockup */}
            <div className="order-2 md:order-1">
              <div className="bg-white rounded-2xl p-6 shadow-[0_4px_16px_rgba(107,63,160,0.08)]">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-base font-semibold text-charcoal font-display">This week's meal plan</h4>
                  <span className="text-xs text-plum font-semibold">Edit →</span>
                </div>
                <div className="space-y-3">
                  {[
                    { day: 'MON', meal: 'Spaghetti Bolognese', tag: 'sage', emoji: '🍝' },
                    { day: 'TUE', meal: 'Shepherd\'s Pie', tag: 'sage', emoji: '🥧' },
                    { day: 'WED', meal: 'Chicken Stir-fry', tag: 'sage', emoji: '🥘' },
                    { day: 'THU', meal: 'Fish & Chips', tag: 'sage', emoji: '🐟' },
                    { day: 'FRI', meal: 'Pizza Night', tag: 'coral', emoji: '🍕' },
                    { day: 'SAT', meal: 'Roast Chicken', tag: 'sage', emoji: '🍗' },
                    { day: 'SUN', meal: 'Sunday Roast', tag: 'sage', emoji: '🥩' },
                  ].map(({ day, meal, tag, emoji }) => (
                    <div key={day} className="flex items-center gap-3 py-2 border-b border-light-grey/60 last:border-0">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded w-9 text-center ${
                        tag === 'sage' ? 'text-sage bg-sage-light' : 'text-coral bg-coral-light'
                      }`}>{day}</span>
                      <span className="text-sm text-charcoal flex-1">{meal}</span>
                      <span className="text-base">{emoji}</span>
                    </div>
                  ))}
                </div>
                {/* Add to shopping list button */}
                <button className="mt-5 w-full bg-sage hover:bg-sage/90 text-white text-sm font-semibold py-3 rounded-xl transition-colors duration-200 flex items-center justify-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /></svg>
                  Add all ingredients to shopping list
                </button>
              </div>
            </div>

            {/* Text */}
            <div className="order-1 md:order-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded bg-sage-light flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#7DAE82" strokeWidth="2" className="w-3.5 h-3.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>
                </div>
                <span className="text-sm font-semibold text-sage uppercase tracking-wide">Meal Planning</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-charcoal mb-5 leading-tight">
                Plan meals, discover recipes, auto-generate shopping lists
              </h2>
              <p className="text-warm-grey text-lg leading-relaxed mb-6">
                No more "what's for dinner?" Plan your family's meals for the week, get recipe ideas from AI, and automatically add all the ingredients to your shopping list with one tap.
              </p>
              <div className="space-y-4">
                {[
                  'Plan meals for every day of the week',
                  'AI suggests recipes based on your family\'s preferences',
                  'One-tap ingredient-to-shopping-list flow',
                  'Track what you\'ve cooked and loved',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-sage-light flex items-center justify-center mt-0.5 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#7DAE82" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <span className="text-charcoal">{item}</span>
                  </div>
                ))}
              </div>
              <a
                href={SIGNUP_URL}
                className="inline-flex mt-8 bg-plum hover:bg-plum-dark text-white font-semibold px-6 py-3 rounded-full text-sm transition-colors duration-200"
              >
                Start meal planning
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ School Term Dates ═══ */}
      <section className="bg-white py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-5 md:px-8">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
            {/* Text */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded bg-coral-light flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#E8724A" strokeWidth="2" className="w-3.5 h-3.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                </div>
                <span className="text-sm font-semibold text-coral uppercase tracking-wide">School Term Dates</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-charcoal mb-5 leading-tight">
                Every UK school's term dates, imported in one click
              </h2>
              <p className="text-warm-grey text-lg leading-relaxed mb-6">
                No more hunting through council websites or school newsletters. Select your child's school and Housemait automatically imports all term dates, half terms, and INSET days straight into your family calendar.
              </p>
              <div className="space-y-4">
                {[
                  'Search any school in England, Scotland, Wales & NI',
                  'Term dates, half terms & INSET days imported automatically',
                  'Syncs with your family calendar so nothing clashes',
                  'Supports multiple children at different schools',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-coral-light flex items-center justify-center mt-0.5 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#E8724A" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <span className="text-charcoal">{item}</span>
                  </div>
                ))}
              </div>
              <a
                href={SIGNUP_URL}
                className="inline-flex mt-8 bg-plum hover:bg-plum-dark text-white font-semibold px-6 py-3 rounded-full text-sm transition-colors duration-200"
              >
                Import your school's dates
              </a>
            </div>

            {/* Visual — school term dates mockup */}
            <div>
              <div className="bg-white rounded-2xl p-6 shadow-[0_4px_16px_rgba(107,63,160,0.08)] border border-light-grey">
                {/* School selector */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🏫</span>
                      <h4 className="text-base font-semibold text-charcoal font-display">School details</h4>
                    </div>
                  </div>
                  <div className="flex gap-3 mb-3">
                    <div className="flex-1 bg-cream rounded-xl px-4 py-3 border border-light-grey">
                      <span className="text-[10px] font-semibold text-warm-grey block mb-0.5">School</span>
                      <span className="text-sm text-charcoal">Queen Elizabeth's School</span>
                    </div>
                    <div className="bg-cream rounded-xl px-4 py-3 border border-light-grey w-24">
                      <span className="text-[10px] font-semibold text-warm-grey block mb-0.5">Year</span>
                      <span className="text-sm text-charcoal">Year 4</span>
                    </div>
                  </div>
                </div>

                {/* Term dates */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">📅</span>
                  <h4 className="text-sm font-semibold text-coral">Term dates imported</h4>
                  <div className="ml-auto flex items-center gap-1 bg-sage-light text-sage text-[10px] font-bold px-2 py-0.5 rounded-full">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    Synced
                  </div>
                </div>

                <div className="bg-cream rounded-xl p-4">
                  <span className="text-[11px] font-bold text-warm-grey block mb-3">2025–2026</span>
                  <div className="space-y-3">
                    {[
                      { term: 'Autumn', dates: '3 Sept – 19 Dec', extra: 'Half term: 27 Oct – 31 Oct' },
                      { term: 'Spring', dates: '5 Jan – 10 Apr', extra: 'Half term: 16 Feb – 20 Feb' },
                      { term: 'Summer', dates: '4 May – 22 Jul', extra: 'Half term: 25 May – 29 May' },
                    ].map(({ term, dates, extra }) => (
                      <div key={term} className="flex items-start gap-3 pb-3 border-b border-light-grey/60 last:border-0 last:pb-0">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded w-16 text-center shrink-0 ${
                          term === 'Autumn' ? 'text-coral bg-coral-light' :
                          term === 'Spring' ? 'text-sage bg-sage-light' :
                          'text-plum bg-plum-light'
                        }`}>{term}</span>
                        <div>
                          <span className="text-sm text-charcoal block">{dates}</span>
                          <span className="text-[11px] text-warm-grey">{extra}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* INSET days */}
                <div className="mt-4 flex items-center gap-2 bg-coral-light/60 rounded-lg px-3 py-2">
                  <span className="text-xs">⚠️</span>
                  <span className="text-[11px] text-charcoal"><span className="font-semibold">3 INSET days</span> added to your calendar</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA Banner ═══ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #6B3FA0 0%, #8B6DB5 50%, #E8724A 100%)' }} />
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
        {/* Decorative floating shapes */}
        <div className="absolute top-10 left-[10%] w-16 h-16 rounded-2xl bg-white/10 rotate-12 animate-float" />
        <div className="absolute bottom-10 right-[15%] w-12 h-12 rounded-full bg-white/10 animate-float-delayed" />
        <div className="absolute top-1/2 right-[8%] w-20 h-20 rounded-3xl bg-white/5 -rotate-6 animate-float-slow" />

        <div className="relative max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            Your family deserves less mental load
          </h2>
          <p className="text-white/75 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Join families across the UK who've simplified their daily routines with Housemait. It's free to get started.
          </p>
          <a
            href={SIGNUP_URL}
            className="inline-flex bg-white hover:bg-gray-50 text-plum font-semibold px-8 py-3.5 rounded-full text-base transition-colors duration-200 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
          >
            Get started for free
          </a>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="bg-white py-20 md:py-32">
        <div ref={faqRef} className="max-w-3xl mx-auto px-5 md:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-charcoal mb-4 text-center">
            Frequently asked questions
          </h2>
          <p className="text-warm-grey text-lg text-center mb-12">
            Everything you need to know about Housemait.
          </p>
          <div>
            {FAQS.map((faq, i) => (
              <FaqItem key={i} {...faq} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="bg-cream border-t border-light-grey">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <a href="/" className="flex items-center gap-2 mb-4">
                <img src="/housemait-logo2.png" alt="Housemait" className="h-7" />
              </a>
              <p className="text-sm text-warm-grey leading-relaxed">
                Family life, organised. AI-powered household management for modern UK families.
              </p>
            </div>
            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold text-charcoal mb-4 font-sans">Product</h4>
              <div className="space-y-3">
                {['Features', 'WhatsApp Bot', 'Meal Planning', 'How it Works'].map(l => (
                  <a key={l} href={`#${l.toLowerCase().replace(/\s+/g, '-')}`} className="block text-sm text-warm-grey hover:text-plum transition-colors">{l}</a>
                ))}
              </div>
            </div>
            {/* Company */}
            <div>
              <h4 className="text-sm font-semibold text-charcoal mb-4 font-sans">Company</h4>
              <div className="space-y-3">
                <Link to="/privacy" className="block text-sm text-warm-grey hover:text-plum transition-colors">Privacy Policy</Link>
                <a href="#" className="block text-sm text-warm-grey hover:text-plum transition-colors">Terms of Service</a>
                <a href="#" className="block text-sm text-warm-grey hover:text-plum transition-colors">Contact</a>
              </div>
            </div>
            {/* Connect */}
            <div>
              <h4 className="text-sm font-semibold text-charcoal mb-4 font-sans">Get Started</h4>
              <div className="space-y-3">
                <a href={SIGNUP_URL} className="block text-sm text-warm-grey hover:text-plum transition-colors">Sign Up</a>
                <a href={LOGIN_URL} className="block text-sm text-warm-grey hover:text-plum transition-colors">Log In</a>
              </div>
            </div>
          </div>
          {/* Bottom */}
          <div className="mt-12 pt-8 border-t border-light-grey flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-warm-grey">&copy; {new Date().getFullYear()} Housemait. All rights reserved.</p>
            <p className="text-xs text-warm-grey/60">Made with ❤️ for UK families</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
