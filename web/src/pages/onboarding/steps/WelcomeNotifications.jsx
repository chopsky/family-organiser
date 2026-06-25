// The four iOS-style notifications scattered at the viewport corners on the
// welcome step. Staggered drop-in, gentle continuous hover, then drift outward
// to their own corners + fade when leaving (driven by the `leaving` prop).
// Hidden under 880px. Decorative, so aria-hidden. Animations live in index.css
// and are neutralised by the global prefers-reduced-motion rule; `reduced` also
// drops the float/drop classes so the cards simply sit still and fade.

const MsgIcon = () => (
  <span className="ob-notif-tile" style={{ background: '#2BD24A' }}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 4C6.9 4 3 7.2 3 11.2c0 1.8.8 3.4 2.1 4.6L4 20l4.5-1.6c1.1.3 2.3.5 3.5.5 5.1 0 9-3.2 9-7.2S17.1 4 12 4z" /></svg>
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
const MailIcon = () => (
  <span className="ob-notif-tile" style={{ background: '#1F8EF1' }}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>
  </span>
);
const WaIcon = () => (
  <span className="ob-notif-tile" style={{ background: '#25A35A' }}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3zm0 2a7 7 0 1 1-3.6 13l-.3-.2-2.4.6.6-2.3-.2-.3A7 7 0 0 1 12 5z" /></svg>
  </span>
);

const NOTES = [
  { cls: 'ob-n1', icon: <MsgIcon />, title: 'Sam', time: 'now', body: "Who's getting the kids today? We're out of milk." },
  { cls: 'ob-n2', icon: <CalIcon />, title: "Leo's birthday party 🎂", time: '9:02', body: "Saturday 14:00 · don't forget a present!" },
  { cls: 'ob-n3', icon: <MailIcon />, title: 'Oakfield Primary', time: '08:14', sub: 'Non-uniform day Friday', body: 'Just a reminder children may wear their own clothes this Friday…' },
  { cls: 'ob-n4', icon: <WaIcon />, title: 'Class Parents 💬', time: '07:48', sub: 'Priya', body: "Don't forget World Book Day costumes tomorrow! 📚" },
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
