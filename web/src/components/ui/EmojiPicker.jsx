// Shared searchable, categorized emoji picker used by the Tasks (chores) and
// Rewards add/edit modals. Pass a `categories` list ([{ key, label, emojis }])
// and a `searchFn(query) -> emojis`. Self-contained styling so it can drop into
// either page. Selecting the "No icon" row clears the value to ''.
import { useState, useEffect, useRef } from 'react';

const INK = '#1A1620', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)', LINE_STRONG = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BRAND_SOFT = '#EFE9FB', BG_SOFT = '#F3EEE5';
const INTER = '"Inter", system-ui, sans-serif';

const Svg = (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke={p.c || 'currentColor'} strokeWidth={p.w || 2} strokeLinecap="round" strokeLinejoin="round">{p.children}</svg>;
const IcClose = (p) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></Svg>;
const IcChevDown = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;

export default function EmojiPicker({ value, onChange, categories, searchFn }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const query = q.trim();
  const cats = query
    ? [{ key: 'results', label: 'Results', emojis: searchFn(query) }]
    : (cat === 'all' ? categories : categories.filter((c) => c.key === cat));
  const pick = (em) => { onChange(em); setOpen(false); setQ(''); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', cursor: 'pointer', fontFamily: INTER, textAlign: 'left' }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: value ? BRAND_SOFT : BG_SOFT }}>{value || <IcClose s={16} c={INK3} />}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: value ? INK : INK3 }}>{value ? 'Change icon' : 'No icon'}</span>
        <IcChevDown s={14} c={INK3} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 90, background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 16px 50px rgba(26,22,32,0.22)', padding: 12 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}><IcSearch s={15} c={INK3} /></span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, fontFamily: INTER, fontSize: 14, color: INK, outline: 'none' }} />
          </div>
          {!query && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
              {[['all', 'All'], ...categories.map((c) => [c.key, c.label])].map(([k, l]) => (
                <button key={k} onClick={() => setCat(k)} title={l} style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: INTER, fontSize: 12, fontWeight: 600, background: cat === k ? INK : BG_SOFT, color: cat === k ? '#fff' : '#4A4453', border: 0, whiteSpace: 'nowrap' }}>{l}</button>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            <button onClick={() => pick('')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', borderRadius: 9, border: 0, cursor: 'pointer', background: value === '' ? BRAND_SOFT : 'transparent', fontFamily: INTER, fontSize: 13, fontWeight: 600, color: '#4A4453', marginBottom: 4 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: BG_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IcClose s={14} c={INK3} /></span> No icon
            </button>
            {cats.map((c) => (
              <div key={c.key} style={{ marginBottom: 8 }}>
                {!query && cat === 'all' && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, padding: '4px 4px 6px' }}>{c.label}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {c.emojis.map((em, i) => (
                    <button key={em + i} onClick={() => pick(em)} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 19, cursor: 'pointer', fontFamily: INTER, background: value === em ? BRAND_SOFT : '#fff', border: value === em ? `1.5px solid ${BRAND}` : `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>
                  ))}
                </div>
              </div>
            ))}
            {query && cats[0].emojis.length === 0 && <div style={{ padding: '18px 4px', textAlign: 'center', fontSize: 13, color: INK3 }}>No icons match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
