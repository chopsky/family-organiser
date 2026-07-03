// Kids mode shell — what Child Mode renders instead of the adult Layout.
// Owns the shared surface: active-kid switcher, per-kid live theme, star
// balance, the four screens (Quests / Star Shop / My Days / Me) and the two
// form factors from the design spec: floating bottom nav on mobile, left
// rail on tablet/desktop (md+). The existing child routes stay the source of
// truth for navigation (/tasks /rewards /calendar /settings), so deep links
// and the back button keep working.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { kidTheme, isKidMember, KIDS_INK } from '../../lib/kidsTheme';
import { KidsLogo } from './ui';
import QuestsScreen from './QuestsScreen';
import ShopScreen from './ShopScreen';
import DaysScreen from './DaysScreen';
import MeScreen from './MeScreen';

const PATH_TAB = { '/tasks': 'quests', '/rewards': 'shop', '/calendar': 'days', '/settings': 'me' };
const TAB_PATH = { quests: '/tasks', shop: '/rewards', days: '/calendar', me: '/settings' };

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private browsing */ } }

export default function KidsShell() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = PATH_TAB[location.pathname] || 'quests';

  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const kids = useMemo(() => members.filter(isKidMember), [members]);

  // Active kid: persisted per device so the same child keeps their view
  // between visits on a shared tablet/phone.
  const [activeKidId, setActiveKidId] = useState(() => safeGet('kidsActiveKid') || null);
  const kid = kids.find((k) => k.id === activeKidId) || kids[0] || null;
  const kidIndex = Math.max(0, kids.findIndex((k) => k.id === kid?.id));
  const pickKid = useCallback((id) => { setActiveKidId(id); safeSet('kidsActiveKid', id); }, []);

  // Shared chores day state: Quests renders it, the rail + Shop read the
  // star balances, and completing a quest updates both in one place.
  const [day, setDay] = useState(null); // { date, tasks, balances }
  const loadDay = useCallback(async () => {
    try {
      const { data } = await api.get('/chores');
      setDay(data);
    } catch { /* screens show their own empty states */ }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const { data } = await api.get('/household');
      setMembers(data.members || []);
    } catch { /* keep whatever we had */ }
    setLoaded(true);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state lands after the await
  useEffect(() => { loadMembers(); loadDay(); }, [loadMembers, loadDay]);

  // Local patch after the Me screen saves a colour/avatar, so the re-theme is
  // instant without waiting for a refetch.
  const patchMember = useCallback((id, patch) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const theme = kidTheme(kid, kidIndex);
  const balance = (day?.balances && kid && day.balances[kid.id]) || 0;

  const screen = kid && (
    tab === 'quests' ? <QuestsScreen kid={kid} theme={theme} day={day} setDay={setDay} kids={kids} pickKid={pickKid} />
    : tab === 'shop' ? <ShopScreen kid={kid} theme={theme} balance={balance} onBalance={(kidId, bal) => setDay((d) => (d ? { ...d, balances: { ...d.balances, [kidId]: bal } } : d))} />
    : tab === 'days' ? <DaysScreen kid={kid} theme={theme} members={members} />
    : <MeScreen kid={kid} theme={theme} onSaved={patchMember} />
  );

  return (
    <div
      className="flex flex-col md:flex-row"
      style={{ height: '100dvh', overflow: 'hidden', fontFamily: "'Fredoka', system-ui, sans-serif", color: KIDS_INK.ink, background: theme.bg, WebkitTapHighlightColor: 'transparent' }}
    >
      {/* tablet / desktop left rail */}
      <Rail tab={tab} navigate={navigate} theme={theme} kids={kids} kid={kid} pickKid={pickKid} balance={balance} />

      <div className="flex-1 min-h-0 overflow-y-auto safe-top" style={{ scrollbarWidth: 'none' }}>
        {/* Tablet content padding comes from the scroll area (34px 38px, per
            the tablet spec); phone screens pad themselves and get clearance
            for the floating bottom nav. */}
        <div className="mx-auto w-full md:max-w-[860px]" style={isMobile ? { paddingBottom: 120 } : { padding: '34px 38px' }}>
          {!loaded ? null : !kid ? <NoKids theme={theme} /> : screen}
        </div>
      </div>

      {/* mobile floating bottom nav */}
      <BottomNav tab={tab} navigate={navigate} theme={theme} />
    </div>
  );
}

// Child Mode is on but the household has no child members yet — point the
// grown-up at Family setup (behind the exit gate) rather than a blank screen.
function NoKids({ theme }) {
  return (
    <div style={{ padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 64 }}>🧒</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 10 }}>No kids here yet!</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: KIDS_INK.ink2, marginTop: 8, maxWidth: 340, margin: '8px auto 0' }}>
        Ask a grown-up to add children on the Family page, then Kids mode will light up.
      </div>
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
        <KidsLogo c1={theme.c1} c2={theme.c2} />
      </div>
    </div>
  );
}

export function KidSwitch({ kids, kid, pickKid, stacked = false }) {
  if (kids.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 8, background: stacked ? 'transparent' : 'rgba(255,255,255,0.7)', padding: stacked ? 0 : 5, borderRadius: 999, border: stacked ? 'none' : '2px solid rgba(49,43,75,0.06)' }}>
      {kids.map((k, i) => {
        const on = k.id === kid?.id;
        const th = kidTheme(k, i);
        return (
          <button key={k.id} onClick={() => pickKid(k.id)} style={{ display: 'flex', alignItems: 'center', gap: stacked ? 11 : 7, padding: stacked ? '8px 12px 8px 8px' : '6px 14px 6px 6px', borderRadius: stacked ? 18 : 999, border: 0, cursor: 'pointer', fontFamily: 'inherit',
            background: on ? th.grad : (stacked ? '#fff' : 'transparent'), boxShadow: on ? '0 4px 12px rgba(49,43,75,0.18)' : (stacked ? '0 2px 0 rgba(49,43,75,0.05)' : 'none') }}>
            <span style={{ width: stacked ? 40 : 30, height: stacked ? 40 : 30, borderRadius: '50%', background: on ? 'rgba(255,255,255,0.3)' : th.soft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: stacked ? 22 : 17 }}>{th.emoji}</span>
            <b style={{ fontWeight: 600, fontSize: stacked ? 16 : 14, color: on ? '#fff' : KIDS_INK.ink2 }}>{k.name}</b>
          </button>
        );
      })}
    </div>
  );
}

const NAV_ITEMS = [
  ['quests', 'Quests', '⭐'],
  ['shop', 'Shop', '🎁'],
  ['days', 'My Days', '📅'],
];

function Rail({ tab, navigate, theme, kids, kid, pickKid, balance }) {
  const items = [...NAV_ITEMS, ['me', 'Me', theme.emoji]];
  return (
    <div className="hidden md:flex" style={{ width: 236, flexShrink: 0, background: 'rgba(255,255,255,0.6)', borderRight: '2px solid rgba(49,43,75,0.06)', flexDirection: 'column', padding: '26px 18px' }}>
      <div style={{ padding: '2px 2px 18px' }}><KidsLogo c1={theme.c1} c2={theme.c2} /></div>

      <div style={{ marginBottom: 22 }}>
        <KidSwitch kids={kids} kid={kid} pickKid={pickKid} stacked />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(([k, label, em]) => {
          const on = k === tab;
          return (
            <button key={k} onClick={() => navigate(TAB_PATH[k])} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 18, border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: on ? theme.grad : 'transparent', color: on ? '#fff' : KIDS_INK.ink2, boxShadow: on ? '0 6px 16px rgba(49,43,75,0.16)' : 'none' }}>
              <span style={{ fontSize: 24, filter: on ? 'none' : 'grayscale(.3)' }}>{em}</span>
              <b style={{ fontWeight: 600, fontSize: 17 }}>{label}</b>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ background: theme.grad, borderRadius: 22, padding: '16px 18px', color: '#fff', textAlign: 'center', boxShadow: '0 8px 20px rgba(49,43,75,0.18)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: .9 }}>My stars</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 38 }}>⭐</span><span style={{ fontSize: 40, fontWeight: 600 }}>{balance}</span>
        </div>
      </div>
    </div>
  );
}

function BottomNav({ tab, navigate, theme }) {
  const items = [...NAV_ITEMS, ['me', 'Me', theme.emoji]];
  return (
    <div className="md:hidden" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', pointerEvents: 'none', zIndex: 40 }}>
      <div style={{ display: 'flex', gap: 8, background: '#fff', borderRadius: 26, padding: 8, boxShadow: '0 8px 26px rgba(49,43,75,0.16)', border: '2px solid rgba(49,43,75,0.05)', pointerEvents: 'auto' }}>
        {items.map(([k, label, em]) => {
          const on = k === tab;
          return (
            <button key={k} onClick={() => navigate(TAB_PATH[k])} style={{ flex: 1, padding: '10px 0', borderRadius: 19, border: 0, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: on ? theme.grad : 'transparent' }}>
              <span style={{ fontSize: 22, filter: on ? 'none' : 'grayscale(.3)', transform: on ? 'scale(1.05)' : 'none' }}>{em}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: on ? '#fff' : KIDS_INK.ink3 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
