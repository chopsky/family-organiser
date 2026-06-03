/**
 * AdminPromoCodes - create + manage campaign promo codes.
 *
 * Codes grant a free period (default 1 year) by extending a household's
 * trial when redeemed in Settings -> Plan -> "Have a promo code?". The grant
 * lands on the households row, so it works on web + iOS uniformly.
 *
 * Backed by /api/admin/promo-codes (GET list, POST create, PATCH toggle).
 */
import { useEffect, useState } from 'react';
import api from '../../lib/api';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function grantLabel(days) {
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}

export default function AdminPromoCodes() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Create form
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [grantDays, setGrantDays] = useState('365');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');

  const [togglingId, setTogglingId] = useState(null);

  async function loadCodes() {
    setLoading(true);
    setListError('');
    try {
      const { data } = await api.get('/admin/promo-codes');
      setCodes(data.codes || []);
    } catch (err) {
      setListError(err.response?.data?.error || 'Could not load promo codes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCodes(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError('');
    setCreatedMsg('');
    try {
      const body = {
        code: code.trim(),
        description: description.trim() || undefined,
        grant_days: grantDays ? Number(grantDays) : 365,
        max_redemptions: maxRedemptions === '' ? null : Number(maxRedemptions),
        // <input type="date"> gives YYYY-MM-DD; treat as end-of-day UTC.
        expires_at: expiresAt ? `${expiresAt}T23:59:59Z` : null,
      };
      const { data } = await api.post('/admin/promo-codes', body);
      setCodes((prev) => [data.code, ...prev]);
      setCreatedMsg(`Created ${data.code.code}.`);
      setCode(''); setDescription(''); setGrantDays('365'); setMaxRedemptions(''); setExpiresAt('');
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Could not create the code.');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(c) {
    setTogglingId(c.id);
    try {
      const { data } = await api.patch(`/admin/promo-codes/${c.id}`, { active: !c.active });
      setCodes((prev) => prev.map((x) => (x.id === c.id ? data.code : x)));
    } catch (err) {
      setListError(err.response?.data?.error || 'Could not update the code.');
    } finally {
      setTogglingId(null);
    }
  }

  const inputCls = 'w-full border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent';
  const labelCls = 'block text-xs font-semibold text-cocoa mb-1';

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Promo codes</h1>

      {/* Create */}
      <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Create a campaign code</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Code</label>
            <input
              className={`${inputCls} uppercase`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="FREEYEAR"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Description (internal)</label>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Launch campaign" />
          </div>
          <div>
            <label className={labelCls}>Free period (days)</label>
            <input className={inputCls} type="number" min="1" value={grantDays} onChange={(e) => setGrantDays(e.target.value)} placeholder="365" />
          </div>
          <div>
            <label className={labelCls}>Max redemptions (blank = unlimited)</label>
            <input className={inputCls} type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="500" />
          </div>
          <div>
            <label className={labelCls}>Expires (blank = no end date)</label>
            <input className={inputCls} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating || !code.trim()}
              className="bg-plum hover:bg-plum-pressed disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {creating ? 'Creating…' : 'Create code'}
            </button>
          </div>
        </form>
        {createError && <p className="text-sm text-coral mt-3">{createError}</p>}
        {createdMsg && <p className="text-sm text-sage mt-3">{createdMsg}</p>}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">All codes</h2>
        {listError && <p className="text-sm text-coral mb-3">{listError}</p>}
        {loading ? (
          <p className="text-sm text-warm-grey">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-warm-grey">No codes yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-warm-grey border-b border-cream-border">
                  <th className="py-2 pr-3 font-semibold">Code</th>
                  <th className="py-2 pr-3 font-semibold">Grants</th>
                  <th className="py-2 pr-3 font-semibold">Redeemed</th>
                  <th className="py-2 pr-3 font-semibold">Expires</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const exhausted = c.max_redemptions != null && c.redemption_count >= c.max_redemptions;
                  const expired = c.expires_at && new Date(c.expires_at) < new Date();
                  const live = c.active && !exhausted && !expired;
                  return (
                    <tr key={c.id} className="border-b border-cream-border/60">
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-charcoal uppercase tracking-wide">{c.code}</span>
                        {c.description && <span className="block text-xs text-warm-grey">{c.description}</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{grantLabel(c.grant_days)}</td>
                      <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">
                        {c.redemption_count}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ''}
                      </td>
                      <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{fmtDate(c.expires_at)}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          style={{
                            background: live ? '#EDF5EE' : '#FDF0EB',
                            color: live ? '#3C7842' : '#B14828',
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap',
                          }}
                        >
                          {!c.active ? 'Disabled' : exhausted ? 'Fully claimed' : expired ? 'Expired' : 'Live'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggle(c)}
                          disabled={togglingId === c.id}
                          className="text-xs font-medium text-plum hover:underline disabled:opacity-50"
                        >
                          {togglingId === c.id ? '…' : c.active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
