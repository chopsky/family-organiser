// Calendar, Tasks, Shopping, Meal Plan
const HMD = window.HM_DATA;

// ── Calendar ─────────────────────────────────────────────────
function CalendarScreen({ onAdd, onSettings }) {
  const [selected, setSelected] = useState(18);
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const { days, events } = HMD.APRIL_2026;
  const evtsForSelected = selected === 18 ? HMD.SCHEDULE : [];

  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 14px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>April 2026</div>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
          <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Calendar</div>
          <button onClick={onAdd} style={{
            width:38, height:38, borderRadius:'50%',
            background:'var(--brand)', color:'#fff', border:0, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 4px 12px rgba(108,61,217,0.35)',
          }}><I.plus size={18} w={2.5}/></button>
        </div>
      </div>

      {/* Mini month grid */}
      <div style={{ padding:'0 16px' }}>
        <div style={{
          background:'#fff', borderRadius:22, padding:'14px 12px 10px',
          boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
        }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:6 }}>
            {dayName.map(d=>(
              <div key={d} style={{ textAlign:'center', fontSize:10, fontWeight:700, color:'var(--ink-3)', letterSpacing:'0.06em' }}>{d.toUpperCase()}</div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
            {days.map((d,i) => {
              const isToday = d===18;
              const isSel   = d===selected;
              const evs     = events[d] || [];
              return (
                <button key={i} onClick={()=>d && setSelected(d)} disabled={!d} style={{
                  aspectRatio:'1', border:0, background: isSel ? 'var(--brand)' : 'transparent',
                  borderRadius:12, cursor: d?'pointer':'default', padding:0,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  gap:3, position:'relative',
                  fontFamily:'inherit',
                }}>
                  {d && (
                    <span style={{
                      fontSize:14, fontWeight: isToday||isSel ? 700 : 500,
                      color: isSel ? '#fff' : (isToday ? 'var(--brand)' : 'var(--ink)'),
                    }}>{d}</span>
                  )}
                  {d && evs.length > 0 && (
                    <div style={{ display:'flex', gap:2 }}>
                      {evs.slice(0,3).map((e,j)=>(
                        <div key={j} style={{ width:4, height:4, borderRadius:2, background: isSel ? 'rgba(255,255,255,0.85)' : e.color }}/>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected day events */}
      <div style={{ padding:'24px 20px 0' }}>
        <SectionTitle
          kicker={selected===18 ? "Today" : `April ${selected}`}
          title={selected===18 ? "Saturday's plan" : `${dayName[(selected+2)%7]}day`}
        />
        {evtsForSelected.length === 0 && (
          <div style={{ padding:'32px 20px', textAlign:'center', color:'var(--ink-3)', background:'#fff', borderRadius:18, fontStyle:'italic', fontFamily:'Instrument Serif, serif', fontSize:18 }}>
            Nothing scheduled
          </div>
        )}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {evtsForSelected.map(e => (
            <div key={e.id} style={{
              background:'#fff', borderRadius:18, padding:'14px 16px',
              display:'flex', gap:12, alignItems:'center',
              boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
              borderLeft:`4px solid ${e.color}`,
            }}>
              <div style={{ width:60 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{e.time}</div>
                <div style={{ fontSize:11, color:'var(--ink-3)', fontVariantNumeric:'tabular-nums' }}>{e.end}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:600, color:'var(--ink)' }}>{e.title}</div>
                <div style={{ fontSize:12, color:'var(--ink-3)', marginTop:2 }}>{e.loc}</div>
              </div>
              {e.who !== 'all'
                ? <Avatar member={memberById(e.who)} size={32}/>
                : <AvatarStack members={HMD.FAMILY.members} size={26}/>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tasks ────────────────────────────────────────────────────
function TasksScreen({ tasks, onToggle, onAdd, onSettings }) {
  const [filter, setFilter] = useState('all');
  const filters = [
    { id:'all',  label:'All' },
    { id:'me',   label:'Mine' },
    { id:'home', label:'Home' },
    { id:'pets', label:'Pets' },
    { id:'kids', label:'Kids' },
  ];
  const filtered = useMemo(()=>{
    if (filter==='all')  return tasks;
    if (filter==='me')   return tasks.filter(t=>t.who==='g');
    return tasks.filter(t=>t.cat.toLowerCase()===filter);
  },[tasks,filter]);

  const grouped = useMemo(()=>{
    const open = filtered.filter(t=>!t.done);
    const done = filtered.filter(t=>t.done);
    return { open, done };
  },[filtered]);

  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 18px', display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>{grouped.open.length} open · {grouped.done.length} done</div>
          <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Tasks</div>
        </div>
        <button onClick={onAdd} style={{
          width:38, height:38, borderRadius:'50%',
          background:'var(--brand)', color:'#fff', border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,61,217,0.35)',
        }}><I.plus size={18} w={2.5}/></button>
      </div>

      {/* Filter pills */}
      <div className="ios-scroll" style={{ display:'flex', gap:8, padding:'0 20px 16px', overflowX:'auto' }}>
        {filters.map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} style={{
            padding:'8px 14px', borderRadius:99,
            background: filter===f.id ? 'var(--ink)' : '#fff',
            color: filter===f.id ? '#fff' : 'var(--ink-2)',
            border: filter===f.id ? '1px solid var(--ink)' : '1px solid var(--line)',
            fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
            flexShrink:0,
          }}>{f.label}</button>
        ))}
      </div>

      {/* Open */}
      <div style={{ padding:'0 16px 20px' }}>
        <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
          {grouped.open.map((t,i) => (
            <div key={t.id} style={{
              display:'flex', gap:12, alignItems:'center',
              padding:'14px 16px',
              borderBottom: i < grouped.open.length-1 ? '1px solid var(--line)' : 'none',
            }}>
              <Checkbox checked={t.done} onChange={()=>onToggle(t.id)} color={HMD.TASK_CAT_COLORS[t.cat]}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15, fontWeight:500, color:'var(--ink)' }}>{t.title}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:3 }}>
                  <Chip bg="var(--bg-app-soft)" fg={HMD.TASK_CAT_COLORS[t.cat]} style={{ background: HMD.TASK_CAT_COLORS[t.cat]+'22' }}>{t.cat}</Chip>
                  <span style={{ fontSize:11, color:'var(--ink-3)' }}>{t.due}</span>
                </div>
              </div>
              <Avatar member={memberById(t.who)} size={26}/>
            </div>
          ))}
          {grouped.open.length===0 && (
            <div style={{ padding:36, textAlign:'center', color:'var(--ink-3)', fontStyle:'italic', fontFamily:'Instrument Serif, serif', fontSize:18 }}>All clear ✓</div>
          )}
        </div>
      </div>

      {/* Done */}
      {grouped.done.length > 0 && (
        <div style={{ padding:'0 16px' }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', padding:'0 4px 8px' }}>Recently done</div>
          <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)', opacity:0.7 }}>
            {grouped.done.map((t,i) => (
              <div key={t.id} style={{ display:'flex', gap:12, alignItems:'center', padding:'12px 16px', borderBottom: i<grouped.done.length-1 ? '1px solid var(--line)' : 'none' }}>
                <Checkbox checked={t.done} onChange={()=>onToggle(t.id)} color={HMD.TASK_CAT_COLORS[t.cat]}/>
                <div style={{ flex:1, fontSize:14, color:'var(--ink-3)', textDecoration:'line-through' }}>{t.title}</div>
                <Avatar member={memberById(t.who)} size={24}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shopping ─────────────────────────────────────────────────
function ShoppingScreen({ groceries, onToggle, onAdd, onSettings }) {
  const [activeList, setActiveList] = useState('default');
  const LISTS = HMD.SHOPPING_LISTS;
  const inList = groceries.filter(g=>g.list===activeList);
  const open = inList.filter(g=>!g.done);
  const done = inList.filter(g=>g.done);
  const counts = useMemo(()=>{
    const c = {};
    LISTS.forEach(l => { c[l.id] = groceries.filter(g=>g.list===l.id && !g.done).length; });
    return c;
  },[groceries]);
  const grouped = useMemo(()=>{
    const m = {};
    open.forEach(g=>{ if(!m[g.cat]) m[g.cat]=[]; m[g.cat].push(g); });
    return m;
  },[open]);

  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 16px', display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>{open.length} to buy</div>
          <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Shopping</div>
        </div>
        <button onClick={onAdd} style={{
          width:38, height:38, borderRadius:'50%',
          background:'var(--brand)', color:'#fff', border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,61,217,0.35)',
        }}><I.plus size={18} w={2.5}/></button>
      </div>

      {/* List pills */}
      <div className="ios-scroll" style={{ display:'flex', gap:8, padding:'0 20px 14px', overflowX:'auto' }}>
        {LISTS.map(l=>{
          const isActive = activeList===l.id;
          return (
            <button key={l.id} onClick={()=>setActiveList(l.id)} style={{
              padding:'8px 14px', borderRadius:99, flexShrink:0,
              background: isActive ? 'var(--brand)' : '#fff',
              color: isActive ? '#fff' : 'var(--ink-2)',
              border: isActive ? '1px solid var(--brand)' : '1px solid var(--line)',
              fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              display:'inline-flex', alignItems:'center', gap:6,
            }}>
              {l.name}
              {counts[l.id] > 0 && (
                <span style={{
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  minWidth:18, height:18, padding:'0 5px', borderRadius:9,
                  fontSize:10, fontWeight:700,
                  background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-app-soft)',
                  color: isActive ? '#fff' : 'var(--ink-2)',
                }}>{counts[l.id]}</span>
              )}
            </button>
          );
        })}
        <button style={{
          width:36, height:36, borderRadius:'50%', flexShrink:0,
          background:'#fff', border:'1px dashed var(--line-strong)', color:'var(--ink-3)',
          cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center',
        }}><I.plus size={16} w={2.2}/></button>
      </div>

      {/* Quick add */}
      <div style={{ padding:'0 16px 16px' }}>
        <div style={{
          background:'#fff', borderRadius:14, padding:'4px 4px 4px 14px',
          display:'flex', alignItems:'center', gap:8,
          border:'1px solid var(--line)',
        }}>
          <input placeholder="Add item…" style={{
            flex:1, border:0, outline:'none', fontFamily:'inherit', fontSize:14,
            background:'transparent', padding:'10px 0', color:'var(--ink)',
          }}/>
          <button style={{
            padding:'8px 14px', borderRadius:10,
            background:'var(--brand-soft)', color:'var(--brand)', border:0,
            fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
            display:'inline-flex', alignItems:'center', gap:4,
          }}><I.plus size={14} w={2.4}/> Add</button>
        </div>
      </div>

      {/* Empty state */}
      {open.length === 0 && done.length === 0 && (
        <div style={{ padding:'40px 20px', textAlign:'center' }}>
          <div style={{ fontFamily:'Instrument Serif, serif', fontSize:22, color:'var(--ink-3)', fontStyle:'italic' }}>
            Nothing on this list yet
          </div>
        </div>
      )}

      {/* Suggested by AI */}
      {open.length > 0 && (
        <div className="ios-scroll" style={{ padding:'0 20px 18px', display:'flex', gap:8, overflowX:'auto' }}>
          {['Coffee beans','Bananas','Greek yoghurt','Lemons'].map(s=>(
            <button key={s} style={{
              flexShrink:0, padding:'8px 12px', borderRadius:12,
              background:'#fff', border:'1px dashed var(--brand)', color:'var(--brand)',
              fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              display:'inline-flex', alignItems:'center', gap:6,
            }}>
              <I.plus size={12} w={2.4}/> {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:18 }}>
        {Object.keys(grouped).map(cat=>{
          const cc = HMD.CAT_COLORS[cat];
          return (
            <div key={cat}>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 4px 8px' }}>
                <Chip bg={cc.bg} fg={cc.fg}>{cat}</Chip>
                <span style={{ fontSize:11, color:'var(--ink-3)' }}>{grouped[cat].length}</span>
              </div>
              <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
                {grouped[cat].map((g,i)=>(
                  <div key={g.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderBottom: i<grouped[cat].length-1 ? '1px solid var(--line)' : 'none' }}>
                    <Checkbox checked={g.done} onChange={()=>onToggle(g.id)}/>
                    <div style={{ flex:1, fontSize:15, color:'var(--ink)', fontWeight:500 }}>{g.name}</div>
                    <span style={{ fontSize:12, color:'var(--ink-3)', fontWeight:500 }}>{g.qty}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', padding:'0 4px 8px' }}>In the trolley · {done.length}</div>
            <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', opacity:0.6 }}>
              {done.map((g,i)=>(
                <div key={g.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom: i<done.length-1 ? '1px solid var(--line)' : 'none' }}>
                  <Checkbox checked={g.done} onChange={()=>onToggle(g.id)}/>
                  <div style={{ flex:1, fontSize:14, color:'var(--ink-3)', textDecoration:'line-through' }}>{g.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Meal plan ────────────────────────────────────────────────
function MealPlanScreen({ meals, onPlan, onSettings }) {
  const [tab, setTab] = useState('plan');
  const [weekIdx, setWeekIdx] = useState(0);
  const recipes = window.HM_DATA.RECIPES || [];

  const MEAL_TYPES = [
    { key:'breakfast', label:'Breakfast', color:'var(--amber)',  soft:'var(--amber-soft)' },
    { key:'lunch',     label:'Lunch',     color:'var(--green)',  soft:'var(--green-soft)' },
    { key:'dinner',    label:'Dinner',    color:'var(--blue)',   soft:'var(--blue-soft)'  },
    { key:'snack',     label:'Snack',     color:'var(--pink)',   soft:'var(--pink-soft)'  },
  ];

  return (
    <div style={{ padding:'70px 0 130px' }}>
      {/* Title */}
      <div style={{ padding:'0 20px 14px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>Week of 13 Apr 2026</div>
        <div style={{ fontFamily:'Instrument Serif, serif', fontSize:36, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>
          {tab === 'plan' ? <>This week's<br/><i>meals</i></> : <>Recipe<br/><i>box</i></>}
        </div>
      </div>

      {/* Tab toggle */}
      <div style={{ padding:'0 16px 14px' }}>
        <div style={{ background:'var(--bg-app-soft)', borderRadius:12, padding:4, display:'flex', gap:4 }}>
          {[{k:'plan',l:'Meal Plan'},{k:'box',l:'Recipe Box'}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{
              flex:1, padding:'9px', borderRadius:9, border:0, cursor:'pointer',
              background: tab===t.k ? '#fff' : 'transparent',
              color: tab===t.k ? 'var(--ink)' : 'var(--ink-2)',
              fontSize:13, fontWeight: tab===t.k ? 700 : 500, fontFamily:'inherit',
              boxShadow: tab===t.k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>{t.l}</button>
          ))}
        </div>
      </div>

      {tab === 'plan' ? (
        <>
          {/* Week navigator */}
          <div style={{ padding:'0 16px 14px' }}>
            <div style={{
              background:'#fff', borderRadius:14, padding:'10px 12px',
              display:'flex', alignItems:'center', justifyContent:'space-between',
              border:'1px solid var(--line)',
            }}>
              <button onClick={()=>setWeekIdx(i=>i-1)} style={{ width:32, height:32, borderRadius:8, border:0, background:'var(--bg-app-soft)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="10" height="14" viewBox="0 0 10 14"><path d="M8 1L2 7l6 6" stroke="var(--ink-2)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>13 – 19 April</div>
              <button onClick={()=>setWeekIdx(i=>i+1)} style={{ width:32, height:32, borderRadius:8, border:0, background:'var(--bg-app-soft)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="10" height="14" viewBox="0 0 10 14"><path d="M2 1l6 6-6 6" stroke="var(--ink-2)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>

          {/* Day cards */}
          <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:10 }}>
            {meals.map((d)=>{
              const isToday = d.date === 18;
              const filled = MEAL_TYPES.filter(t=>d[t.key]).length;
              return (
                <div key={d.day} style={{
                  background: isToday ? 'var(--ink)' : '#fff',
                  color: isToday ? '#fff' : 'var(--ink)',
                  borderRadius:18, padding:'14px 14px 12px',
                  boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
                }}>
                  <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
                    <div style={{ width:46 }}>
                      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color: isToday ? 'rgba(255,255,255,0.55)' : 'var(--ink-3)' }}>{d.day}</div>
                      <div style={{ fontFamily:'Instrument Serif, serif', fontSize:26, lineHeight:1, color: isToday ? '#fff' : 'var(--ink)' }}>{d.date}</div>
                    </div>
                    <div style={{ flex:1, textAlign:'right', fontSize:11, color: isToday ? 'rgba(255,255,255,0.55)' : 'var(--ink-3)' }}>
                      {filled}/4 meals planned
                    </div>
                  </div>

                  {/* 2×2 meal slots */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    {MEAL_TYPES.map(mt=>{
                      const val = d[mt.key];
                      return (
                        <div key={mt.key} onClick={()=>!val && onPlan && onPlan(d.day, mt.key)} style={{
                          background: val
                            ? (isToday ? 'rgba(255,255,255,0.08)' : mt.soft)
                            : (isToday ? 'rgba(255,255,255,0.05)' : 'var(--bg-app-soft)'),
                          border: val ? 0 : `1px dashed ${isToday ? 'rgba(255,255,255,0.2)' : 'var(--line-strong)'}`,
                          borderRadius:10, padding:'8px 10px',
                          minHeight:46, display:'flex', flexDirection:'column', justifyContent:'center',
                          cursor: val ? 'default' : 'pointer',
                        }}>
                          <div style={{
                            fontSize:9, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase',
                            color: val
                              ? (isToday ? 'rgba(255,255,255,0.55)' : mt.color)
                              : (isToday ? 'rgba(255,255,255,0.4)' : 'var(--ink-3)'),
                            marginBottom: val ? 2 : 0,
                          }}>{mt.label}</div>
                          {val ? (
                            <div style={{ fontSize:12, fontWeight:600, color: isToday ? '#fff' : 'var(--ink)', lineHeight:1.2 }}>{val}</div>
                          ) : (
                            <div style={{ fontSize:16, color: isToday ? 'rgba(255,255,255,0.35)' : 'var(--ink-3)', lineHeight:1 }}>+</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom actions */}
          <div style={{ padding:'16px 16px 0', display:'flex', gap:8 }}>
            <button onClick={()=>setTab('box')} style={{
              flex:1, padding:'11px', borderRadius:12,
              background:'#fff', border:'1px solid var(--line)', cursor:'pointer',
              fontSize:13, fontWeight:600, color:'var(--ink)', fontFamily:'inherit',
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            }}><I.fork size={14}/> Recipe Box</button>
            <button style={{
              flex:1, padding:'11px', borderRadius:12,
              background:'#fff', border:'1px solid var(--line)', cursor:'pointer',
              fontSize:13, fontWeight:600, color:'var(--ink)', fontFamily:'inherit',
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            }}><I.cart size={14}/> Add to shopping</button>
          </div>
        </>
      ) : (
        <RecipeBox recipes={recipes}/>
      )}
    </div>
  );
}

function RecipeBox({ recipes }) {
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const cats = ['All','Favourites','Breakfast','Lunch','Dinner','Snack'];
  const filtered = recipes.filter(r => {
    if (filter === 'Favourites' && !r.fav) return false;
    if (filter !== 'All' && filter !== 'Favourites' && r.cat !== filter) return false;
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const catColor = (c) => ({
    Breakfast:'var(--amber)', Lunch:'var(--green)', Dinner:'var(--blue)', Snack:'var(--pink)',
  }[c] || 'var(--ink-2)');
  const catSoft = (c) => ({
    Breakfast:'var(--amber-soft)', Lunch:'var(--green-soft)', Dinner:'var(--blue-soft)', Snack:'var(--pink-soft)',
  }[c] || 'var(--bg-app-soft)');

  return (
    <>
      {/* Search */}
      <div style={{ padding:'0 16px 12px' }}>
        <div style={{
          background:'#fff', borderRadius:12, border:'1px solid var(--line)',
          padding:'10px 12px', display:'flex', alignItems:'center', gap:10,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5.5" stroke="var(--ink-3)" strokeWidth="1.8" fill="none"/><path d="M11 11l4 4" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder="Search recipes…"
            style={{ flex:1, border:0, outline:0, background:'transparent', fontSize:14, color:'var(--ink)', fontFamily:'inherit' }}
          />
        </div>
      </div>

      {/* Category filter */}
      <div className="ios-scroll" style={{ display:'flex', gap:6, padding:'0 16px 14px', overflowX:'auto' }}>
        {cats.map(c=>(
          <button key={c} onClick={()=>setFilter(c)} style={{
            padding:'7px 12px', borderRadius:99, flexShrink:0, fontFamily:'inherit',
            background: filter===c ? 'var(--ink)' : '#fff',
            color: filter===c ? '#fff' : 'var(--ink-2)',
            border: filter===c ? '1px solid var(--ink)' : '1px solid var(--line)',
            fontSize:12, fontWeight:600, cursor:'pointer',
          }}>{c}</button>
        ))}
      </div>

      {/* Recipe count + add */}
      <div style={{ padding:'0 20px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:12, color:'var(--ink-3)' }}>{filtered.length} recipes</div>
        <button style={{
          background:'transparent', border:0, color:'var(--brand)', fontSize:13, fontWeight:600,
          cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4,
        }}><I.plus size={14} w={2.4}/> Add recipe</button>
      </div>

      {/* Recipe cards */}
      <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.map(r=>(
          <div key={r.id} style={{
            background:'#fff', borderRadius:14, padding:'12px 14px',
            display:'flex', alignItems:'center', gap:12,
            border:'1px solid var(--line)',
          }}>
            <div style={{
              width:44, height:44, borderRadius:11,
              background: catSoft(r.cat), color: catColor(r.cat),
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}><I.fork size={18}/></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)', lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</div>
              <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:3, display:'flex', gap:8 }}>
                <span style={{
                  fontSize:10, fontWeight:700, letterSpacing:'0.06em',
                  color: catColor(r.cat), textTransform:'uppercase',
                }}>{r.cat}</span>
                <span>·</span>
                <span>{r.mins} min</span>
                <span>·</span>
                <span>serves {r.serves}</span>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 20 20" style={{ flexShrink:0 }}>
              <path d="M10 17.3L8.55 16c-5-4.55-8.3-7.55-8.3-11.25A4.75 4.75 0 015 0c1.64 0 3.22.77 4.24 1.99h1.52A5.75 5.75 0 0115 0a4.75 4.75 0 014.75 4.75c0 3.7-3.3 6.7-8.3 11.25L10 17.3z"
                fill={r.fav ? 'var(--pink)' : 'none'}
                stroke={r.fav ? 'var(--pink)' : 'var(--ink-3)'} strokeWidth="1.6"/>
            </svg>
          </div>
        ))}
      </div>
    </>
  );
}

Object.assign(window, { CalendarScreen, TasksScreen, ShoppingScreen, MealPlanScreen });
