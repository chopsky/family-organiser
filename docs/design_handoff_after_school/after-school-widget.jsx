// Housemait — "After School" dashboard widget (reference component)
// Standalone extract from src/screens-home.jsx (component AfterSchool) +
// src/data.jsx (ACTIVITIES). DESIGN REFERENCE, not production code — recreate
// in your codebase's framework/styling system. Card / CardHeader / Avatar
// primitives and demo data are inlined so this file runs on its own.

// ── Family + activity demo data (inlined from src/data.jsx) ──
const AS_MEMBERS = {
  g:  { id:'g',  name:'Grant', short:'G', color:'#6BA368' },  // parent (pickup)
  em: { id:'em', name:'Emma',  short:'E', color:'#D8788A' },  // parent (pickup)
  m:  { id:'m',  name:'Mason', short:'M', color:'#5B8DE0' },  // kid, 11
  l:  { id:'l',  name:'Lily',  short:'L', color:'#D89B3A' },  // kid, 8
};

// who = kid id · pickup = parent id · icon → AS_ICONS key
const AS_ACTIVITIES = [
  { id:'a1', day:'MON', who:'m', activity:'Football training', icon:'ball',   time:'15:45', end:'17:00', loc:'School pitch',          pickup:'g'  },
  { id:'a2', day:'MON', who:'l', activity:'Art club',          icon:'art',    time:'15:30', end:'16:30', loc:'Room 4',                pickup:'em' },
  { id:'a3', day:'TUE', who:'m', activity:'Tennis',            icon:'tennis', time:'15:30', end:'16:30', loc:"Bishop's Park courts",  pickup:'g'  },
  { id:'a4', day:'WED', who:'l', activity:'Ballet',            icon:'ballet', time:'16:00', end:'17:00', loc:"St Mary's hall",        pickup:'em' },
  { id:'a5', day:'WED', who:'m', activity:'Coding club',       icon:'code',   time:'15:30', end:'16:45', loc:'ICT suite',             pickup:'em' },
  { id:'a6', day:'THU', who:'m', activity:'Swimming',          icon:'swim',   time:'16:00', end:'17:15', loc:'Leisure centre',        pickup:'g'  },
  { id:'a7', day:'THU', who:'l', activity:'Choir',             icon:'music',  time:'15:30', end:'16:15', loc:'Music room',            pickup:'g'  },
  { id:'a8', day:'FRI', who:'l', activity:'Gymnastics',        icon:'gym',    time:'15:45', end:'17:00', loc:'Sports hall',           pickup:'em' },
];
const AS_DAYS = ['MON','TUE','WED','THU','FRI'];

// ── Inlined primitives (from src/ui.jsx) ──
function Card({ children, style = {}, padding = 18 }) {
  return (
    <div style={{
      background:'#fff', borderRadius:22, padding,
      boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)', ...style,
    }}>{children}</div>
  );
}

function CardHeader({ title, action, onAction, eyebrow }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:14 }}>
      <div>
        {eyebrow && <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:4 }}>{eyebrow}</div>}
        <div style={{ fontSize:17, fontWeight:700, color:'var(--ink)', letterSpacing:-0.2 }}>{title}</div>
      </div>
      {action && (
        <button onClick={onAction} style={{
          background:'transparent', border:0, padding:0, cursor:'pointer',
          color:'var(--brand)', fontWeight:600, fontSize:13, fontFamily:'inherit',
          display:'flex', alignItems:'center', gap:4,
        }}>{action} ›</button>
      )}
    </div>
  );
}

function Avatar({ member, size = 24 }) {
  if (!member) return null;
  return (
    <div style={{
      width:size, height:size, borderRadius:'50%',
      background:member.color, color:'#fff',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:600, fontSize:size*0.42, letterSpacing:-0.2, flexShrink:0,
    }}>{member.short}</div>
  );
}

// ── Activity glyphs — line icons, 24px viewBox, 1.7px stroke ──
const AS_ICONS = {
  ball: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 3l2.6 4.5h-5.2L12 3zM3.3 9.6l4.8.6 1.6 5-4 2.6-2.4-8.2zM20.7 9.6l-2.4 8.2-4-2.6 1.6-5 4.8-.6zM8.5 19.5L12 16l3.5 3.5"/>
    </svg>
  ),
  tennis: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M5.6 5.6a13 13 0 0 0 0 12.8M18.4 5.6a13 13 0 0 1 0 12.8"/>
    </svg>
  ),
  art: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.4-1-1.6-1-2.8 0-.8.7-1.2 1.6-1.2H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/>
      <circle cx="7.5" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>
    </svg>
  ),
  ballet: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4.5" r="2"/><path d="M12 7v6M12 13l-4 8M12 13l4 8M7 10l5 3 5-3"/>
    </svg>
  ),
  code: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>
    </svg>
  ),
  swim: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="15" cy="7" r="2"/><path d="M5 13l4-2.5 3 2 2.5-1.5M3 17.5c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M8.5 11.5L12 8l-2-1.5"/>
    </svg>
  ),
  music: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/><path d="M9 17.5V6l11-2v9.5"/><path d="M9 9l11-2"/>
    </svg>
  ),
  gym: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9v6M5 7v10M19 7v10M22 9v6M5 12h14"/>
    </svg>
  ),
};

function memberById(id) { return AS_MEMBERS[id]; }

// ── After School widget ───────────────────────────────────────
// Weekday selector (Mon–Fri) + the selected day's kid activities with pickup.
function AfterSchool({ activities = AS_ACTIVITIES, days = AS_DAYS, defaultDay = 'MON', onViewCalendar }) {
  const countFor = (d) => activities.filter(a=>a.day===d).length;
  const [day, setDay] = React.useState(defaultDay);
  const items = activities.filter(a=>a.day===day);

  return (
    <Card>
      <CardHeader title="After school" eyebrow="The kids" action="Calendar" onAction={onViewCalendar}/>

      {/* Day selector */}
      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        {days.map(d=>{
          const active = d===day;
          const n = countFor(d);
          return (
            <button key={d} onClick={()=>setDay(d)} style={{
              flex:1, padding:'8px 0 7px', borderRadius:12, border:0, cursor:'pointer',
              fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'center', gap:5,
              background: active ? 'var(--brand)' : 'var(--bg-app-soft)',
              transition:'background .15s ease',
            }}>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.04em', color: active ? '#fff' : 'var(--ink-2)' }}>{d}</span>
              <span style={{
                width:5, height:5, borderRadius:'50%',
                background: n ? (active ? 'rgba(255,255,255,0.85)' : 'var(--brand)') : 'transparent',
              }}/>
            </button>
          );
        })}
      </div>

      {/* Activities for the selected day */}
      {items.length === 0 ? (
        <div style={{ padding:'18px 0', textAlign:'center', fontSize:13, color:'var(--ink-3)', fontStyle:'italic' }}>
          No clubs — straight home.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {items.map(a=>{
            const kid = memberById(a.who);
            const picker = memberById(a.pickup);
            const Icon = AS_ICONS[a.icon] || AS_ICONS.ball;
            return (
              <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12 }}>
                {/* Time */}
                <div style={{ width:42, flexShrink:0, fontSize:13, fontWeight:600, color:'var(--ink-3)', fontVariantNumeric:'tabular-nums' }}>{a.time}</div>
                {/* Icon tile, tinted to the kid's color (1F ≈ 12% alpha) */}
                <div style={{
                  width:38, height:38, borderRadius:11, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background: kid.color+'1F', color: kid.color,
                }}>
                  <Icon size={20} color={kid.color}/>
                </div>
                {/* Title + location */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.activity}</div>
                  <div style={{ fontSize:12, color:'var(--ink-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{kid.name} · {a.loc}</div>
                </div>
                {/* Pickup */}
                <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink-3)', lineHeight:1.3 }}>Pickup</div>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--ink-2)', lineHeight:1.2 }}>{picker.name}</div>
                  </div>
                  <Avatar member={picker} size={26}/>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

Object.assign(window, { AfterSchool, AS_ICONS, AS_ACTIVITIES, AS_DAYS, AS_MEMBERS, Card, CardHeader, Avatar });
