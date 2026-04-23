// Modal sheets — AI composer fullscreen + Add task
function Sheet({ open, onClose, children, title }) {
  const [show, setShow] = useState(false);
  useEffect(()=>{ if(open) requestAnimationFrame(()=>setShow(true)); else setShow(false); }, [open]);
  if (!open) return null;
  return (
    <div data-sheet-bg style={{
      position:'absolute', inset:0, zIndex:90,
      background: show ? 'rgba(26,22,32,0.4)' : 'rgba(26,22,32,0)',
      transition:'background 0.25s ease',
      display:'flex', alignItems:'flex-end',
    }} onClick={onClose}>
      <div data-sheet-panel onClick={e=>e.stopPropagation()} style={{
        width:'100%', background:'var(--bg-app)',
        borderTopLeftRadius:28, borderTopRightRadius:28,
        transform: show ? 'translateY(0)' : 'translateY(100%)',
        transition:'transform 0.32s cubic-bezier(0.32,0.72,0,1)',
        maxHeight:'88%', overflow:'hidden',
        display:'flex', flexDirection:'column',
        paddingBottom:34,
      }}>
        <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 4px' }}>
          <div style={{ width:40, height:5, borderRadius:3, background:'var(--line-strong)' }}/>
        </div>
        {title && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 20px 8px' }}>
            <div style={{ fontSize:17, fontWeight:700, color:'var(--ink)' }}>{title}</div>
            <button onClick={onClose} style={{
              width:30, height:30, borderRadius:'50%', background:'var(--bg-app-soft)', border:0, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ink-2)',
            }}><I.close size={16}/></button>
          </div>
        )}
        <div style={{ flex:1, overflowY:'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ── AI Composer fullscreen sheet ────────────────────────────
function AISheet({ open, onClose }) {
  const [val, setVal] = useState('');
  const [thread, setThread] = useState([]);
  const submit = () => {
    if (!val.trim()) return;
    const userMsg = { role:'user', text: val };
    setThread(t => [...t, userMsg]);
    const v = val;
    setVal('');
    setTimeout(()=>{
      let resp = "Done. I've added that for you.";
      if (/recital|tennis|ballet|event/i.test(v)) resp = "Added to the calendar — I've blocked travel time too.";
      else if (/grocery|shop|carrot|milk|buy/i.test(v)) resp = "Added to the grocery list under the right category.";
      else if (/meal|dinner|lunch|recipe|plan/i.test(v)) resp = "I've drafted three meal options. Tap one to add it to the plan.";
      else if (/receipt|scan/i.test(v)) resp = "Open the camera and I'll extract everything line by line.";
      setThread(t => [...t, { role:'ai', text: resp }]);
    }, 600);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ padding:'4px 20px 18px', display:'flex', flexDirection:'column', gap:14, minHeight:520 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            width:36, height:36, borderRadius:11,
            background:'linear-gradient(135deg, var(--brand) 0%, #8E5FFF 100%)',
            display:'flex', alignItems:'center', justifyContent:'center', color:'#fff',
            boxShadow:'0 4px 12px rgba(108,61,217,0.3)',
          }}><I.sparkle size={18}/></div>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--ink)' }}>Housemait AI</div>
            <div style={{ fontSize:11, color:'var(--ink-3)' }}>Knows your family · always on</div>
          </div>
          <div style={{ marginLeft:'auto' }}>
            <button onClick={onClose} style={{
              width:30, height:30, borderRadius:'50%', background:'var(--bg-app-soft)', border:0, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ink-2)',
            }}><I.close size={16}/></button>
          </div>
        </div>

        {thread.length === 0 ? (
          <>
            <div style={{ fontFamily:'Instrument Serif, serif', fontSize:32, lineHeight:1.1, color:'var(--ink)', letterSpacing:-0.6, marginTop:8 }}>
              How can I help, <i>Grant?</i>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:6 }}>
              {[
                { i:I.calFill,  c:'var(--brand)', t:'Add an event',          s:'"Mason has tennis Saturday at 3pm"' },
                { i:I.cartFill, c:'var(--green)', t:'Add to the grocery list', s:'"We need carrots and milk"' },
                { i:I.forkFill, c:'var(--amber)', t:'Plan a meal',           s:'"Something easy for Wednesday"' },
                { i:I.checkFill,c:'var(--pink)',  t:'Create a task',         s:'"Remind me to renew Lily\'s passport"' },
              ].map((s,i)=>(
                <button key={i} onClick={()=>{ setVal(s.s.slice(1,-1)); }} style={{
                  background:'#fff', border:'1px solid var(--line)', borderRadius:16,
                  padding:'12px 14px', cursor:'pointer', fontFamily:'inherit', textAlign:'left',
                  display:'flex', gap:12, alignItems:'center',
                }}>
                  <div style={{
                    width:36, height:36, borderRadius:10,
                    background:'var(--bg-app-soft)', color:s.c,
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}><s.i size={18}/></div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>{s.t}</div>
                    <div style={{ fontSize:12, color:'var(--ink-3)', fontStyle:'italic', marginTop:1 }}>{s.s}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'4px 0 12px' }}>
            {thread.map((m,i)=>(
              <div key={i} style={{ display:'flex', justifyContent: m.role==='user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth:'80%', padding:'10px 14px', borderRadius:18,
                  background: m.role==='user' ? 'var(--brand)' : '#fff',
                  color: m.role==='user' ? '#fff' : 'var(--ink)',
                  fontSize:14, lineHeight:1.4,
                  border: m.role==='user' ? 0 : '1px solid var(--line)',
                  borderBottomRightRadius: m.role==='user' ? 6 : 18,
                  borderBottomLeftRadius:  m.role==='user' ? 18 : 6,
                }}>{m.text}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop:'auto' }}>
          <AIComposer
            value={val}
            onChange={setVal}
            onSubmit={submit}
            onMic={()=>{}}
            autoFocus
            placeholder="Ask me anything…"
          />
          <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
            {['📷 Scan a receipt','📸 Take a photo','📎 Attach','🎙 Voice'].map(c=>(
              <button key={c} style={{
                padding:'6px 10px', borderRadius:99,
                background:'transparent', border:'1px solid var(--line)',
                fontSize:11, color:'var(--ink-2)', cursor:'pointer', fontFamily:'inherit',
              }}>{c}</button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ── Add task / event sheet ──────────────────────────────────
function AddSheet({ open, onClose, kind='task', onSave }) {
  const [title, setTitle] = useState('');
  const [who, setWho] = useState('g');
  const [cat, setCat] = useState(kind==='task'?'Home':'Event');
  useEffect(()=>{ if(open){ setTitle(''); setWho('g'); }}, [open]);
  const cats = kind==='task' ? ['Home','Pets','Kids','Bills'] : ['Family','Sport','School','Health'];
  return (
    <Sheet open={open} onClose={onClose} title={kind==='task' ? 'New task' : 'New event'}>
      <div style={{ padding:'4px 20px 24px', display:'flex', flexDirection:'column', gap:18 }}>
        <div>
          <input
            autoFocus
            value={title}
            onChange={e=>setTitle(e.target.value)}
            placeholder={kind==='task' ? 'What needs doing?' : 'What\'s happening?'}
            style={{
              width:'100%', border:0, outline:'none',
              background:'transparent',
              fontFamily:'Instrument Serif, serif', fontSize:28, color:'var(--ink)',
              letterSpacing:-0.4,
            }}
          />
          <div style={{ height:1, background:'var(--line)' }}/>
        </div>

        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:8 }}>Assign to</div>
          <div style={{ display:'flex', gap:10 }}>
            {window.HM_DATA.FAMILY.members.map(m=>(
              <button key={m.id} onClick={()=>setWho(m.id)} style={{
                padding:'6px 10px 6px 6px', borderRadius:99,
                background: who===m.id ? 'var(--ink)' : '#fff',
                color: who===m.id ? '#fff' : 'var(--ink)',
                border: who===m.id ? '1px solid var(--ink)' : '1px solid var(--line)',
                display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontFamily:'inherit',
                fontSize:13, fontWeight:600,
              }}>
                <Avatar member={m} size={22}/> {m.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:8 }}>Category</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setCat(c)} style={{
                padding:'8px 12px', borderRadius:10,
                background: cat===c ? 'var(--brand-soft)' : '#fff',
                color: cat===c ? 'var(--brand)' : 'var(--ink-2)',
                border: cat===c ? '1px solid var(--brand)' : '1px solid var(--line)',
                fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              }}>{c}</button>
            ))}
          </div>
        </div>

        <div style={{
          background:'var(--brand-soft)', borderRadius:14, padding:'12px 14px',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <I.sparkle size={16} color="var(--brand)"/>
          <span style={{ fontSize:12, color:'var(--brand-deep)' }}>Tip: just describe it — AI fills in the details.</span>
        </div>

        <button onClick={()=>{ if(title.trim()) { onSave({ title, who, cat }); onClose(); }}} style={{
          marginTop:6, padding:'14px', borderRadius:16,
          background: title.trim() ? 'var(--brand)' : 'var(--bg-app-soft)',
          color: title.trim() ? '#fff' : 'var(--ink-3)',
          border:0, cursor: title.trim()?'pointer':'default',
          fontSize:15, fontWeight:600, fontFamily:'inherit',
          boxShadow: title.trim() ? '0 4px 12px rgba(108,61,217,0.3)' : 'none',
        }}>Save {kind}</button>
      </div>
    </Sheet>
  );
}

Object.assign(window, { Sheet, AISheet, AddSheet });
