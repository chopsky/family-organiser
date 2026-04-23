// Settings screen + access
function SettingsScreen({ onClose }) {
  const member = window.HM_DATA.FAMILY.members[0];
  const Row = ({ title, value, toggle, onToggle, danger, chevron=true, last }) => (
    <div style={{
      display:'flex', alignItems:'center', padding:'13px 16px',
      borderBottom: last ? 'none' : '1px solid var(--line)',
      gap:12,
    }}>
      <div style={{ flex:1, fontSize:15, color: danger ? '#C44' : 'var(--ink)' }}>{title}</div>
      {value && <div style={{ fontSize:13, color:'var(--ink-3)' }}>{value}</div>}
      {toggle !== undefined && (
        <button onClick={()=>onToggle(!toggle)} style={{
          width:44, height:26, borderRadius:13, border:0, cursor:'pointer',
          background: toggle ? 'var(--brand)' : 'var(--line-strong)',
          position:'relative', padding:0, transition:'background 0.2s',
        }}>
          <div style={{
            position:'absolute', top:2, left: toggle ? 20 : 2,
            width:22, height:22, borderRadius:11, background:'#fff',
            boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left 0.2s',
          }}/>
        </button>
      )}
      {chevron && toggle===undefined && (
        <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="rgba(26,22,32,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )}
    </div>
  );
  const Group = ({ title, children }) => (
    <div style={{ marginBottom:18 }}>
      {title && <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', padding:'0 4px 8px' }}>{title}</div>}
      <div style={{ background:'#fff', borderRadius:18, overflow:'hidden', boxShadow:'0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}>
        {children}
      </div>
    </div>
  );

  const [notif, setNotif] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [darkAuto, setDarkAuto] = useState(false);
  const [whats, setWhats] = useState(true);

  return (
    <div style={{ padding:'70px 0 130px' }}>
      <div style={{ padding:'0 20px 18px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <button onClick={onClose} style={{
          width:36, height:36, borderRadius:'50%', background:'#fff', border:'1px solid var(--line)',
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>Settings</div>
        <div style={{ width:36 }}/>
      </div>

      <div style={{ padding:'0 20px 18px' }}>
        <div style={{ fontFamily:'Instrument Serif, serif', fontSize:38, lineHeight:1, color:'var(--ink)', letterSpacing:-0.6 }}>Settings</div>
      </div>

      <div style={{ padding:'0 16px' }}>
        {/* Profile card */}
        <Group>
          <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderBottom:'1px solid var(--line)' }}>
            <Avatar member={member} size={56}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:17, fontWeight:700, color:'var(--ink)' }}>Grant Reid</div>
              <div style={{ fontSize:12, color:'var(--ink-3)', marginTop:2 }}>Admin · grant@reid.family</div>
            </div>
            <button style={{
              padding:'6px 12px', borderRadius:99,
              background:'var(--brand-soft)', color:'var(--brand)', border:0, cursor:'pointer',
              fontSize:12, fontWeight:600, fontFamily:'inherit',
            }}>Edit</button>
          </div>
          <Row title="Family plan" value="£9/mo · 4 members" last/>
        </Group>

        <Group title="Preferences">
          <Row title="Notifications" toggle={notif} onToggle={setNotif}/>
          <Row title="Daily reminder" toggle={reminders} onToggle={setReminders}/>
          <Row title="Reminder time" value="07:00"/>
          <Row title="Language" value="English (UK)"/>
          <Row title="Units" value="Metric" last/>
        </Group>

        <Group title="Appearance">
          <Row title="Theme" value="Light"/>
          <Row title="Match system theme" toggle={darkAuto} onToggle={setDarkAuto}/>
          <Row title="Accent colour" value="Purple" last/>
        </Group>

        <Group title="AI">
          <Row title="Auto-suggest tasks" toggle={true} onToggle={()=>{}}/>
          <Row title="Voice input" toggle={true} onToggle={()=>{}}/>
          <Row title="Training data" value="Off" last/>
        </Group>

        <Group title="Connected apps">
          <Row title="WhatsApp" value="Connected" toggle={whats} onToggle={setWhats}/>
          <Row title="Apple Calendar" value="Connected"/>
          <Row title="Google Calendar" value="Connect"/>
          <Row title="Alexa" value="Not connected" last/>
        </Group>

        <Group title="Privacy & data">
          <Row title="Export my data"/>
          <Row title="Privacy policy"/>
          <Row title="Permissions" value="Camera, Location" last/>
        </Group>

        <Group title="Support">
          <Row title="Help centre"/>
          <Row title="Contact support"/>
          <Row title="Rate Housemait" last/>
        </Group>

        <Group>
          <Row title="Sign out" danger chevron={false}/>
        </Group>

        <div style={{ textAlign:'center', padding:'8px 0 20px', fontSize:11, color:'var(--ink-3)' }}>
          Housemait · 2.4.1 (build 1276)
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
