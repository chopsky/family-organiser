// Kids mode — Star Shop. Shows the kid's star balance big, then two ways to
// spend: COSMETICS the kid buys for themselves (premium themes + stickers,
// Phase 2) and the household REWARDS a grown-up set (screen time, treats).
// Every spend goes through the shared star ledger. Cosmetics are the renewable
// star-sink; a streak never grants one - it pays stars, stars buy these.
import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { shopItems } from '../../lib/kidsCosmetics';
import { KID_THEME_ART } from '../../lib/kidsThemeArt';
import { StarPill, Celebrate } from './ui';

export default function ShopScreen({ kid, theme, balance, onBalance, onSaved }) {
  const isMobile = useIsMobile();
  const [rewards, setRewards] = useState(null); // all active household rewards
  const [cos, setCos] = useState(null);         // { available, owned, catalogue }
  const [celebrate, setCelebrate] = useState(null);
  const [redeemingId, setRedeemingId] = useState(null);
  const [buyingKey, setBuyingKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/rewards');
      setRewards((data.rewards || data || []).filter((r) => r.active !== false));
    } catch {
      setRewards([]);
    }
  }, []);
  const loadCos = useCallback(async () => {
    try {
      const { data } = await api.get(`/kids/cosmetics?member_id=${kid.id}`);
      setCos(data);
    } catch {
      setCos({ available: false, owned: [], catalogue: [] });
    }
  }, [kid.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state lands after the await
  useEffect(() => { load(); loadCos(); }, [load, loadCos]);

  // Only rewards that apply to THIS child: who_ids scopes a reward to
  // specific members; empty means the whole household (same rule as the
  // adult Rewards page).
  const myRewards = (rewards || []).filter((r) => {
    const ids = r.who_ids || [];
    return ids.length === 0 || ids.includes(kid.id);
  });

  const cosmetics = cos?.available ? shopItems(cos.catalogue, cos.owned, balance) : [];
  const themeItems = cosmetics.filter((i) => i.kind === 'theme');
  const stickerItems = cosmetics.filter((i) => i.kind === 'sticker');

  const applyTheme = (key) => {
    // Wear an owned theme: re-theme the shell live (onSaved) + persist to the
    // member record (same path the Me picker uses).
    onSaved?.(kid.id, { kid_color: key });
    api.patch('/household/profile', { user_id: kid.id, kid_color: key }).catch(() => {});
  };

  const buy = async (item) => {
    if (buyingKey) return;
    setBuyingKey(item.key);
    try {
      const { data } = await api.post(`/kids/cosmetics/${item.key}/buy`, { member_id: kid.id });
      if (typeof data?.balance === 'number') onBalance(kid.id, data.balance);
      if (data?.owned) setCos((c) => (c ? { ...c, owned: data.owned } : c));
      if (item.kind === 'theme') applyTheme(item.key); // new theme: wear it right away
      setCelebrate(item.kind === 'theme'
        ? { emoji: '🎨', title: 'New theme!', sub: `${item.name} is yours` }
        : { emoji: item.emoji || '✨', title: 'Nice sticker!', sub: item.name });
    } catch { /* server guards balance/season; leave the card as-is */ }
    setBuyingKey(null);
  };

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
      <div style={{ fontSize: isMobile ? 30 : 34, fontWeight: 600, letterSpacing: -0.6, margin: isMobile ? '0 0 14px' : '0 0 16px' }}>
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
            <span style={{ fontSize: 56, fontWeight: 600, lineHeight: 1 }}>{balance}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, opacity: .92, marginTop: 6 }}>stars to spend!</div>
        </div>
      ) : (
        <div style={{ background: theme.grad, borderRadius: 28, padding: '24px 28px', color: '#fff', marginBottom: 24, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 12px 30px rgba(49,43,75,0.2)' }}>
          <div style={{ position: 'absolute', right: 20, top: -16, fontSize: 130, opacity: .18 }}>⭐</div>
          <span style={{ fontSize: 64 }}>⭐</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, opacity: .92 }}>{kid.name}, you have</div>
            <div style={{ fontSize: 52, fontWeight: 600, lineHeight: 1 }}>{balance} <span style={{ fontSize: 22, fontWeight: 600, opacity: .9 }}>stars</span></div>
          </div>
        </div>
      )}

      {/* Parent-set rewards first - the real-world treats are the headline of
          the shop; cosmetics (themes + stickers) sit below. */}
      {myRewards.length > 0 && <SectionTitle isMobile={isMobile}>Pick a treat 🎁</SectionTitle>}
      <div className="grid grid-cols-2 md:grid-cols-3" style={{ gap: isMobile ? 14 : 16, marginBottom: (themeItems.length || stickerItems.length) ? (isMobile ? 26 : 30) : 0 }}>
        {myRewards.map((r) => {
          const can = balance >= r.cost;
          const pct = Math.min(1, r.cost ? balance / r.cost : 1);
          return (
            <div key={r.id} className="kids-card-in" style={{ background: theme.card, backdropFilter: theme.cardBlur, borderRadius: 24, padding: '16px 14px 14px', textAlign: 'center',
              border: can ? `2px solid ${theme.accent}` : `2px solid ${theme.cardBorder}`,
              boxShadow: theme.cardShadow }}>
              <div style={{ fontSize: 46, marginBottom: 6, filter: can ? 'none' : 'grayscale(.4)', opacity: can ? 1 : .7 }}>{r.emoji || '🎁'}</div>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2, minHeight: 36, color: theme.cardText }}>{r.title}</div>
              <div style={{ margin: '8px 0 12px', display: 'flex', justifyContent: 'center' }}><StarPill n={r.cost} /></div>
              {can ? (
                <button onClick={() => redeem(r)} disabled={redeemingId === r.id} style={{ width: '100%', padding: '11px', borderRadius: 16, border: 0, cursor: 'pointer', fontFamily: 'inherit',
                  background: theme.grad, color: '#fff', fontSize: 15, fontWeight: 600, boxShadow: '0 5px 0 rgba(49,43,75,0.12)', opacity: redeemingId === r.id ? .7 : 1 }}>
                  {redeemingId === r.id ? '…' : 'Get it!'}
                </button>
              ) : (
                <div>
                  <div style={{ height: 10, borderRadius: 999, background: theme.dark ? 'rgba(255,255,255,0.14)' : '#EDEBF4', overflow: 'hidden' }}>
                    <div style={{ width: `${pct * 100}%`, height: '100%', background: theme.accent, borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: theme.cardText3, marginTop: 6 }}>{r.cost - balance} more ⭐</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cosmetics: themes + stickers the kid buys with their own stars. */}
      {themeItems.length > 0 && (
        <>
          <SectionTitle isMobile={isMobile}>Themes 🎨</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: isMobile ? 14 : 16, marginBottom: isMobile ? 22 : 26 }}>
            {themeItems.map((it) => (
              <ThemeCard key={it.key} it={it} theme={theme} balance={balance} worn={theme.key === it.key} busy={buyingKey === it.key}
                onBuy={() => buy(it)} onWear={() => applyTheme(it.key)} />
            ))}
          </div>
        </>
      )}
      {stickerItems.length > 0 && (
        <>
          <SectionTitle isMobile={isMobile}>Stickers ✨</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: isMobile ? 14 : 16, marginBottom: isMobile ? 22 : 26 }}>
            {stickerItems.map((it) => (
              <StickerCard key={it.key} it={it} theme={theme} balance={balance} busy={buyingKey === it.key} onBuy={() => buy(it)} />
            ))}
          </div>
        </>
      )}

      {rewards && myRewards.length === 0 && cosmetics.length === 0 && (
        <div className="kids-card-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 64 }}>🎁</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: theme.onInk2, marginTop: 10 }}>No treats in the shop yet</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: theme.onInk3, marginTop: 6 }}>Ask a grown-up to add some rewards!</div>
        </div>
      )}

      {celebrate && <Celebrate data={celebrate} onDone={() => setCelebrate(null)} />}
    </div>
  );
}

function SectionTitle({ children, isMobile }) {
  return <div style={{ fontSize: isMobile ? 19 : 21, fontWeight: 600, padding: isMobile ? '0 4px 12px' : '0 4px 14px' }}>{children}</div>;
}

// Shared price/lock footer for a cosmetic card. Owned → worn / wear / owned.
// Otherwise the price is ALWAYS shown (StarPill) with either a buy button (can
// afford) or a progress bar + "X more ⭐" (saving up) — the same treatment as
// the "Pick a treat" reward tiles, so cost + goal are visible at every stage.
function CosmeticAction({ it, theme, balance, worn, busy, onBuy, onWear }) {
  if (it.owned) {
    if (it.kind === 'theme') {
      return worn
        ? <div style={{ fontSize: 13, fontWeight: 600, color: theme.accent, padding: '9px 0' }}>Wearing ✓</div>
        : <button onClick={onWear} style={{ width: '100%', padding: '10px', borderRadius: 14, border: `2px solid ${theme.accent}`, background: theme.card, backdropFilter: theme.cardBlur, cursor: 'pointer', fontFamily: 'inherit', color: theme.accent, fontSize: 14, fontWeight: 600 }}>Wear it</button>;
    }
    return <div style={{ fontSize: 13, fontWeight: 600, color: theme.accent, padding: '9px 0' }}>Owned ✓</div>;
  }
  const pct = Math.min(1, it.cost ? balance / it.cost : 1);
  return (
    <>
      <div style={{ margin: '0 0 10px', display: 'flex', justifyContent: 'center' }}><StarPill n={it.cost} /></div>
      {it.affordable ? (
        <button onClick={onBuy} disabled={busy} style={{ width: '100%', padding: '10px', borderRadius: 14, border: 0, cursor: 'pointer', fontFamily: 'inherit',
          background: theme.grad, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: '0 5px 0 rgba(49,43,75,0.12)', opacity: busy ? .7 : 1 }}>
          {busy ? '…' : 'Get it!'}
        </button>
      ) : (
        <div>
          <div style={{ height: 10, borderRadius: 999, background: theme.dark ? 'rgba(255,255,255,0.14)' : '#EDEBF4', overflow: 'hidden' }}>
            <div style={{ width: `${pct * 100}%`, height: '100%', background: theme.accent, borderRadius: 999 }} />
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: theme.cardText3, marginTop: 6 }}>{it.cost - balance} more ⭐</div>
        </div>
      )}
    </>
  );
}

function ThemeCard({ it, theme, balance, worn, busy, onBuy, onWear }) {
  const art = KID_THEME_ART[it.key];
  return (
    <div className="kids-card-in" style={{ background: theme.card, backdropFilter: theme.cardBlur, borderRadius: 22, padding: '12px', textAlign: 'center',
      border: worn ? `2px solid ${theme.accent}` : `2px solid ${theme.cardBorder}`, boxShadow: theme.cardShadow }}>
      {/* Banner art on a gradient backdrop — the gradient shows through if the
          image is missing/fails, so this is safe before the files are added. */}
      <div style={{ position: 'relative', height: 76, borderRadius: 16, marginBottom: 8, overflow: 'hidden',
        background: `linear-gradient(160deg, ${it.theme.c1}, ${it.theme.c2})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {art && (
          <img src={art} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: it.owned ? 'none' : 'brightness(0.72)' }} />
        )}
        {!it.owned && <span style={{ position: 'relative', fontSize: 24, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))' }}>🔒</span>}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8, color: theme.cardText }}>{it.name}</div>
      <CosmeticAction it={it} theme={theme} balance={balance} worn={worn} busy={busy} onBuy={onBuy} onWear={onWear} />
    </div>
  );
}

function StickerCard({ it, theme, balance, busy, onBuy }) {
  return (
    <div className="kids-card-in" style={{ background: theme.card, backdropFilter: theme.cardBlur, borderRadius: 22, padding: '14px 12px 12px', textAlign: 'center',
      border: it.owned ? `2px solid ${theme.accent}` : `2px solid ${theme.cardBorder}`, boxShadow: theme.cardShadow }}>
      <div style={{ fontSize: 46, marginBottom: 6, filter: it.owned ? 'none' : 'grayscale(.5) opacity(.75)' }}>{it.emoji}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: theme.cardText }}>{it.name}{it.seasonal ? ' ⏳' : ''}</div>
      <CosmeticAction it={it} theme={theme} balance={balance} busy={busy} onBuy={onBuy} />
    </div>
  );
}
