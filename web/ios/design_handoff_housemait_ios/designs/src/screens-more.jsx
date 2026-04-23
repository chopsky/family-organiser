// Documents, Family, Receipts screens + More sheet
const HMD2 = window.HM_DATA;

function DocIcon({ kind, color }) {
  return (
    <div style={{
      width:44, height:52, borderRadius:8,
      background:'#fff', border:`1.5px solid ${color}44`,
      position:'relative', overflow:'hidden', flexShrink:0,
      boxShadow:`inset 0 0 0 2px ${color}11`,
    }}>
      <div style={{ position:'absolute', top:0, right:0, width:12, height:12, background:color+'22', borderBottomLeftRadius:6 }}/>
      <div style={{ position:'absolute', bottom:6, left:6, right:6, display:'flex', flexDirection:'column', gap:2 }}>
        <div style={{ height:2, background:color+'55', borderRadius:1 }}/>
        <div style={{ height:2, background:color+'33', borderRadius:1, width:'70%' }}/>
        <div style={{ height:2, background:color+'33', borderRadius:1, width:'85%' }}/>
      </div>
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        fontSize:7, fontWeight:800, color:color, textAlign:'center',
        padding:'1px 0', letterSpacing:'0.08em',
      }}>{(kind||'PDF').toUpperCase()}</div>
    </div>
  );
}

function DocumentsScreen({ onAdd, onSettings }) {
  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 18px', display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>
            556 KB of 10 GB · 38 files
          </div>
          <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Documents</div>
        </div>
        <button onClick={onAdd} style={{
          width:38, height:38, borderRadius:'50%',
          background:'var(--brand)', color:'#fff', border:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,61,217,0.35)',
        }}><I.plus size={18} w={2.5}/></button>
      </div>

      {/* Storage bar */}
      <div style={{ padding:'0 20px 18px' }}>
        <div style={{ height:6, background:'var(--bg-app-soft)', borderRadius:3, overflow:'hidden', display:'flex' }}>
          <div style={{ width:'18%', background:'var(--brand)' }}/>
          <div style={{ width:'8%', background:'#D8788A' }}/>
          <div style={{ width:'12%', background:'#D89B3A' }}/>
        </div>
      </div>

      {/* Upload actions */}
      <div style={{ padding:'0 20px 20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <button style={{
          background:'var(--brand)', color:'#fff', border:0, borderRadius:14,
          padding:'12px', cursor:'pointer', fontFamily:'inherit',
          fontSize:13, fontWeight:600,
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          boxShadow:'0 4px 12px rgba(108,61,217,0.3)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          Upload file
        </button>
        <button style={{
          background:'#fff', color:'var(--ink)', border:'1px solid var(--line)', borderRadius:14,
          padding:'12px', cursor:'pointer', fontFamily:'inherit',
          fontSize:13, fontWeight:600,
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        }}>
          <I.plus size={16} w={2.4}/> New folder
        </button>
      </div>

      <div style={{ padding:'0 20px 8px', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)' }}>Folders</div>
      <div className="ios-scroll" style={{ display:'flex', gap:12, padding:'8px 20px 20px', overflowX:'auto' }}>
        {HMD2.DOCS_FOLDERS.map(f=>(
          <div key={f.id} style={{
            flexShrink:0, width:130, background:'#fff', borderRadius:18,
            padding:'14px', cursor:'pointer',
            boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
          }}>
            <div style={{
              width:44, height:36, borderRadius:8, background:f.color,
              position:'relative', marginBottom:12,
            }}>
              <div style={{ position:'absolute', top:-4, left:4, width:16, height:6, background:f.color, borderRadius:'3px 3px 0 0' }}/>
              <div style={{ position:'absolute', inset:0, borderRadius:8, border:`1.5px solid ${f.icon}33` }}/>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{f.name}</div>
            <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:2 }}>{f.files} files</div>
          </div>
        ))}
      </div>

      <div style={{ padding:'0 20px 8px', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)' }}>Recent</div>
      <div style={{ padding:'8px 16px 0' }}>
        <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
          {HMD2.DOCS_RECENT.map((d,i)=>(
            <div key={d.id} style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
              borderBottom: i<HMD2.DOCS_RECENT.length-1 ? '1px solid var(--line)' : 'none',
            }}>
              <DocIcon kind={d.kind==='image'?'JPG':'PDF'} color={d.color}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
                <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:2 }}>{d.folder} · {d.size} · {d.when}</div>
              </div>
              <button style={{ background:'transparent', border:0, cursor:'pointer', color:'var(--ink-3)', padding:4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FamilyScreen({ onSettings }) {
  const members = HMD2.FAMILY.members;
  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 18px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>Household · 4 members</div>
        <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>The Reids</div>
      </div>

      {/* Household cover */}
      <div style={{ padding:'0 16px 18px' }}>
        <div style={{
          background:'linear-gradient(135deg, var(--ink) 0%, #3A2E4C 100%)',
          color:'#fff', borderRadius:22, padding:'22px 20px', position:'relative', overflow:'hidden',
        }}>
          <div style={{ position:'absolute', right:-40, bottom:-40, width:180, height:180, borderRadius:'50%',
            background:'radial-gradient(circle, rgba(108,61,217,0.45), transparent 70%)' }}/>
          <div style={{ position:'relative' }}>
            <div style={{ fontFamily:'Instrument Serif, serif', fontSize:24, letterSpacing:-0.4, fontStyle:'italic' }}>The Reid family</div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.65)', marginTop:4 }}>London · Since April 2024</div>
            <div style={{ display:'flex', marginTop:14 }}>
              {members.map((m,i)=>(
                <div key={m.id} style={{ marginLeft: i===0 ? 0 : -10, border:'3px solid var(--ink)', borderRadius:'50%' }}>
                  <Avatar member={m} size={40}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding:'0 20px 8px', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)' }}>Members</div>
      <div style={{ padding:'8px 16px 20px', display:'flex', flexDirection:'column', gap:10 }}>
        {members.map(m => (
          <div key={m.id} style={{
            background:'#fff', borderRadius:18, padding:'14px 16px',
            display:'flex', alignItems:'center', gap:14,
            boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
          }}>
            <Avatar member={m} size={46}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:600, color:'var(--ink)' }}>{m.name}</div>
              <div style={{ fontSize:12, color:'var(--ink-3)', marginTop:2 }}>{m.role} · WhatsApp connected</div>
            </div>
            <button style={{
              width:32, height:32, borderRadius:10, background:'var(--bg-app-soft)',
              border:0, cursor:'pointer', color:'var(--ink-2)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
          </div>
        ))}

        <button style={{
          background:'transparent', border:'1.5px dashed var(--line-strong)',
          borderRadius:18, padding:'16px', cursor:'pointer', fontFamily:'inherit',
          color:'var(--ink-3)', fontSize:14, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        }}>
          <I.plus size={16} w={2.2}/> Add family member
        </button>
      </div>

      <div style={{ padding:'0 20px 8px', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)' }}>Settings</div>
      <div style={{ padding:'8px 16px' }}>
        <div style={{ background:'#fff', borderRadius:18, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
          {[
            { t:'Default reminder time', s:'07:00' },
            { t:'Timezone',              s:'Europe/London' },
            { t:'Shared calendar colour', s:'Purple' },
            { t:'Billing',               s:'Family plan · £9/mo' },
          ].map((row,i,arr)=>(
            <div key={i} style={{
              display:'flex', alignItems:'center', padding:'14px 16px',
              borderBottom: i<arr.length-1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ flex:1, fontSize:14, color:'var(--ink)' }}>{row.t}</div>
              <div style={{ fontSize:13, color:'var(--ink-3)', marginRight:8 }}>{row.s}</div>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="rgba(26,22,32,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReceiptsScreen({ onSettings }) {
  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 18px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>AI-matched to shopping list</div>
        <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Receipts</div>
      </div>

      {/* Big scanner */}
      <div style={{ padding:'0 16px 20px' }}>
        <div style={{
          background:'#fff', borderRadius:22,
          border:'1.5px dashed var(--brand)', padding:'28px 20px',
          display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        }}>
          <div style={{
            width:72, height:72, borderRadius:20,
            background:'linear-gradient(135deg, var(--brand) 0%, #8E5FFF 100%)',
            color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 8px 22px rgba(108,61,217,0.35)',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h3l2-3h8l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:17, fontWeight:700, color:'var(--ink)' }}>Scan a receipt</div>
            <div style={{ fontSize:12, color:'var(--ink-3)', marginTop:4, lineHeight:1.4, maxWidth:250 }}>
              Auto-ticks matching items on your grocery list. Tap below to open the camera.
            </div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            <button style={{
              padding:'10px 18px', borderRadius:99,
              background:'var(--brand)', color:'#fff', border:0, cursor:'pointer',
              fontSize:13, fontWeight:600, fontFamily:'inherit',
              boxShadow:'0 4px 12px rgba(108,61,217,0.3)',
            }}>Open camera</button>
            <button style={{
              padding:'10px 18px', borderRadius:99,
              background:'#fff', color:'var(--ink)', border:'1px solid var(--line-strong)', cursor:'pointer',
              fontSize:13, fontWeight:600, fontFamily:'inherit',
            }}>From photos</button>
          </div>
        </div>
      </div>

      {/* This month summary */}
      <div style={{ padding:'0 16px 20px' }}>
        <div style={{
          background:'var(--ink)', color:'#fff', borderRadius:20,
          padding:'16px 18px', display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'rgba(255,255,255,0.55)', textTransform:'uppercase' }}>This month · Apr</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:4 }}>
              <span style={{ fontFamily:'Instrument Serif, serif', fontSize:34, lineHeight:1 }}>£418</span>
              <span style={{ fontSize:12, color:'rgba(255,255,255,0.55)' }}>· 17 receipts</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:4, alignItems:'flex-end' }}>
            {[22,35,18,48,30,55,40].map((h,i)=>(
              <div key={i} style={{ width:8, height:h, borderRadius:2, background:'rgba(255,255,255,0.55)' }}/>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding:'0 20px 8px', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)' }}>Recent</div>
      <div style={{ padding:'8px 16px' }}>
        <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
          {HMD2.RECEIPTS.map((r,i)=>(
            <div key={r.id} style={{
              display:'flex', alignItems:'center', gap:12, padding:'14px 16px',
              borderBottom: i<HMD2.RECEIPTS.length-1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{
                width:40, height:48, borderRadius:6,
                background:'var(--bg-app-soft)',
                position:'relative', flexShrink:0,
                clipPath:'polygon(0 0, 100% 0, 100% 92%, 85% 100%, 70% 92%, 55% 100%, 40% 92%, 25% 100%, 10% 92%, 0 100%)',
              }}>
                <div style={{ position:'absolute', top:6, left:4, right:4, height:1, background:'var(--line-strong)'}}/>
                <div style={{ position:'absolute', top:12, left:4, right:8, height:1, background:'var(--line-strong)', opacity:0.6 }}/>
                <div style={{ position:'absolute', top:18, left:4, right:12, height:1, background:'var(--line-strong)', opacity:0.6 }}/>
                <div style={{ position:'absolute', top:24, left:4, right:6, height:1, background:'var(--line-strong)', opacity:0.6 }}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>{r.merchant}</div>
                <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:2 }}>{r.when} · {r.items} items</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{r.total}</div>
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:4, marginTop:2,
                  fontSize:10, fontWeight:700, color:r.color, letterSpacing:'0.04em',
                }}>
                  <I.dot size={6} color={r.color}/> {r.matched}/{r.items} matched
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── More sheet ────────────────────────────────────────────────
function MoreSheet({ open, onClose, onGo, active }) {
  const items = [
    { id:'meal',    label:'Meal Plan', sub:'Weekly dinners & recipes', I:I.forkFill,  bg:'#FBF1DE', fg:'#D89B3A' },
    { id:'receipt', label:'Receipts',  sub:'Scan & auto-match',        I:I.sparkle,   bg:'#EFE9FB', fg:'#6C3DD9' },
    { id:'docs',    label:'Documents', sub:'Household paperwork',      I:null,        bg:'#E2ECFA', fg:'#5B8DE0', custom:'doc' },
    { id:'family',  label:'Family',    sub:'Members & settings',       I:null,        bg:'#FBE6EA', fg:'#D8788A', custom:'family' },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="More">
      <div style={{ padding:'4px 20px 20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {items.map(it=>{
          const isActive = active===it.id;
          return (
            <button key={it.id} onClick={()=>{ onGo(it.id); onClose(); }} style={{
              background:'#fff',
              border: isActive ? `1.5px solid ${it.fg}` : '1px solid var(--line)',
              borderRadius:18, padding:'18px 16px',
              textAlign:'left', cursor:'pointer', fontFamily:'inherit',
              display:'flex', flexDirection:'column', gap:14, alignItems:'flex-start',
              minHeight:130,
            }}>
              <div style={{
                width:44, height:44, borderRadius:12,
                background: it.bg,
                display:'flex', alignItems:'center', justifyContent:'center',
                color: it.fg,
              }}>
                {it.custom==='doc' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.4L17.6 8H14V4.4zM7 13h10v1.5H7V13zm0 3h10v1.5H7V16zm0 3h7v1.5H7V19z"/>
                  </svg>
                ) : it.custom==='family' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/>
                    <path d="M2 20c0-3 3-5 6-5s6 2 6 5H2zm8 0c0-2 2-3.5 4-3.5s4 1.5 4 3.5h-8z"/>
                  </svg>
                ) : (
                  <it.I size={22}/>
                )}
              </div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--ink)' }}>{it.label}</div>
                <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:3 }}>{it.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding:'0 20px 10px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', padding:'8px 4px' }}>Account</div>
        <div style={{ background:'#fff', borderRadius:18, overflow:'hidden', border:'1px solid var(--line)' }}>
          {[
            { id:'settings', t:'Settings',       s:'' },
            { t:'Notifications',  s:'All on' },
            { t:'Connected apps', s:'WhatsApp, Apple Cal' },
            { t:'Privacy & data', s:'' },
            { t:'Help & support', s:'' },
          ].map((row,i,arr)=>(
            <div key={i} onClick={()=>{ if(row.id==='settings'){ onGo('settings'); onClose(); }}} style={{
              display:'flex', alignItems:'center', padding:'13px 16px', cursor: row.id?'pointer':'default',
              borderBottom: i<arr.length-1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ flex:1, fontSize:14, color:'var(--ink)', fontWeight: row.id==='settings'?600:400 }}>{row.t}</div>
              {row.s && <div style={{ fontSize:13, color:'var(--ink-3)', marginRight:8 }}>{row.s}</div>}
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="rgba(26,22,32,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

Object.assign(window, { DocumentsScreen, FamilyScreen, ReceiptsScreen, MoreSheet });
