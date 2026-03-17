import { useState } from 'react'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'FAQ', href: '#faq' },
]

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
    ),
    title: 'Shopping Lists',
    description: 'Create and share shopping lists with your family. Items are auto-categorised so you never miss an aisle.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    title: 'Task Management',
    description: 'Assign tasks to family members with due dates. Everyone stays accountable and nothing falls through the cracks.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
      </svg>
    ),
    title: 'Receipt Scanner',
    description: 'Snap a photo of your receipt and Anora automatically checks off what you bought from the shopping list.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
      </svg>
    ),
    title: 'Telegram Bot',
    description: 'Add items, assign tasks and check your lists — all from a family Telegram group. No app switching needed.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
    title: 'Weekly Digest',
    description: 'Get a weekly email summarising completed tasks, upcoming items and what your family accomplished together.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
      </svg>
    ),
    title: 'Voice Notes',
    description: 'Send a voice message and Anora transcribes it into shopping items or tasks. Hands-free family organising.',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Create your household',
    description: 'Sign up and invite your family members. Everyone gets their own account linked to a shared household.',
  },
  {
    num: '02',
    title: 'Add your lists and tasks',
    description: 'Type naturally — Anora\'s AI classifies what goes on the shopping list vs what becomes a task.',
  },
  {
    num: '03',
    title: 'Connect your Telegram group',
    description: 'Add the Anora bot to your family chat. Now everyone can manage lists without opening another app.',
  },
  {
    num: '04',
    title: 'Stay in sync',
    description: 'Scan receipts after shopping, get weekly digests, and watch your family run like clockwork.',
  },
]

const FAQS = [
  {
    q: 'Is Anora free?',
    a: 'Yes. Anora is completely free for families to use.',
  },
  {
    q: 'How does the Telegram bot work?',
    a: 'Once you connect the Anora bot to your family Telegram group, anyone can add items, assign tasks, or check the shopping list by simply sending a message. The bot understands natural language.',
  },
  {
    q: 'How does the receipt scanner work?',
    a: 'Take a photo of your grocery receipt and Anora uses AI to read the items. It automatically ticks off matching items from your shopping list so you know exactly what\'s been bought.',
  },
  {
    q: 'Can I use Anora without Telegram?',
    a: 'Absolutely. The web app has everything you need. Telegram is an optional add-on for families who prefer chatting over apps.',
  },
  {
    q: 'How many people can be in a household?',
    a: 'There\'s no limit. Invite as many family members as you need.',
  },
]

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-6 text-left cursor-pointer"
      >
        <span className="text-lg font-medium text-gray-900 pr-8">{q}</span>
        <span className={`text-2xl text-gray-400 transition-transform duration-300 shrink-0 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-40 pb-6' : 'max-h-0'}`}>
        <p className="text-gray-600 leading-relaxed">{a}</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gray-900 flex items-center justify-center">
              <img src="/anora-logomark-white.png" alt="" className="h-4 w-4" />
            </div>
            <span className="text-lg font-bold text-gray-900 tracking-tight">Anora</span>
          </a>
          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} className="text-sm text-gray-600 hover:text-gray-900 transition-colors">{l.label}</a>
            ))}
          </div>
          <a
            href="https://anora.app/signup"
            className="bg-lime-400 hover:bg-lime-500 text-gray-900 text-sm font-semibold px-5 py-2 rounded-full transition-colors"
          >
            Get started
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-peach-100 via-peach-50 to-white" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-32 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-1.5 rounded-full mb-8">
            <span className="bg-peach-400 text-white text-xs font-bold px-2 py-0.5 rounded-full">NEW</span>
            <span>Telegram bot for the whole family</span>
            <span className="ml-1">&rarr;</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 mb-6">
            Family life,<br />organised
          </h1>
          <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10 leading-relaxed">
            Shopping lists, tasks, receipts and more — managed together from one app or your family Telegram group.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://anora.app/signup"
              className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-8 py-3.5 rounded-full text-base transition-colors"
            >
              Get started — it's free
            </a>
            <a
              href="#features"
              className="text-gray-600 hover:text-gray-900 font-medium text-base transition-colors"
            >
              See how it works &darr;
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4">
            Everything your household needs
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Built for real families who want less chaos and more time together.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="group relative bg-warm-gray rounded-2xl p-8 hover:shadow-lg transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-gray-900 mb-5 shadow-sm">
                {f.icon}
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-gray-600 leading-relaxed text-[15px]">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-warm-gray">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4">
              Up and running in minutes
            </h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              No complicated setup. Just sign up and start organising.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {STEPS.map(s => (
              <div key={s.num} className="bg-white rounded-2xl p-8">
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-sm font-mono text-peach-500 font-bold">{s.num}</span>
                  <span className="text-sm font-mono text-gray-300">/ 04</span>
                  <span className="text-sm text-gray-500 ml-1">{s.title}</span>
                </div>
                <p className="text-xl md:text-2xl font-medium text-gray-900 leading-snug">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-peach-400 via-peach-500 to-peach-600" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
        <div className="relative max-w-3xl mx-auto px-6 py-24 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-6">
            Your family deserves less mental load
          </h2>
          <p className="text-peach-100 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Join families who've simplified their daily routines with Anora.
          </p>
          <a
            href="https://anora.app/signup"
            className="inline-flex bg-white hover:bg-gray-50 text-gray-900 font-semibold px-8 py-3.5 rounded-full text-base transition-colors"
          >
            Get started for free
          </a>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-24">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4 text-center">
          Frequently asked questions
        </h2>
        <p className="text-gray-600 text-lg text-center mb-12">
          Everything you need to know about Anora.
        </p>
        <div>
          {FAQS.map((faq, i) => (
            <FaqItem key={i} {...faq} />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-gray-300 flex items-center justify-center">
              <img src="/anora-logomark-white.png" alt="" className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-bold text-gray-400 tracking-tight">Anora</span>
          </div>
          <p className="text-sm text-gray-400">&copy; {new Date().getFullYear()} Anora. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
