// Kids mode — Star Shop (rewards). Shows the kid's star balance big, and the
// household's reward cards: "Get it!" when affordable, otherwise a progress
// bar toward the cost. Redeeming spends stars from the shared ledger (the
// same redemption log parents fulfil from the adult Rewards page) and fires
// the celebration overlay.
import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { KIDS_INK } from '../../lib/kidsTheme';
import { StarPill, Celebrate } from './ui';

export default function ShopScreen({ kid, theme, balance, onBalance }) {
  const isMobile = useIsMobile();
  const [rewards, setRewards] = useState(null); // all active household rewards
  const [celebrate, setCelebrate] = useState(null);
  const [redeemingId, setRedeemingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/rewards');
      setRewards((data.rewards || data || []).filter((r) => r.active !== false));
    } catch {
      setRewards([]);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state lands after the await
  useEffect(() => { load(); }, [load]);

  // Only rewards that apply to THIS child: who_ids scopes a reward to
  // specific members; empty means the whole household (same rule as the
  // adult Rewards page).
  const myRewards = (rewards || []).filter((r) => {
    const ids = r.who_ids || [];
    return ids.length === 0 || ids.includes(kid.id);
  });

  const redeem = async (r) => {
    if (redeemingId) return;
    setRedeemingId(r.id);
    try {
      const { data } = await api.post(`/rewards/${r.id}/redeem`, { member_id: kid.id });
      if (typeof data?.balance === 'number') onBalance(kid.id, data.balance);
      setCelebrate({ emoji: r.emoji || '🎁', title: 'Yay! Redeemed', sub: r.title });
    } catch { /* balance guard on the server; leave the card as-is */ }
    setRedeemingId(null);
  };

  return (
    <div style={{ padding: isMobile ? '20px 18px 0' : 0 }}>
      <div style={{ fontSize: isMobile ? 30 : 34, fontWeight: 700, letterSpacing: -0.6, margin: isMobile ? '16px 0 14px' : '0 0 16px' }}>
        Star Shop <span className="kids-wobble">🛍️</span>
      </div>

      {/* Balance banner: stacked on mobile, horizontal on tablet (per the
          tablet spec: big star + inline "N stars"). */}
      {isMobile ? (
        <div style={{ background: theme.grad, borderRadius: 30, padding: '22px 24px', color: '#fff', marginBottom: 22, position: 'relative', overflow: 'hidden', boxShadow: '0 10px 26px rgba(49,43,75,0.2)' }}>
          <div style={{ position: 'absolute', right: -14, top: -14, fontSize: 120, opacity: .18 }}>⭐</div>
          <div style={{ fontSize: 15, fontWeight: 600, opacity: .92 }}>{kid.name}, you have</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 54, lineHeight: 1 }}>⭐</span>
            <span style={{ fontSize: 56, fontWeight: 700, lineHeight: 1 }}>{balance}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, opacity: .92, marginTop: 6 }}>stars to spend!</div>
        </div>
      ) : (
        <div style={{ background: theme.grad, borderRadius: 28, padding: '24px 28px', color: '#fff', marginBottom: 24, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 12px 30px rgba(49,43,75,0.2)' }}>
          <div style={{ position: 'absolute', right: 20, top: -16, fontSize: 130, opacity: .18 }}>⭐</div>
          <span style={{ fontSize: 64 }}>⭐</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, opacity: .92 }}>{kid.name}, you have</div>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{balance} <span style={{ fontSize: 22, fontWeight: 600, opacity: .9 }}>stars</span></div>
          </div>
        </div>
      )}

      {rewards && myRewards.length > 0 && <div style={{ fontSize: isMobile ? 19 : 21, fontWeight: 700, padding: isMobile ? '0 4px 12px' : '0 4px 14px' }}>Pick a treat 🎁</div>}
      <div className="grid grid-cols-2 md:grid-cols-3" style={{ gap: isMobile ? 14 : 16 }}>
        {myRewards.map((r) => {
          const can = balance >= r.cost;
          const pct = Math.min(1, r.cost ? balance / r.cost : 1);
          return (
            <div key={r.id} className="kids-card-in" style={{ background: '#fff', borderRadius: 24, padding: '16px 14px 14px', textAlign: 'center',
              border: can ? `2px solid ${theme.accent}` : '2px solid rgba(49,43,75,0.06)',
              boxShadow: '0 6px 0 rgba(49,43,75,0.05), 0 10px 20px rgba(49,43,75,0.06)' }}>
              <div style={{ fontSize: 46, marginBottom: 6, filter: can ? 'none' : 'grayscale(.4)', opacity: can ? 1 : .7 }}>{r.emoji || '🎁'}</div>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2, minHeight: 36 }}>{r.title}</div>
              <div style={{ margin: '8px 0 12px', display: 'flex', justifyContent: 'center' }}><StarPill n={r.cost} /></div>
              {can ? (
                <button onClick={() => redeem(r)} disabled={redeemingId === r.id} style={{ width: '100%', padding: '11px', borderRadius: 16, border: 0, cursor: 'pointer', fontFamily: 'inherit',
                  background: theme.grad, color: '#fff', fontSize: 15, fontWeight: 700, boxShadow: '0 5px 0 rgba(49,43,75,0.12)', opacity: redeemingId === r.id ? .7 : 1 }}>
                  {redeemingId === r.id ? '…' : 'Get it!'}
                </button>
              ) : (
                <div>
                  <div style={{ height: 10, borderRadius: 999, background: '#EDEBF4', overflow: 'hidden' }}>
                    <div style={{ width: `${pct * 100}%`, height: '100%', background: theme.accent, borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: KIDS_INK.ink3, marginTop: 6 }}>{r.cost - balance} more ⭐</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rewards && myRewards.length === 0 && (
        <div className="kids-card-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 64 }}>🎁</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: KIDS_INK.ink2, marginTop: 10 }}>No treats in the shop yet</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: KIDS_INK.ink3, marginTop: 6 }}>Ask a grown-up to add some rewards!</div>
        </div>
      )}

      {celebrate && <Celebrate data={celebrate} onDone={() => setCelebrate(null)} />}
    </div>
  );
}
