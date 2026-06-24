// Rewards page — kids spend earned stars on parent-set rewards; parents see
// what's been redeemed and mark it fulfilled. Shares one star economy with the
// Tasks page. Rebuilt from design_handoff_tasks_rewards_lists, wired to
// /api/rewards (+ /api/household for members). Mounted at /rewards.
import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import { BottomSheet } from '../components/BottomSheet';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useChildMode } from '../context/ChildModeContext';
import EmojiPicker from '../components/ui/EmojiPicker';
import { REWARD_PLUS_TASK_CATS, searchRewardPlusTaskEmojis } from '../lib/rewardIcons';

const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BG_SOFT = '#F3EEE5', STAR = '#D89B3A', STAR_BG = '#FBF1DE';
const SERIF = '"Instrument Serif", serif';
const INTER = '"Inter", system-ui, sans-serif';
const isKid = (m) => m?.member_type === 'dependent';

const Svg = (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke={p.c || 'currentColor'} strokeWidth={p.w || 2} strokeLinecap="round" strokeLinejoin="round">{p.children}</svg>;
const IcPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IcClose = (p) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcTrash = (p) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcPencil = (p) => <Svg {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>;
const StarFill = ({ s = 12, c = STAR }) => <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M12 2l3 6.3 6.9.9-5 4.8 1.2 6.8L12 17.8 5.9 20.8 7.1 14 2.1 9.2 9 8.3 12 2z" /></svg>;
const Tick = ({ s = 12, c = '#fff' }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function relWhen(iso) {
  const d = new Date(iso); const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return 'Today'; if (days === 1) return 'Yesterday'; if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── reward card ─────────────────────────────────────────────────────────────
function RewardCard({ reward, balance, color, onRedeem, redeeming, onRemove, onEdit }) {
  const [hover, setHover] = useState(false);
  const affordable = balance >= reward.cost;
  const pct = Math.min(100, Math.round((balance / Math.max(1, reward.cost)) * 100));
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', background: '#fff', borderRadius: 16, border: `1px solid ${LINE}`, padding: 16, boxShadow: '0 1px 4px rgba(26,22,32,0.05)' }}>
      {(onEdit || onRemove) && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, opacity: hover ? 1 : 0, transition: 'opacity .12s' }}>
          {onEdit && (
            <button onClick={() => onEdit(reward)} aria-label={`Edit ${reward.title}`}
              style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IcPencil s={14} c={INK2} />
            </button>
          )}
          {onRemove && (
            <button onClick={() => onRemove(reward)} aria-label={`Remove ${reward.title}`}
              style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IcTrash s={14} c="#C24A5E" />
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, fontSize: 24, background: STAR_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{reward.emoji || '🎁'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, fontFamily: INTER }}>{reward.title}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3 }}><StarFill s={12} /><span style={{ fontSize: 12.5, fontWeight: 700, color: '#A9772A' }}>{reward.cost}</span></div>
        </div>
      </div>
      {affordable ? (
        <button onClick={onRedeem} disabled={redeeming} style={{ width: '100%', marginTop: 12, padding: '10px', borderRadius: 11, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13.5, fontWeight: 700, background: color, color: '#fff', opacity: redeeming ? 0.6 : 1 }}>
          {redeeming ? 'Redeeming…' : 'Redeem'}
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, borderRadius: 99, background: BG_SOFT, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 11.5, color: INK3, marginTop: 5, fontWeight: 600 }}>{reward.cost - balance} more to go</div>
        </div>
      )}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function Rewards() {
  const [members, setMembers] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [balances, setBalances] = useState({});
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('columns'); // columns | focused | redeemed
  const { enabled: childMode } = useChildMode();
  const [focusKid, setFocusKid] = useState(null);
  const [redeemingId, setRedeemingId] = useState(null);
  const [modal, setModal] = useState(false);
  const isMobile = useIsMobile();

  // Everyone earns + redeems stars now. In Child Mode the device is locked to
  // kids, so we still show only dependents there (a kid shouldn't spend a
  // parent's stars); in full mode every member appears.
  const earners = childMode ? members.filter(isKid) : members;
  const pending = redemptions.filter((r) => !r.fulfilled).length;

  const load = useCallback(async () => {
    const [{ data: hh }, { data: rw }] = await Promise.all([api.get('/household'), api.get('/rewards')]);
    setMembers(hh.members || []);
    setRewards(rw.rewards || []);
    setBalances(rw.balances || {});
    setRedemptions(rw.redemptions || []);
    return hh.members || [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => { try { const m = await load(); if (!cancelled) setFocusKid((m[0] || {}).id || null); } catch { /* empty */ } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [load]);

  // A reward shows for a member if it lists them, or if it lists nobody
  // (who_ids empty = everyone — kept for legacy "Anyone" rewards).
  const rewardsFor = (kidId) => rewards.filter((r) => { const ids = r.who_ids || []; return ids.length === 0 || ids.includes(kidId); });

  const redeem = useCallback(async (reward, kidId) => {
    setRedeemingId(`${reward.id}:${kidId}`);
    try {
      const { data } = await api.post(`/rewards/${reward.id}/redeem`, { member_id: kidId });
      setBalances((b) => ({ ...b, [kidId]: data.balance }));
      if (data.redemption) setRedemptions((rs) => [data.redemption, ...rs]);
    } catch (e) { alert(e.response?.data?.error || 'Could not redeem.'); } finally { setRedeemingId(null); }
  }, []);

  const toggleFulfilled = useCallback(async (red) => {
    const next = !red.fulfilled;
    setRedemptions((rs) => rs.map((r) => (r.id === red.id ? { ...r, fulfilled: next } : r)));
    try { await api.patch(`/rewards/redemptions/${red.id}`, { fulfilled: next }); }
    catch { setRedemptions((rs) => rs.map((r) => (r.id === red.id ? { ...r, fulfilled: !next } : r))); }
  }, []);

  const removeReward = useCallback(async (reward) => {
    if (!window.confirm(`Remove the reward "${reward.title}"? Past redemptions are kept.`)) return;
    setRewards((rs) => rs.filter((r) => r.id !== reward.id));
    try { await api.delete(`/rewards/${reward.id}`); } catch { load(); }
  }, [load]);

  const saveReward = useCallback(async (form) => {
    const editId = modal && modal !== 'add' ? modal.id : null;
    try {
      if (editId) await api.patch(`/rewards/${editId}`, form);
      else await api.post('/rewards', form);
      setModal(false); await load();
    } catch (e) { alert(e.response?.data?.error || 'Could not save the reward.'); }
  }, [load, modal]);

  // Columns don't fit a phone - default to the single-kid Focused view there.
  const effView = isMobile && view === 'columns' ? 'focused' : view;
  const viewOpts = [
    ...(isMobile ? [] : [{ value: 'columns', label: 'Columns' }]),
    { value: 'focused', label: isMobile ? 'Rewards' : 'Focused' },
    // Kids can VIEW the Redeemed log (to see what a parent has fulfilled); the
    // "Mark fulfilled" action itself stays parent-only (see RedeemedLog).
    { value: 'redeemed', label: (pending && !isMobile) ? `Redeemed · ${pending}` : 'Redeemed' },
  ];

  return (
    <div style={{ height: '100%', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: INTER, color: INK }}>
      <PageHeader
        kicker="Spend stars"
        title="Rewards"
        actions={(
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', background: BG_SOFT, borderRadius: 10, padding: 3, gap: 3 }}>
              {viewOpts.map((o) => (
                <button key={o.value} onClick={() => setView(o.value)} style={{ padding: '7px 14px', borderRadius: 8, border: 0, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, background: effView === o.value ? '#fff' : 'transparent', color: effView === o.value ? INK : INK3, boxShadow: effView === o.value ? '0 1px 3px rgba(26,22,32,0.1)' : 'none' }}>{o.label}</button>
              ))}
            </div>
            {!childMode && <PillBtn primary aria-label="Add reward" className="w-9 justify-center px-0!" icon={<IcPlus s={16} w={2.4} c="#fff" />} onClick={() => setModal('add')} />}
          </div>
        )}
      />

      {loading ? (
        <Center>Loading…</Center>
      ) : earners.length === 0 ? (
        <Center>Add family members to start the star economy.</Center>
      ) : effView === 'redeemed' ? (
        <RedeemedLog redemptions={redemptions} members={members} onToggle={toggleFulfilled} readOnly={childMode} />
      ) : effView === 'focused' ? (
        <Focused kids={earners} focusKid={focusKid} setFocusKid={setFocusKid} balances={balances} rewardsFor={rewardsFor} redeem={redeem} redeemingId={redeemingId} removeReward={childMode ? undefined : removeReward} editReward={childMode ? undefined : setModal} />
      ) : (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 4, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          {earners.map((k) => {
            const hex = hexFor(k);
            return (
              <div key={k.id} style={{ flex: '0 0 320px', minWidth: 320, background: hex + '12', borderRadius: 24, padding: '18px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* pinned header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0 }}>
                  <Avatar member={k} size={48} bg="#fff" />
                  <div>
                    <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, lineHeight: 1 }}>{k.name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}><StarFill s={16} /><span style={{ fontSize: 18, fontWeight: 800, color: '#A9772A' }}>{balances[k.id] || 0}</span></div>
                  </div>
                </div>
                {/* only the reward list scrolls */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, margin: '0 -4px', padding: '0 4px 2px' }}>
                  {rewardsFor(k.id).map((r) => (
                    <div key={r.id} style={{ position: 'relative' }}>
                      <RewardCard reward={r} balance={balances[k.id] || 0} color={hex} redeeming={redeemingId === `${r.id}:${k.id}`} onRedeem={() => redeem(r, k.id)} onRemove={childMode ? undefined : removeReward} onEdit={childMode ? undefined : setModal} />
                    </div>
                  ))}
                  {rewardsFor(k.id).length === 0 && <div style={{ fontSize: 13, color: INK3, fontStyle: 'italic', padding: '8px 4px' }}>No rewards yet — add one.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <RewardModal reward={modal === 'add' ? null : modal} onClose={() => setModal(false)} onSave={saveReward} kids={earners} />}
    </div>
  );
}

function Center({ children }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK3, fontFamily: SERIF, fontSize: 24, textAlign: 'center' }}>{children}</div>;
}

function Focused({ kids, focusKid, setFocusKid, balances, rewardsFor, redeem, redeemingId, removeReward, editReward }) {
  const kid = kids.find((k) => k.id === focusKid) || kids[0];
  const hex = hexFor(kid);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* Single horizontally-scrollable row of who-to-view buttons (no wrap),
          so a large family scrolls sideways instead of stacking onto a 2nd row. */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
        {kids.map((k) => (
          <button key={k.id} onClick={() => setFocusKid(k.id)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px 8px', borderRadius: 14, cursor: 'pointer', fontFamily: INTER, background: k.id === kid.id ? '#fff' : 'transparent', border: k.id === kid.id ? `1.5px solid ${hexFor(k)}` : `1px solid ${LINE}` }}>
            <Avatar member={k} size={34} bg="#fff" /><span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{k.name}</span>
          </button>
        ))}
      </div>
      <div style={{ background: hex + '14', borderRadius: 22, padding: '28px 24px', textAlign: 'center', marginBottom: 22 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><StarFill s={34} /><span style={{ fontSize: 52, fontWeight: 800, color: INK, lineHeight: 1 }}>{balances[kid.id] || 0}</span></div>
        <div style={{ fontSize: 13, color: INK2, marginTop: 6, fontWeight: 600 }}>{kid.name}'s stars</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {rewardsFor(kid.id).map((r) => <RewardCard key={r.id} reward={r} balance={balances[kid.id] || 0} color={hex} redeeming={redeemingId === `${r.id}:${kid.id}`} onRedeem={() => redeem(r, kid.id)} onRemove={removeReward} onEdit={editReward} />)}
      </div>
    </div>
  );
}

function RedeemedLog({ redemptions, members, onToggle, readOnly }) {
  const memberOf = (id) => members.find((m) => m.id === id);
  if (redemptions.length === 0) return <Center>Nothing redeemed yet.</Center>;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxWidth: 720 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {redemptions.map((r) => {
          const m = memberOf(r.member_id);
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', borderRadius: 16, border: `1px solid ${LINE}`, padding: '14px 16px' }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, fontSize: 22, background: STAR_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.emoji || '🎁'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>{r.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 12, color: INK3 }}>
                  {m && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Avatar member={m} size={18} bg="#fff" />{m.name}</span>}
                  <span>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><StarFill s={11} />{r.cost}</span>
                  <span>·</span><span>{relWhen(r.created_at)}</span>
                </div>
              </div>
              {readOnly ? (
                // Kids see the status only - no power to mark it fulfilled.
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 99, fontFamily: INTER, fontSize: 13, fontWeight: 700, background: r.fulfilled ? '#E5F0E2' : STAR_BG, color: r.fulfilled ? '#3F6E3D' : '#A9772A' }}>
                  {r.fulfilled ? <><Tick s={12} c="#3F6E3D" /> Fulfilled</> : 'Waiting'}
                </span>
              ) : (
                <button onClick={() => onToggle(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 700, border: r.fulfilled ? 0 : `1.5px solid ${LINE_STRONG}`, background: r.fulfilled ? '#E5F0E2' : '#fff', color: r.fulfilled ? '#3F6E3D' : INK2 }}>
                  {r.fulfilled ? <><Tick s={12} c="#3F6E3D" /> Fulfilled</> : 'Mark fulfilled'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── add-reward modal ────────────────────────────────────────────────────────
function RewardModal({ onClose, onSave, kids, reward }) {
  const editing = !!reward;
  const [title, setTitle] = useState(reward?.title || '');
  const [emoji, setEmoji] = useState(reward?.emoji || '🎁');
  const [cost, setCost] = useState(reward?.cost ?? 20);
  const [whoIds, setWhoIds] = useState(reward?.who_ids || []);
  const toggleWho = (id) => setWhoIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const submit = () => { if (title.trim()) onSave({ title: title.trim(), emoji, cost, who_ids: whoIds }); };
  return (
    <BottomSheet open onDismiss={onClose} desktopWidthClass="sm:w-[460px]">
      <div className="overflow-y-auto min-h-0" style={{ padding: '8px 24px 24px', fontFamily: INTER }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK }}>{editing ? 'Edit reward' : 'New reward'}</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 8, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcClose s={18} c={INK2} /></button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Title</div>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 30 min screen time" style={input} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Icon</div>
          <EmojiPicker value={emoji} onChange={setEmoji} categories={REWARD_PLUS_TASK_CATS} searchFn={searchRewardPlusTaskEmojis} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>Cost</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setCost((c) => Math.max(0, c - 5))} style={stepBtn}>−</button>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 70, justifyContent: 'center', fontWeight: 800, fontSize: 18, color: '#A9772A' }}><StarFill s={16} /> {cost}</span>
            <button onClick={() => setCost((c) => Math.min(9999, c + 5))} style={stepBtn}>+</button>
          </div>
        </div>
        {kids.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 7 }}>For</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {kids.map((k) => <Chip key={k.id} on={whoIds.includes(k.id)} onClick={() => toggleWho(k.id)}>{k.name}</Chip>)}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ ...input, width: 'auto', padding: '10px 18px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submit} disabled={!title.trim()} style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: INTER, background: BRAND, color: '#fff', opacity: !title.trim() ? 0.5 : 1 }}>{editing ? 'Save' : 'Add reward'}</button>
        </div>
      </div>
    </BottomSheet>
  );
}
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, color: INK, outline: 'none', background: '#fff' };
const stepBtn = { width: 34, height: 34, borderRadius: 9, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: INK2 };
function Chip({ on, onClick, children }) {
  return <button onClick={onClick} style={{ padding: '8px 14px', borderRadius: 99, cursor: 'pointer', fontFamily: INTER, fontSize: 13, fontWeight: 600, border: on ? `1.5px solid ${BRAND}` : `1px solid ${LINE_STRONG}`, background: on ? '#EFE9FB' : '#fff', color: on ? BRAND : INK2 }}>{children}</button>;
}
