// Home screen — two variations
const { FAMILY: HM_FAMILY, TODAY: HM_TODAY, SCHEDULE: HM_SCHEDULE, AI_CHIPS: HM_AI_CHIPS } = window.HM_DATA;

function memberById(id) { return HM_FAMILY.members.find(m=>m.id===id); }

// ── Variation A: Dashboard (glanceable, like desktop) ────────
function HomeDashboard({ tasks, onToggleTask, groceries, meals, onOpenAI, onTab, onSettings }) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();
  const eventsToday = HM_SCHEDULE.length;
  const openTasks = tasks.filter(t=>!t.done).length;
  const openGroc  = groceries.filter(g=>!g.done).length;
  const nextEvt   = HM_SCHEDULE[0];

  return (
    <div style={{ padding:'70px 20px 130px', display:'flex', flexDirection:'column', gap:18 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <Brandmark size={22}/>
        <div style={{ display:'flex', gap:8 }}>
          <button style={iconBtn}><I.bell size={18} color="var(--ink-2)"/></button>
          <button onClick={onSettings} style={{ padding:0, border:0, background:'transparent', cursor:'pointer' }}>
            <Avatar member={memberById('g')} size={36}/>
          </button>
        </div>
      </div>
      <div>
        <div style={{
          fontFamily:'Instrument Serif, serif', fontSize:36, lineHeight:1.05,
          color:'var(--ink)', letterSpacing:-0.8, marginBottom:6,
        }}>
          {greeting},<br/>
          <span style={{ fontStyle:'italic' }}>Grant.</span>
        </div>
        <div style={{ fontSize:13, color:'var(--ink-3)', fontWeight:500 }}>
          {HM_TODAY.long} · {eventsToday} events, {openTasks} tasks
        </div>
      </div>

      {/* AI composer */}
      <AIComposer
        value=""
        onChange={()=>{}}
        onSubmit={onOpenAI}
        onFocus={onOpenAI}
        onMic={onOpenAI}
        placeholder="Ask, plan, or scan…"
      />

      {/* Up next — featured */}
      <Card padding={0} style={{ overflow:'hidden' }}>
        <div style={{ padding:'16px 18px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:2 }}>Up next · in 47 min</div>
            <div style={{ fontSize:18, fontWeight:700, color:'var(--ink)', letterSpacing:-0.3 }}>{nextEvt.title}</div>
            <div style={{ fontSize:13, color:'var(--ink-3)', marginTop:2 }}>{nextEvt.time}–{nextEvt.end} · {nextEvt.loc}</div>
          </div>
          <Avatar member={memberById(nextEvt.who)} size={42}/>
        </div>
        <div style={{ height:6, background:'var(--bg-app-soft)', overflow:'hidden' }}>
          <div style={{ width:'18%', height:'100%', background:'var(--brand)' }}/>
        </div>
      </Card>

      {/* Today schedule */}
      <Card>
        <CardHeader title="Today's schedule" action="Calendar" onAction={()=>onTab('cal')}/>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {HM_SCHEDULE.map((s,i) => (
            <div key={s.id} style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ width:54, fontSize:13, color:'var(--ink-3)', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>{s.time}</div>
              <div style={{ width:4, height:36, borderRadius:2, background:s.color }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>{s.title}</div>
                <div style={{ fontSize:12, color:'var(--ink-3)' }}>{s.loc}</div>
              </div>
              {s.who !== 'all' && <Avatar member={memberById(s.who)} size={26}/>}
              {s.who === 'all' && <AvatarStack members={HM_FAMILY.members} size={22}/>}
            </div>
          ))}
        </div>
      </Card>

      {/* Tasks — full width */}
      <Card>
        <CardHeader title="Tasks" eyebrow={`${openTasks} open`} action="View all" onAction={()=>onTab('tasks')}/>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {tasks.filter(t=>!t.done).slice(0,5).map(t=>(
            <div key={t.id} style={{ display:'flex', gap:12, alignItems:'center' }}>
              <Checkbox checked={t.done} onChange={()=>onToggleTask(t.id)} color={window.HM_DATA.TASK_CAT_COLORS[t.cat]}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, color:'var(--ink)', fontWeight:500 }}>{t.title}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:2 }}>
                  <span style={{
                    fontSize:10, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase',
                    color: window.HM_DATA.TASK_CAT_COLORS[t.cat],
                  }}>{t.cat}</span>
                  <span style={{ fontSize:11, color:'var(--ink-3)' }}>· {t.due}</span>
                </div>
              </div>
              <Avatar member={memberById(t.who)} size={24}/>
            </div>
          ))}
        </div>
      </Card>

      {/* Groceries — full width */}
      <Card>
        <CardHeader title="Grocery list" eyebrow={`${openGroc} items`} action="Open list" onAction={()=>onTab('shop')}/>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {groceries.filter(g=>!g.done).slice(0,5).map(g=>{
            const cc = window.HM_DATA.CAT_COLORS[g.cat];
            return (
              <div key={g.id} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <Chip bg={cc.bg} fg={cc.fg} style={{ minWidth:48, justifyContent:'center', display:'inline-flex' }}>{g.cat}</Chip>
                <span style={{ fontSize:14, color:'var(--ink)', fontWeight:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</span>
                <span style={{ fontSize:12, color:'var(--ink-3)' }}>{g.qty}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* This week's meals */}
      <Card>
        <CardHeader title="This week's meals" action="Plan" onAction={()=>onTab('meal')}/>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {meals.slice(0,4).map(m=>(
            <div key={m.day} style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'8px 10px', borderRadius:12,
              background: m.day==='SAT' ? 'var(--brand-soft)' : 'transparent',
            }}>
              <div style={{ width:40, fontSize:11, fontWeight:700, color: m.day==='SAT' ? 'var(--brand)' : 'var(--ink-3)' }}>{m.day} {m.date}</div>
              <div style={{ flex:1, fontSize:13, fontWeight: m.meal ? 600 : 400, color: m.meal ? 'var(--ink)' : 'var(--ink-3)', fontStyle: m.meal ? 'normal' : 'italic' }}>
                {m.meal || 'Not planned yet'}
              </div>
              {m.who && <span style={{ fontSize:11, color:'var(--ink-3)' }}>{m.who}</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* Family card */}
      <Card>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:4 }}>Household</div>
            <div style={{ fontSize:15, fontWeight:600, color:'var(--ink)' }}>The Reid family · 4</div>
          </div>
          <AvatarStack members={HM_FAMILY.members} size={32}/>
        </div>
      </Card>
    </div>
  );
}

// ── Variation B: AI-first ────────────────────────────────────
function HomeAIFirst({ tasks, onToggleTask, groceries, meals, onOpenAI, onTab, onSettings }) {
  return (
    <div style={{ padding:'70px 20px 130px', display:'flex', flexDirection:'column', gap:20 }}>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <Brandmark size={22}/>
        <div style={{ display:'flex', gap:8 }}>
          <button style={iconBtn}><I.bell size={18} color="var(--ink-2)"/></button>
          <button onClick={onSettings} style={{ padding:0, border:0, background:'transparent', cursor:'pointer' }}>
            <Avatar member={memberById('g')} size={36}/>
          </button>
        </div>
      </div>

      {/* Hero greeting + serif */}
      <div style={{ paddingTop:8 }}>
        <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:8 }}>
          {HM_TODAY.weekday} · {HM_TODAY.date}
        </div>
        <div style={{
          fontFamily:'Instrument Serif, serif', fontSize:46, lineHeight:1, letterSpacing:-1.2,
          color:'var(--ink)',
        }}>
          What can I<br/><span style={{ fontStyle:'italic', color:'var(--brand)' }}>handle</span> for you?
        </div>
        <div style={{ marginTop:14, fontSize:14, color:'var(--ink-2)', lineHeight:1.5 }}>
          You've got <b>{HM_SCHEDULE.length} events</b> and <b>{tasks.filter(t=>!t.done).length} tasks</b> today. Mason's tennis is in <b>47 min</b>.
        </div>
      </div>

      {/* Composer */}
      <AIComposer
        value=""
        onChange={()=>{}}
        onSubmit={onOpenAI}
        onFocus={onOpenAI}
        onMic={onOpenAI}
        placeholder="Add an event, plan a meal, scan a receipt…"
      />

      {/* Quick-action chips */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {HM_AI_CHIPS.map(c => (
          <button key={c} onClick={onOpenAI} style={{
            padding:'8px 12px', borderRadius:99,
            background:'#fff', border:'1px solid var(--line)',
            fontSize:12, fontWeight:500, color:'var(--ink-2)', cursor:'pointer',
            fontFamily:'inherit',
            display:'inline-flex', alignItems:'center', gap:6,
          }}>
            <I.sparkle size={12} color="var(--brand)"/> {c}
          </button>
        ))}
      </div>

      {/* Up next - large */}
      <div onClick={()=>onTab('cal')} style={{
        background:'var(--ink)', color:'#fff', borderRadius:24,
        padding:'18px 20px', position:'relative', overflow:'hidden', cursor:'pointer',
      }}>
        <div style={{
          position:'absolute', right:-30, top:-30, width:160, height:160, borderRadius:'50%',
          background:'radial-gradient(circle, rgba(108,61,217,0.55), transparent 70%)',
        }}/>
        <div style={{ position:'relative' }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.55)', marginBottom:8 }}>Next up</div>
          <div style={{ fontSize:24, fontFamily:'Instrument Serif, serif', letterSpacing:-0.4 }}>Mason's tennis</div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,0.7)', marginTop:4 }}>15:30 · Bishop's Park courts · 8 min drive</div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:14 }}>
            <Avatar member={memberById('m')} size={28}/>
            <span style={{ fontSize:12, color:'rgba(255,255,255,0.7)' }}>You're driving</span>
          </div>
        </div>
      </div>

      {/* Quick stats grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <button onClick={()=>onTab('tasks')} style={statTile}>
          <I.checkFill size={20} color="var(--brand)"/>
          <span style={statNum}>{tasks.filter(t=>!t.done).length}</span>
          <span style={statLabel}>Open tasks</span>
        </button>
        <button onClick={()=>onTab('shop')} style={statTile}>
          <I.cartFill size={20} color="var(--brand)"/>
          <span style={statNum}>{groceries.filter(g=>!g.done).length}</span>
          <span style={statLabel}>To buy</span>
        </button>
        <button onClick={()=>onTab('meal')} style={statTile}>
          <I.forkFill size={20} color="var(--brand)"/>
          <span style={statNum}>{meals.filter(m=>!m.meal).length}</span>
          <span style={statLabel}>Meals to plan</span>
        </button>
        <button onClick={()=>onTab('cal')} style={statTile}>
          <I.calFill size={20} color="var(--brand)"/>
          <span style={statNum}>{HM_SCHEDULE.length}</span>
          <span style={statLabel}>Today's events</span>
        </button>
      </div>

      {/* Suggested by AI */}
      <Card>
        <CardHeader title="Suggested by AI" eyebrow="From your patterns"/>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {[
            { icon:I.cartFill, color:'var(--brand)', t:'Add coffee beans to grocery', s:'You usually run out around now' },
            { icon:I.calFill,  color:'var(--amber)', t:'Block 1h on Sun for trampoline build', s:'Forecast looks dry' },
            { icon:I.forkFill, color:'var(--green)', t:'Plan Mon & Wed dinners',         s:'Mon is a busy school night' },
          ].map((s,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{
                width:36, height:36, borderRadius:10,
                background:'var(--bg-app-soft)', display:'flex', alignItems:'center', justifyContent:'center',
                color:s.color,
              }}><s.icon size={18}/></div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{s.t}</div>
                <div style={{ fontSize:11, color:'var(--ink-3)' }}>{s.s}</div>
              </div>
              <button style={{
                padding:'6px 12px', borderRadius:99,
                background:'var(--brand-soft)', color:'var(--brand)',
                border:0, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit',
              }}>Do it</button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── shared inline styles ─────────────────────────────────────
const iconBtn = {
  width:36, height:36, borderRadius:'50%',
  background:'#fff', border:'1px solid var(--line)',
  display:'flex', alignItems:'center', justifyContent:'center',
  cursor:'pointer', padding:0,
};
const linkBtn = {
  marginTop: 10, background:'transparent', border:0, padding:0, cursor:'pointer',
  color:'var(--brand)', fontWeight:600, fontSize:11, fontFamily:'inherit',
};
const statTile = {
  background:'#fff', border:'1px solid var(--line)', borderRadius:18,
  padding:'14px 14px 12px', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
  display:'flex', flexDirection:'column', gap:4, alignItems:'flex-start',
};
const statNum = {
  fontFamily:'Instrument Serif, serif', fontSize:32, color:'var(--ink)', lineHeight:1, marginTop:6,
};
const statLabel = { fontSize:11, color:'var(--ink-3)', fontWeight:500 };

Object.assign(window, { HomeDashboard, HomeAIFirst, memberById });
