// Main app — wires screens, tabs, sheets, tweaks
const { useState: useS, useEffect: useE } = React;

function useTweaks() {
  const [t, setT] = useS(window.__tweaks || {});
  useE(()=>{
    const h = e => setT(e.detail);
    window.addEventListener('tweaks-change', h);
    return () => window.removeEventListener('tweaks-change', h);
  },[]);
  return t;
}

function App() {
  const [tab, setTab] = useS(() => localStorage.getItem('hm-tab') || 'home');
  const [tasks, setTasks] = useS(window.HM_DATA.TASKS_INIT);
  const [groceries, setGroceries] = useS(window.HM_DATA.GROCERIES_INIT);
  const [meals] = useS(window.HM_DATA.MEALS_INIT);
  const [aiOpen, setAIOpen] = useS(false);
  const [addOpen, setAddOpen] = useS(false);
  const [addKind, setAddKind] = useS('task');
  const [moreOpen, setMoreOpen] = useS(false);
  const tw = useTweaks();
  const homeVar = tw.home || 'dashboard';

  useE(()=>{ localStorage.setItem('hm-tab', tab); }, [tab]);

  const toggleTask = (id) => setTasks(ts => ts.map(t => t.id===id ? { ...t, done: !t.done } : t));
  const toggleGroc = (id) => setGroceries(gs => gs.map(g => g.id===id ? { ...g, done: !g.done } : g));
  const addTask = ({ title, who, cat }) => {
    setTasks(ts => [{ id: 't'+Date.now(), title, who, cat, done:false, due:'Today' }, ...ts]);
  };
  const openAdd = (kind='task') => { setAddKind(kind); setAddOpen(true); };

  const screen = (() => {
    switch (tab) {
      case 'home':
        return homeVar === 'ai'
          ? <HomeAIFirst tasks={tasks} onToggleTask={toggleTask} groceries={groceries} meals={meals} onOpenAI={()=>setAIOpen(true)} onTab={setTab} onSettings={()=>setTab('settings')}/>
          : <HomeDashboard tasks={tasks} onToggleTask={toggleTask} groceries={groceries} meals={meals} onOpenAI={()=>setAIOpen(true)} onTab={setTab} onSettings={()=>setTab('settings')}/>;
      case 'cal':     return <CalendarScreen onAdd={()=>openAdd('event')} onSettings={()=>setTab('settings')}/>;
      case 'tasks':   return <TasksScreen tasks={tasks} onToggle={toggleTask} onAdd={()=>openAdd('task')} onSettings={()=>setTab('settings')}/>;
      case 'shop':    return <ShoppingScreen groceries={groceries} onToggle={toggleGroc} onAdd={()=>openAdd('grocery')} onSettings={()=>setTab('settings')}/>;
      case 'meal':    return <MealPlanScreen meals={meals} onPlan={()=>setAIOpen(true)} onSettings={()=>setTab('settings')}/>;
      case 'docs':    return <DocumentsScreen onAdd={()=>setAIOpen(true)} onSettings={()=>setTab('settings')}/>;
      case 'family':  return <FamilyScreen onSettings={()=>setTab('settings')}/>;
      case 'receipt': return <ReceiptsScreen onSettings={()=>setTab('settings')}/>;
      case 'settings': return <SettingsScreen onClose={()=>setTab('home')}/>;
      default: return null;
    }
  })();

  return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100vh', padding:'40px 20px', position:'relative' }}>
      {/* warm scrim behind device */}
      <div style={{
        position:'fixed', inset:0, zIndex:0,
        background:'radial-gradient(ellipse at center, #F5EFE3 0%, #E8E2D4 100%)',
      }}/>

      <div style={{ position:'relative', zIndex:1 }}>
        <IOSDevice width={402} height={874}>
          <div style={{ position:'relative', width:'100%', height:'100%', background:'var(--bg-app)' }}>
            <div className="ios-scroll" style={{ position:'absolute', inset:0, overflowY:'auto', overflowX:'hidden' }}>
              {screen}
            </div>

            {/* Persistent absolute status bar over content */}
            <div style={{ position:'absolute', top:0, left:0, right:0, zIndex:30, pointerEvents:'none' }}>
              <AppStatusBar/>
            </div>

            {/* Tab bar */}
            <TabBar active={tab} onChange={setTab} onAITap={()=>setAIOpen(true)} onMore={()=>setMoreOpen(true)}/>

            {/* Sheets */}
            <AISheet open={aiOpen} onClose={()=>setAIOpen(false)}/>
            <AddSheet open={addOpen} onClose={()=>setAddOpen(false)} kind={addKind} onSave={addTask}/>
            <MoreSheet open={moreOpen} onClose={()=>setMoreOpen(false)} onGo={setTab} active={tab}/>
          </div>
        </IOSDevice>

        {/* Caption under device */}
        <div style={{ textAlign:'center', marginTop:18, fontSize:12, color:'var(--ink-3)', fontFamily:'Inter, system-ui, sans-serif' }}>
          Housemait · iOS · {homeVar === 'ai' ? 'Home variant B (AI-first)' : 'Home variant A (Dashboard)'} · tap <b>Tweaks</b> to switch
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
