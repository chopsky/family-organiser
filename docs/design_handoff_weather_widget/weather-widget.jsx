// Housemait — Weather widget (reference component)
// Standalone extract of WeatherStrip from src/screens-home.jsx.
// This is a DESIGN REFERENCE, not production code — recreate it in your
// codebase's framework/styling system. The `I.sparkle` icon dependency from
// the app has been inlined here as `SparkleIcon` so the file runs on its own.

// ── Weather glyphs — minimalist line icons, 24px viewBox ──────
const WX = {
  sun: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2"/>
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>
    </svg>
  ),
  partly: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3"/>
      <path d="M8 1.6v1.6M1.6 8h1.6M3.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1"/>
      <path d="M17 11.5a4 4 0 0 0-7.7-1.2A3.3 3.3 0 0 0 9.5 17h7.8a2.9 2.9 0 0 0 .2-5.5z" fill={p.fill||'none'}/>
    </svg>
  ),
  cloud: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18a4.2 4.2 0 0 1-.5-8.4 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 16.5 18z" fill={p.fill||'none'}/>
    </svg>
  ),
  rain: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 15a4.2 4.2 0 0 1-.5-8.4 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 16.5 15z" fill={p.fill||'none'}/>
      <path d="M8.5 18.5l-1 2M12 18.5l-1 2M15.5 18.5l-1 2"/>
    </svg>
  ),
};

// AI accent glyph (from the app's icon set — inlined here)
const SparkleIcon = (p={}) => (
  <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
    <path d="M12 2l1.8 4.7a4 4 0 0 0 2.5 2.5L21 11l-4.7 1.8a4 4 0 0 0-2.5 2.5L12 20l-1.8-4.7a4 4 0 0 0-2.5-2.5L3 11l4.7-1.8a4 4 0 0 0 2.5-2.5L12 2z"/>
  </svg>
);

const WX_COLOR = { sun:'#D89B3A', partly:'#D89B3A', cloud:'#8A93A3', rain:'#5B8DE0' };

// Demo forecast — static. In production, hydrate from a weather API (see README).
const HM_WEATHER = {
  city: 'Fulham',
  now: 16,
  cond: 'Partly sunny',
  icon: 'partly',
  high: 18,
  low: 9,
  rain: 10,
  note: "Dry through Mason's tennis at 15:30",
  hours: [
    { t:'Now',   tmp:16, icon:'partly' },
    { t:'13:00', tmp:17, icon:'sun'    },
    { t:'14:00', tmp:18, icon:'sun'    },
    { t:'15:00', tmp:17, icon:'partly' },
    { t:'16:00', tmp:15, icon:'cloud'  },
    { t:'17:00', tmp:14, icon:'cloud'  },
    { t:'18:00', tmp:13, icon:'partly' },
    { t:'19:00', tmp:12, icon:'partly' },
    { t:'20:00', tmp:11, icon:'cloud'  },
    { t:'21:00', tmp:10, icon:'cloud'  },
    { t:'22:00', tmp:10, icon:'rain'   },
    { t:'23:00', tmp:9,  icon:'rain'   },
    { t:'00:00', tmp:9,  icon:'rain'   },
    { t:'01:00', tmp:9,  icon:'cloud'  },
    { t:'02:00', tmp:8,  icon:'cloud'  },
    { t:'03:00', tmp:8,  icon:'cloud'  },
    { t:'04:00', tmp:7,  icon:'cloud'  },
    { t:'05:00', tmp:7,  icon:'partly' },
    { t:'06:00', tmp:8,  icon:'partly' },
    { t:'07:00', tmp:10, icon:'sun'    },
    { t:'08:00', tmp:12, icon:'sun'    },
    { t:'09:00', tmp:14, icon:'sun'    },
    { t:'10:00', tmp:16, icon:'partly' },
    { t:'11:00', tmp:17, icon:'sun'    },
  ],
};

function WeatherStrip({ onOpenAI, data = HM_WEATHER }) {
  const [open, setOpen] = React.useState(false);
  const w = data;
  const Big = WX[w.icon];
  return (
    <div style={{
      borderRadius:20, border:'1px solid var(--line)', overflow:'hidden',
      background:'linear-gradient(135deg, #EAF1FB 0%, #F4F0FB 52%, #FBF1E4 100%)',
    }}>
      {/* Top — current (always visible, tap to expand) */}
      <button
        onClick={()=>setOpen(o=>!o)}
        aria-expanded={open}
        style={{
          width:'100%', display:'flex', alignItems:'center', gap:14,
          padding:'14px 16px', border:0, background:'transparent',
          cursor:'pointer', fontFamily:'inherit', textAlign:'left',
        }}
      >
        <div style={{
          width:46, height:46, borderRadius:14, flexShrink:0,
          background:'rgba(255,255,255,0.7)', border:'1px solid rgba(255,255,255,0.9)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color: WX_COLOR[w.icon],
        }}>
          <Big size={28}/>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
            <span style={{ fontFamily:'Instrument Serif, serif', fontSize:34, lineHeight:1, color:'var(--ink)', letterSpacing:-0.5 }}>{w.now}°</span>
            <span style={{ fontSize:13, fontWeight:600, color:'var(--ink-2)' }}>{w.cond}</span>
          </div>
          <div style={{ fontSize:12, color:'var(--ink-3)', marginTop:3, display:'flex', gap:10, whiteSpace:'nowrap' }}>
            <span>{w.city}</span>
            <span>H {w.high}° · L {w.low}°</span>
            <span>{w.rain}% rain</span>
          </div>
        </div>
        {/* Chevron — rotates 180° when open */}
        <div style={{
          flexShrink:0, color:'var(--ink-3)', display:'flex',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform .25s ease',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </button>

      {/* Expandable region — animates via grid-template-rows 0fr→1fr */}
      <div style={{
        display:'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition:'grid-template-rows .28s ease',
      }}>
        <div style={{ overflow:'hidden' }}>
          {/* Hourly — horizontally swipeable, 24h. `.ios-scroll` hides the scrollbar. */}
          <div className="ios-scroll" style={{
            display:'flex', gap:4, overflowX:'auto', padding:'0 12px 12px',
            WebkitOverflowScrolling:'touch', scrollSnapType:'x proximity',
          }}>
            {w.hours.map((h,i) => {
              const Ic = WX[h.icon];
              const now = h.t === 'Now';
              return (
                <div key={i} style={{
                  flex:'1 0 auto', minWidth:52, textAlign:'center', scrollSnapAlign:'start',
                  padding:'8px 6px', borderRadius:13,
                  background: now ? 'rgba(255,255,255,0.8)' : 'transparent',
                  border: now ? '1px solid rgba(255,255,255,0.95)' : '1px solid transparent',
                }}>
                  <div style={{ fontSize:11, fontWeight:600, color: now ? 'var(--ink)' : 'var(--ink-3)', marginBottom:6 }}>{h.t}</div>
                  <div style={{ display:'flex', justifyContent:'center', color: WX_COLOR[h.icon], marginBottom:5 }}><Ic size={18}/></div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{h.tmp}°</div>
                </div>
              );
            })}
          </div>

          {/* AI note — taps through to the AI composer */}
          <button onClick={onOpenAI} style={{
            width:'100%', display:'flex', alignItems:'center', gap:8,
            padding:'10px 16px', border:0, borderTop:'1px solid rgba(26,22,32,0.05)',
            background:'rgba(255,255,255,0.4)', cursor:'pointer', fontFamily:'inherit', textAlign:'left',
          }}>
            <SparkleIcon size={13} color="var(--brand)"/>
            <span style={{ fontSize:12, color:'var(--brand-deep)', fontWeight:500 }}>{w.note}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WeatherStrip, WX, WX_COLOR, HM_WEATHER });
