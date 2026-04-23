// Shared UI primitives for Housemait iOS
const { useState, useEffect, useRef, useMemo } = React;

// ── Avatar ────────────────────────────────────────────────────
function Avatar({ member, size=24 }) {
  if (!member) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: member.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 600, fontSize: size * 0.42, letterSpacing: -0.2,
      flexShrink: 0,
    }}>{member.short}</div>
  );
}

function AvatarStack({ members, size=22 }) {
  return (
    <div style={{ display:'flex' }}>
      {members.map((m,i)=>(
        <div key={m.id} style={{ marginLeft: i===0 ? 0 : -7, border:'2px solid #FAF7F2', borderRadius:'50%' }}>
          <Avatar member={m} size={size} />
        </div>
      ))}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────
function Card({ children, style={}, onClick, padding=18 }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 22,
      padding,
      boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
      ...style,
    }}>{children}</div>
  );
}

function CardHeader({ title, action, onAction, eyebrow }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom: 14 }}>
      <div>
        {eyebrow && <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:4 }}>{eyebrow}</div>}
        <div style={{ fontSize:17, fontWeight:700, color:'var(--ink)', letterSpacing:-0.2 }}>{title}</div>
      </div>
      {action && (
        <button onClick={onAction} style={{
          background:'transparent', border:0, padding:0, cursor:'pointer',
          color:'var(--brand)', fontWeight:600, fontSize:13, fontFamily:'inherit',
          display:'flex', alignItems:'center', gap:4,
        }}>{action}<I.arrow size={12} w={2.2}/></button>
      )}
    </div>
  );
}

// ── Checkbox ─────────────────────────────────────────────────
function Checkbox({ checked, onChange, color='var(--brand)' }) {
  return (
    <button onClick={(e)=>{e.stopPropagation(); onChange(!checked);}} style={{
      width: 22, height: 22, borderRadius: '50%',
      border: checked ? `2px solid ${color}` : '1.5px solid var(--line-strong)',
      background: checked ? color : 'transparent',
      display:'flex', alignItems:'center', justifyContent:'center',
      padding:0, cursor:'pointer', flexShrink: 0,
      transition: 'all 0.15s ease',
    }}>
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

// ── Tag / chip ───────────────────────────────────────────────
function Chip({ children, bg, fg, style={} }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center',
      padding:'3px 8px', borderRadius:6,
      background: bg||'var(--bg-app-soft)', color: fg||'var(--ink-2)',
      fontSize:10, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase',
      ...style,
    }}>{children}</span>
  );
}

// ── Tab Bar ──────────────────────────────────────────────────
function MoreIcon({ size=24, w=1.8, color='currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round">
      <circle cx="5" cy="12" r="1.4" fill={color}/>
      <circle cx="12" cy="12" r="1.4" fill={color}/>
      <circle cx="19" cy="12" r="1.4" fill={color}/>
    </svg>
  );
}
function MoreIconFill(p={}) { return <MoreIcon {...p}/>; }

function TabBar({ active, onChange, onAITap, onMore }) {
  const MORE_IDS = ['meal','receipt','docs','family'];
  const moreActive = MORE_IDS.includes(active);
  const tabs = [
    { id:'home',  label:'Home',     I:I.home,  Fill:I.homeFill  },
    { id:'cal',   label:'Calendar', I:I.cal,   Fill:I.calFill   },
    { id:'tasks', label:'Tasks',    I:I.check, Fill:I.checkFill },
    { id:'shop',  label:'Shopping', I:I.cart,  Fill:I.cartFill  },
    { id:'more',  label:'More',     I:MoreIcon, Fill:MoreIconFill, isMore:true, forceActive:moreActive },
  ];
  return (
    <div style={{
      position:'absolute', bottom:0, left:0, right:0, zIndex: 40,
      paddingBottom: 26, paddingTop: 8,
      background: 'linear-gradient(to top, rgba(250,247,242,0.95) 60%, rgba(250,247,242,0.6) 80%, rgba(250,247,242,0))',
      backdropFilter:'blur(14px) saturate(180%)',
      WebkitBackdropFilter:'blur(14px) saturate(180%)',
    }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-around', padding:'0 8px', position:'relative' }}>
        {/* Floating AI FAB */}
        <button onClick={onAITap} style={{
          position:'absolute', top:-56, right:16, zIndex:2,
          width:56, height:56, borderRadius:18,
          background:'linear-gradient(135deg, var(--brand) 0%, #8E5FFF 100%)',
          border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'#fff',
          boxShadow:'0 10px 24px rgba(108,61,217,0.45), inset 0 2px 0 rgba(255,255,255,0.3)',
        }}>
          <I.sparkle size={24} color="#fff"/>
        </button>

        {tabs.map(t => {
          const isActive = t.forceActive || t.id === active;
          const Icon = isActive ? t.Fill : t.I;
          return (
            <button key={t.id} onClick={()=> t.isMore ? onMore() : onChange(t.id)} style={{
              flex:1, background:'transparent', border:0, cursor:'pointer',
              display:'flex', flexDirection:'column', alignItems:'center', gap:3,
              padding:'4px 0', maxWidth:80,
              color: isActive ? 'var(--brand)' : 'var(--ink-3)',
              fontFamily:'inherit',
            }}>
              <Icon size={26} w={1.7}/>
              <span style={{ fontSize:10, fontWeight:600, letterSpacing:0.1 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── App-style status bar (transparent over content) ──────────
function AppStatusBar({ time='9:41', dark=false }) {
  return <IOSStatusBar time={time} dark={dark} />;
}

// ── AI composer (used on Home + as raised modal) ─────────────
function AIComposer({ value, onChange, onSubmit, onFocus, onMic, autoFocus=false, placeholder, dense=false }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8,
      background:'#fff', borderRadius: dense?16:18,
      padding: dense ? '8px 8px 8px 14px' : '10px 10px 10px 16px',
      boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 6px 18px rgba(26,22,32,0.05)',
      border:'1px solid rgba(26,22,32,0.05)',
    }}>
      <input
        value={value}
        onChange={e=>onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={e=>{ if(e.key==='Enter') onSubmit(); }}
        autoFocus={autoFocus}
        placeholder={placeholder || 'Ask AI to add events, tasks, recipes…'}
        style={{
          flex:1, border:0, outline:'none', background:'transparent',
          fontFamily:'inherit', fontSize:15, color:'var(--ink)',
          minWidth:0,
        }}
      />
      <button onClick={onMic} style={{
        width:34, height:34, borderRadius:'50%',
        background:'transparent', border:0, cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'var(--ink-3)',
      }}>
        <I.mic size={18}/>
      </button>
      <button onClick={onSubmit} style={{
        width:36, height:36, borderRadius:'50%',
        background:'var(--brand)', border:0, cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'#fff',
        boxShadow:'0 2px 8px rgba(108,61,217,0.3)',
      }}>
        <I.send size={16}/>
      </button>
    </div>
  );
}

// ── Inline brand mark ────────────────────────────────────────
function Brandmark({ size=22 }) {
  // Logo is 1000×162 → aspect ratio ~6.17. Match to the given `size` as wordmark height.
  return (
    <img
      src="assets/housemait-logo.png"
      alt="housemait"
      style={{ height: size, width:'auto', display:'block' }}
    />
  );
}

// ── Shared top bar used across every screen (brand + bell + avatar) ──
function ScreenTopBar({ onSettings, onBack, title }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 20px 14px',
    }}>
      {onBack ? (
        <button onClick={onBack} style={{
          width:36, height:36, borderRadius:11,
          background:'var(--bg-app-soft)', border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="10" height="16" viewBox="0 0 10 16"><path d="M8 2L2 8l6 6" stroke="var(--ink-2)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      ) : (
        <Brandmark size={22}/>
      )}
      <div style={{ display:'flex', gap:8 }}>
        <button style={{
          width:36, height:36, borderRadius:11,
          background:'var(--bg-app-soft)', border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}><I.bell size={18} color="var(--ink-2)"/></button>
        <button onClick={onSettings} style={{ padding:0, border:0, background:'transparent', cursor:'pointer' }}>
          <Avatar member={memberById('g')} size={36}/>
        </button>
      </div>
    </div>
  );
}

// ── Section title (large, in-screen) ─────────────────────────
function SectionTitle({ kicker, title, action, onAction }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom: 12 }}>
      <div>
        {kicker && <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:4 }}>{kicker}</div>}
        <div style={{ fontSize:22, fontWeight:700, letterSpacing:-0.4, color:'var(--ink)' }}>{title}</div>
      </div>
      {action && (
        <button onClick={onAction} style={{
          background:'transparent', border:0, padding:0, cursor:'pointer',
          color:'var(--brand)', fontWeight:600, fontSize:13, fontFamily:'inherit',
          display:'flex', alignItems:'center', gap:4,
        }}>{action}<I.arrow size={12} w={2.2}/></button>
      )}
    </div>
  );
}

Object.assign(window, {
  Avatar, AvatarStack, Card, CardHeader, Checkbox, Chip,
  TabBar, AppStatusBar, AIComposer, Brandmark, ScreenTopBar, SectionTitle,
});
