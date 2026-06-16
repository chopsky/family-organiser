import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import { IconReceipt, IconPlus, IconX, IconCheck, IconTrash } from '../components/Icons';
import { useCanWrite } from '../context/SubscriptionContext';
import SubscribePrompt from '../components/SubscribePrompt';
import { confirmDestructive } from '../lib/action-sheet';

/* ─── Helpers ─── */

const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

// Stable accent colour per merchant (so a shop always reads the same).
const MERCHANT_COLORS = ['#6B3FA0', '#E8724A', '#7DAE82', '#E0A458', '#4A9FCC', '#C74E95', '#3A9E6E', '#5B8DE0'];
function colorFor(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return MERCHANT_COLORS[h % MERCHANT_COLORS.length];
}

// Numeric value of a printed total like "£68.40" / "R 24,85".
function toNumber(totalText) {
  if (!totalText) return 0;
  const cleaned = String(totalText).replace(/[^0-9.,]/g, '').replace(/,(?=\d{2}$)/, '.').replace(/,/g, '');
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}
function currencySymbol(totalText) {
  const m = String(totalText || '').match(/[^\d.,\s]/);
  return m ? m[0] : '£';
}
// Show the total with a currency symbol. AI extraction sometimes drops the
// symbol (a bare "43.99"); prepend the household's currency in that case,
// but leave a total that already carries one (e.g. "£43.99", "R 24,85") alone.
function withCurrency(totalText, fallback = '£') {
  if (!totalText) return '—';
  return /[^\d.,\s]/.test(totalText) ? totalText : `${fallback}${totalText}`;
}

// The receipt's own purchase date (a YYYY-MM-DD, no time) is what belongs on the
// card - not when it was uploaded. Show that; only when the scan couldn't read a
// date do we fall back to the upload date, prefixed "Added" so it's never
// mistaken for the receipt date. The year is shown when it isn't the current one.
function purchasedLabel(r) {
  const fmt = (d) => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
  if (r.purchased_on) {
    const d = new Date(`${r.purchased_on}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '' : fmt(d);
  }
  if (r.created_at) {
    const d = new Date(r.created_at);
    return Number.isNaN(d.getTime()) ? '' : `Added ${fmt(d)}`;
  }
  return '';
}

/* ─── Main ─── */

export default function Receipt() {
  const canWrite = useCanWrite();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [openId, setOpenId] = useState(null); // receipt id whose detail modal is open
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/receipts');
      setReceipts(Array.isArray(data.receipts) ? data.receipts : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load receipts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFile(file) {
    if (!file) return;
    setScanning(true);
    setError('');
    const form = new FormData();
    form.append('receipt', file);
    try {
      const { data } = await api.post('/receipt', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
      // Jump straight into the new receipt's items so the matched/unmatched
      // result is visible (mirrors the old single-scan result screen).
      if (data.receiptId) setOpenId(data.receiptId);
      else if (data.message) setError(data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not scan receipt. Please try again.');
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Delete a receipt from the grid (optimistic, reconciles on failure).
  async function handleDeleteReceipt(id) {
    const ok = await confirmDestructive({ title: 'Delete this receipt?', message: 'This removes it from your history. This cannot be undone.' });
    if (!ok) return;
    setReceipts(prev => prev.filter(r => r.id !== id));
    try {
      await api.delete(`/receipts/${id}`);
    } catch {
      setError('Could not delete this receipt.');
      load();
    }
  }

  // "Keep for records": file the receipt so it stops nudging to be matched.
  async function handleKeep(id) {
    setReceipts(prev => prev.map(r => (r.id === id ? { ...r, status: 'filed' } : r)));
    try {
      await api.patch(`/receipts/${id}`, { status: 'filed' });
    } catch {
      setError('Could not update this receipt.');
      load();
    }
  }

  const totalSpend = receipts.reduce((s, r) => s + toNumber(r.total_text), 0);
  const symbol = currencySymbol(receipts.find(r => r.total_text)?.total_text);

  if (!canWrite) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <PageHeader title="Receipts" />
        <SubscribePrompt size="lg" message="Subscribe to scan receipts and auto-check shopping items" />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto pb-24">
      <PageHeader
        kicker={receipts.length ? `${receipts.length} saved · ${symbol}${totalSpend.toFixed(2)}` : 'No receipts yet'}
        title="Receipts"
        actions={
          <PillBtn primary icon={<IconPlus className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan receipt'}
          </PillBtn>
        }
      />

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

      {error && (
        <div className="mb-4 p-3 bg-coral-light text-coral rounded-xl text-sm font-medium flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-coral hover:text-coral/80"><IconX className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {/* Dropzone / scan tile - click to pick, or drag a photo onto it. */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          onDragOver={(e) => { e.preventDefault(); }}
          onDragEnter={(e) => { e.preventDefault(); if (!scanning) setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (scanning) return;
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`min-h-[200px] rounded-[18px] border-[1.5px] border-dashed bg-transparent flex flex-col items-center justify-center gap-3 text-warm-grey transition-colors disabled:opacity-60 ${dragging ? 'border-plum bg-plum-light/40' : 'border-light-grey hover:border-plum/40'}`}
        >
          <div className="w-[52px] h-[52px] rounded-[14px] bg-plum-light text-plum flex items-center justify-center">
            <IconReceipt className="h-6 w-6" />
          </div>
          <div className="text-sm font-semibold text-charcoal">{scanning ? 'Scanning…' : 'Drop a photo or scan'}</div>
          <div className="text-xs">AI extracts items &amp; totals</div>
        </button>

        {loading
          ? [1, 2].map(i => <div key={i} className="min-h-[200px] rounded-[18px] animate-pulse" style={{ background: SOFT }} />)
          : receipts.map(r => (
            <ReceiptCard
              key={r.id}
              r={r}
              symbol={symbol}
              onView={() => setOpenId(r.id)}
              onKeep={() => handleKeep(r.id)}
              onDelete={() => handleDeleteReceipt(r.id)}
            />
          ))}
      </div>

      {scanning && <div className="mt-5"><ScanProgress /></div>}

      {openId && (
        <ReceiptDetailModal
          receiptId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* ─── Receipt Card ─── */

function ReceiptCard({ r, onView, onKeep, onDelete, symbol = '£' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const color = colorFor(r.merchant || 'Receipt');
  const filed = r.status === 'filed';
  const fullyMatched = !filed && r.item_count > 0 && r.matched_count >= r.item_count;
  const pct = r.item_count > 0 ? Math.round((r.matched_count / r.item_count) * 100) : 0;
  const remaining = Math.max(0, r.item_count - r.matched_count);
  const badge = filed
    ? { label: 'Filed', style: { background: '#ECEAF0', color: '#6B6774' } }
    : fullyMatched
      ? { label: 'Matched', style: { background: 'var(--color-sage-light)', color: '#3F6E3D' } }
      : { label: 'Review', style: { background: '#FBF1DE', color: '#85622A' } };

  return (
    <div className="bg-white rounded-[18px] border border-light-grey p-5 flex flex-col gap-4" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-lg font-bold" style={{ background: color + '22', color }}>
            {(r.merchant || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-charcoal truncate">{r.merchant || 'Unknown shop'}</div>
            <div className="text-xs text-warm-grey mt-0.5">{purchasedLabel(r)}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] font-bold tracking-[0.04em] px-2.5 py-1 rounded-full" style={badge.style}>
            {badge.label}
          </span>
          {/* Overflow menu: keep-for-records + delete - the card-level actions
              that previously lived only inside the detail modal. */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Receipt options"
              className="w-7 h-7 -mr-1 rounded-lg flex items-center justify-center text-warm-grey hover:text-charcoal hover:bg-cream transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-50 w-44 bg-white rounded-xl border border-light-grey py-1 overflow-hidden" style={{ boxShadow: '0 8px 24px rgba(26,22,32,0.12)' }}>
                  {!filed && !fullyMatched && (
                    <button onClick={() => { setMenuOpen(false); onKeep?.(); }} className="w-full text-left px-3.5 py-2 text-[13px] font-medium text-charcoal hover:bg-cream transition-colors">
                      Keep for records
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); onDelete?.(); }} className="w-full text-left px-3.5 py-2 text-[13px] font-medium text-coral hover:bg-coral-light transition-colors">
                    Delete receipt
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-[34px] leading-none text-charcoal" style={{ fontFamily: '"Instrument Serif", serif' }}>
        {withCurrency(r.total_text, symbol)}
      </div>

      {filed ? (
        <div className="text-xs text-warm-grey">{r.item_count} {r.item_count === 1 ? 'item' : 'items'} · kept for records</div>
      ) : (
        <div>
          <div className="flex justify-between text-xs text-warm-grey mb-1.5">
            <span>{r.matched_count} of {r.item_count} items matched</span>
            <span>{pct}%</span>
          </div>
          <div className="h-[7px] rounded-full overflow-hidden" style={{ background: SOFT }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: fullyMatched ? 'var(--color-sage)' : '#D89B3A' }} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onView} className="flex-1 py-2.5 rounded-[10px] border border-light-grey bg-white text-charcoal text-[13px] font-semibold hover:bg-cream transition-colors">
          View items
        </button>
        {!filed && !fullyMatched && (
          <button onClick={onView} className="flex-1 py-2.5 rounded-[10px] bg-plum text-white text-[13px] font-semibold hover:bg-plum/90 transition-colors">
            Match {remaining}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Detail / reconcile modal ─── */

function ReceiptDetailModal({ receiptId, onClose, onChanged }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState(null);
  const [error, setError] = useState('');

  const fetchReceipt = useCallback(async () => {
    try {
      const { data } = await api.get(`/receipts/${receiptId}`);
      setReceipt(data.receipt);
    } catch {
      setError('Could not load this receipt.');
    } finally {
      setLoading(false);
    }
  }, [receiptId]);

  useEffect(() => { fetchReceipt(); }, [fetchReceipt]);

  async function toggleItem(item) {
    setBusyItem(item.id);
    try {
      const { data } = await api.patch(`/receipts/${receiptId}/items/${item.id}`, { matched: !item.matched });
      setReceipt(data.receipt);
      onChanged?.();
    } catch {
      setError('Could not update that item.');
    } finally {
      setBusyItem(null);
    }
  }

  async function handleDelete() {
    const ok = await confirmDestructive({ title: 'Delete this receipt?', message: 'This removes it from your history. This cannot be undone.' });
    if (!ok) return;
    try {
      await api.delete(`/receipts/${receiptId}`);
      onChanged?.();
      onClose();
    } catch {
      setError('Could not delete this receipt.');
    }
  }

  const items = receipt?.items || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-charcoal truncate">{receipt?.merchant || 'Receipt'}</h3>
            <p className="text-[11px] text-warm-grey">
              {receipt ? `${receipt.matched_count} of ${receipt.item_count} matched · ${withCurrency(receipt.total_text)}` : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleDelete} aria-label="Delete receipt" className="p-2 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors">
              <IconTrash className="h-4 w-4" />
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 text-warm-grey hover:text-charcoal transition-colors">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {error && <div className="m-4 p-2.5 bg-coral-light text-coral rounded-lg text-xs font-medium">{error}</div>}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: SOFT }} />)}</div>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-warm-grey text-center">No line items were saved for this receipt.</p>
          ) : (
            <ul>
              {items.map((it, i) => (
                <li key={it.id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-light-grey)' }}>
                  <button
                    onClick={() => toggleItem(it)}
                    disabled={busyItem === it.id}
                    aria-label={it.matched ? `Mark ${it.name} unmatched` : `Mark ${it.name} matched`}
                    aria-pressed={it.matched}
                    className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center transition-colors disabled:opacity-50"
                    style={it.matched
                      ? { background: 'var(--color-sage)', border: 'none' }
                      : { background: 'transparent', border: '2px solid var(--color-light-grey)' }}
                  >
                    {it.matched && <IconCheck className="h-3.5 w-3.5 text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-charcoal truncate">{it.name}</div>
                    {it.matched && it.matched_list_item_name && (
                      <div className="text-[11px] text-sage truncate">Matched to “{it.matched_list_item_name}”</div>
                    )}
                  </div>
                  {it.price_text && <div className="text-sm text-warm-grey shrink-0 tabular-nums">{it.price_text}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-light-grey text-[11px] text-warm-grey">
          Tick a line to mark it matched. When every line is ticked the receipt shows as fully matched.
        </div>
      </div>
    </div>
  );
}

/* ─── Scan progress ─── */

const SCAN_STEPS = [
  { label: 'Uploading receipt…', delay: 0 },
  { label: 'Reading items with AI…', delay: 2000 },
  { label: 'Matching against your shopping list…', delay: 8000 },
  { label: 'Almost done…', delay: 15000 },
];

function ScanProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = SCAN_STEPS.slice(1).map((s, i) => setTimeout(() => setStep(i + 1), s.delay));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="rounded-2xl p-5 text-center space-y-3" style={{ background: SOFT }}>
      <p className="text-plum text-sm font-medium">{SCAN_STEPS[step].label}</p>
      <div className="w-full bg-white/70 rounded-full h-1.5">
        <div className="bg-plum h-1.5 rounded-full transition-all duration-1000" style={{ width: `${((step + 1) / SCAN_STEPS.length) * 100}%` }} />
      </div>
    </div>
  );
}
