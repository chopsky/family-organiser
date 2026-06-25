// The four iOS-style notifications scattered at the viewport corners on the
// welcome step. Staggered drop-in, gentle continuous hover, then drift outward
// to their own corners + fade when leaving (driven by the `leaving` prop).
// Hidden under 880px. Decorative, so aria-hidden. Animations live in index.css
// (ob-*) and are neutralised by the global prefers-reduced-motion rule; the
// `reduced` prop also drops the float so the cards simply sit still.

// Real iOS app icons (the rounded-square shape + gradient are baked into each
// SVG), copied to /public/onboarding-icons. Rendered edge-to-edge in the tile,
// so no coloured background of our own.
const AppIcon = ({ src }) => (
  <span className="ob-notif-tile" style={{ background: 'transparent' }}>
    <img src={src} alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  </span>
);
const CalIcon = () => (
  <span className="ob-notif-tile" style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)' }}>
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
      <span style={{ fontSize: 8, fontWeight: 800, color: '#FF3B30', letterSpacing: '0.06em', marginBottom: 1 }}>SAT</span>
      <span style={{ fontSize: 18, fontWeight: 500, color: '#1A1620', lineHeight: 1 }}>14</span>
    </span>
  </span>
);

const NOTES = [
  { cls: 'ob-n1', icon: <AppIcon src="/onboarding-icons/messages.svg" />, title: 'Sam', time: 'now', body: "Who's getting the kids today? We're out of milk." },
  { cls: 'ob-n2', icon: <CalIcon />, title: "Leo's birthday party 🎂", time: '9:02', body: "Saturday 14:00 · don't forget a present!" },
  { cls: 'ob-n3', icon: <AppIcon src="/onboarding-icons/mail.svg" />, title: 'Oakfield Primary', time: '08:14', sub: 'Non-uniform day Friday', body: 'Just a reminder children may wear their own clothes this Friday…' },
  { cls: 'ob-n4', icon: <AppIcon src="/onboarding-icons/whatsapp.svg" />, title: 'Class Parents 💬', time: '07:48', sub: 'Priya', body: "Don't forget World Book Day costumes tomorrow! 📚" },
];

export default function WelcomeNotifications({ leaving = false, reduced = false }) {
  return (
    <div aria-hidden="true" className={`ob-notifs${leaving ? ' ob-leaving' : ''}${reduced ? ' ob-reduced' : ''}`}>
      {NOTES.map((n) => (
        <div key={n.cls} className={`ob-notif ${n.cls}`}>
          <span className="ob-notif-ico">{n.icon}</span>
          <div className="ob-notif-bd">
            <div className="ob-notif-r1"><span className="ob-notif-t">{n.title}</span><span className="ob-notif-tm">{n.time}</span></div>
            {n.sub && <div className="ob-notif-sub">{n.sub}</div>}
            <div className="ob-notif-bo">{n.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
