// Housemait — "Up Next" card (reference component)
// Standalone extract of the two "Up next" cards from src/screens-home.jsx.
// DESIGN REFERENCE, not production code — recreate in your codebase's
// framework/styling system. The Avatar primitive and demo data are inlined
// so this file runs on its own.

// ── Demo data (inlined; in the app these come from FAMILY / SCHEDULE) ──
const MEMBERS = {
  g:  { id:'g',  name:'Grant', short:'G', color:'#6BA368' },
  em: { id:'em', name:'Emma',  short:'E', color:'#D8788A' },
  m:  { id:'m',  name:'Mason', short:'M', color:'#5B8DE0' },
  l:  { id:'l',  name:'Lily',  short:'L', color:'#D89B3A' },
};

// The "next event" the card features.
const NEXT_EVT = {
  title: "Mason · tennis",
  time: '15:30',
  end: '16:30',
  loc: "Bishop's Park courts",
  who: 'm',
  inMins: 47,            // minutes until it starts → "in 47 min"
  progress: 0.18,        // 0–1, how far through the lead-up window (light variant bar)
  // hero-variant extras:
  heroTitle: "Mason's tennis",
  heroSub: "15:30 · Bishop's Park courts · 8 min drive",
  heroDriver: 'm',
  heroDriverLabel: "You're driving",
};

// ── Avatar primitive (inlined from src/ui.jsx) ──
function Avatar({ member, size = 24 }) {
  if (!member) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: member.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 600, fontSize: size * 0.42, letterSpacing: -0.2, flexShrink: 0,
    }}>{member.short}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIANT A — Light "Up next" card (Dashboard home)
// White card, brand-purple kicker, avatar, thin progress bar.
// ─────────────────────────────────────────────────────────────
function UpNextLight({ evt = NEXT_EVT, onPress }) {
  const who = MEMBERS[evt.who];
  return (
    <div
      onClick={onPress}
      style={{
        background:'#fff', borderRadius:20, overflow:'hidden',
        border:'1px solid var(--line)',
        boxShadow:'0 1px 2px rgba(26,22,32,0.04)',
        cursor: onPress ? 'pointer' : 'default',
      }}
    >
      <div style={{ padding:'16px 18px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:2 }}>
            Up next · in {evt.inMins} min
          </div>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--ink)', letterSpacing:-0.3 }}>{evt.title}</div>
          <div style={{ fontSize:13, color:'var(--ink-3)', marginTop:2 }}>{evt.time}–{evt.end} · {evt.loc}</div>
        </div>
        <Avatar member={who} size={42}/>
      </div>
      {/* Progress bar — how close the event is */}
      <div style={{ height:6, background:'var(--bg-app-soft)', overflow:'hidden' }}>
        <div style={{ width:`${Math.round(evt.progress*100)}%`, height:'100%', background:'var(--brand)' }}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIANT B — Dark "Next up" hero card (AI-first home)
// Ink background, purple radial glow, Instrument Serif title, driver badge.
// ─────────────────────────────────────────────────────────────
function UpNextHero({ evt = NEXT_EVT, onPress }) {
  const driver = MEMBERS[evt.heroDriver];
  return (
    <div
      onClick={onPress}
      style={{
        background:'var(--ink)', color:'#fff', borderRadius:24,
        padding:'18px 20px', position:'relative', overflow:'hidden',
        cursor: onPress ? 'pointer' : 'default',
      }}
    >
      {/* Purple glow, top-right */}
      <div style={{
        position:'absolute', right:-30, top:-30, width:160, height:160, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(108,61,217,0.55), transparent 70%)',
      }}/>
      <div style={{ position:'relative' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.55)', marginBottom:8 }}>
          Next up
        </div>
        <div style={{ fontSize:24, fontFamily:'Instrument Serif, serif', letterSpacing:-0.4 }}>{evt.heroTitle}</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.7)', marginTop:4 }}>{evt.heroSub}</div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:14 }}>
          <Avatar member={driver} size={28}/>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.7)' }}>{evt.heroDriverLabel}</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { UpNextLight, UpNextHero, Avatar, NEXT_EVT, MEMBERS });
