/**
 * Term-dates import — a stepped decision flow.
 *
 * Replaces the old sheet that listed six import options at once. Parents
 * defaulted to the first (local authority) even when their school sets its own
 * dates, which filled the family calendar with a year of wrong holidays.
 *
 * The rules that matter, in order:
 *   1. One decision per screen. Step 1 asks only where the school gets its
 *      dates; import mechanisms never share a screen with that fork.
 *   2. Route by school type, not mechanism. Parents know whether their school
 *      follows the council. They do not know what an iCal feed is.
 *   3. EVERY source lands on the same preview and nothing is written until the
 *      parent approves it there. A wrong turn costs one tap.
 *   4. The shared-dates card outranks the fork when it exists - it is
 *      school-specific, so it is right whichever type the school is.
 *
 * Manual entry is the one exception to (3): the parent just typed the dates,
 * so previewing them back would be noise.
 *
 * Styling follows the app's own modals (ActivityModal / Calendar / Tasks),
 * NOT the handoff's type spec: Recoleta 22/400 headings rather than 24/700
 * sans, and the modal radii. The handoff's COLOURS are used as-is because
 * they already are the app's - every token in it is in use elsewhere here.
 *
 * Design handoff: design_handoff_term_dates/README.md.
 */
import { useMemo, useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import api from '../lib/api';

// Matching src/components/ActivityModal.jsx so the two read as one family.
const INK = '#1A1620', INK2 = '#4A4453', INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.12)';
const BRAND = '#6C3DD9', BRAND_SOFT = '#EFE9FB', BRAND_DEEP = '#4A22A8';
const GREEN = '#3F8E52', GREEN_SOFT = '#E5F0E2';
const AMBER_SOFT = '#FBF1DE', AMBER_DEEP = '#8A5F1E';
const BLUE_SOFT = '#E2ECFA', BLUE_DEEP = '#2E5799';
const BG_SOFT = '#F3EEE5';
const SERIF = 'var(--font-serif-display)';

const input = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${LINE}`, fontSize: 14, color: INK, outline: 'none',
  background: '#fff', fontFamily: 'inherit',
};

const cta = (disabled) => ({
  width: '100%', padding: '12px 22px', borderRadius: 10, border: 0,
  cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontSize: 14,
  fontFamily: 'inherit', background: BRAND, color: '#fff',
  opacity: disabled ? 0.5 : 1,
});

const ghost = {
  width: '100%', padding: '10px', border: 0, background: 'transparent',
  cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', color: INK2,
};

/* ── icons: 1.8 stroke line glyphs, per the handoff ────────────────────── */
function Icon({ name, color, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'bank') return <svg {...p}><path d="M3 10h18M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18M12 3l9 5H3l9-5z" /></svg>;
  if (name === 'flag') return <svg {...p}><path d="M4 21V4M4 4h11l-1.5 4L15 12H4" /></svg>;
  if (name === 'globe') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></svg>;
  if (name === 'doc') return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
  if (name === 'calendar') return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
  if (name === 'pen') return <svg {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
  if (name === 'people') return <svg {...p}><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.5" /><path d="M22 20v-1.5a4 4 0 0 0-3-3.87" /></svg>;
  if (name === 'tick') return <svg {...p} strokeWidth="2.4"><path d="M4 12l5 5L20 6" /></svg>;
  return null;
}

/* ── a tappable option row ─────────────────────────────────────────────── */
function OptionRow({ icon, tintBg, tintFg, title, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
        padding: '13px 14px', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10,
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 12, background: tintBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} color={tintFg} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: INK }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: INK3, marginTop: 2, lineHeight: 1.35 }}>{sub}</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>
    </button>
  );
}

function Heading({ children }) {
  return <h2 style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: INK, lineHeight: 1.2 }}>{children}</h2>;
}
function Sub({ children }) {
  return <p style={{ margin: '0 0 16px', fontSize: 13, color: INK2, lineHeight: 1.45 }}>{children}</p>;
}

const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtRange = (a, b) => (b ? `${fmtDay(a).replace(/,? \d{4}$/, '')} – ${fmtDay(b)}` : fmtDay(a));
/**
 * Which academic year a typed term belongs to. The UK year runs Sept-Aug, so
 * a January term start belongs to the year that began the PREVIOUS September -
 * bucketing it forwards would split one school year across two headings in
 * the grouped view. South Africa runs on the calendar year and writes its
 * years with a slash, matching what the national import stores.
 */
function academicYearFor(iso, isSa) {
  const [y, m] = iso.split('-').map(Number);
  if (isSa) return `${y}/${y + 1}`;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const yearSpan = (dates) => {
  const ds = dates.map((d) => d.date).filter(Boolean).sort();
  if (!ds.length) return '';
  const f = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return `${f(ds[0])} to ${f(ds[ds.length - 1])}`;
};

export default function TermDatesSheet({ open, school, sharedDates = null, country = 'GB', onClose, onImported, onReview }) {
  const [step, setStep] = useState('fork');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [notSure, setNotSure] = useState(false);
  const [preview, setPreview] = useState(null); // { dates, source, source_label, syncs }
  const [terms, setTerms] = useState([{ name: '', start: '', end: '' }]);
  const fileRef = useRef(null);

  // NOTE: there is deliberately no reset effect here. The caller mounts this
  // only while the sheet is open, so every open starts from fresh state by
  // construction. Resetting in an effect would run after the first paint -
  // long enough to flash the previous import's preview at whoever opens it
  // next - and is the same trap that made the onboarding draft reappear.

  // South Africa has run one national calendar for every public school since
  // 2026, so there is no council to follow and no fork worth asking - the
  // first row is simply the national dates.
  const isSa = country === 'ZA';
  const council = school?.local_authority || null;
  const manualDirty = useMemo(
    () => terms.some((t) => t.name.trim() || t.start || t.end),
    [terms],
  );

  if (!open || !school) return null;

  function abandon() {
    if (step === 'manual' && manualDirty && !window.confirm('Discard the terms you have typed?')) return;
    onClose();
  }

  function back() {
    setError('');
    if (step === 'preview') { setStep('fork'); setPreview(null); return; }
    if (step === 'methods') { setStep('fork'); return; }
    setStep('methods');
  }

  /** Every source funnels through here. Nothing is saved yet. */
  async function runPreview(request) {
    setBusy(true); setError('');
    try {
      const { data } = await request();
      const dates = data.dates || [];
      if (!dates.length) {
        setError('No term dates were found there. Try one of the other methods.');
        setBusy(false);
        return;
      }
      setPreview({
        dates,
        source: data.source,
        source_label: data.source_label || '',
        syncs: !!data.syncs,
        verified_at: data.verified_at || null,
      });
      setStep('preview');
    } catch (e) {
      // The backend's messages already say what went wrong and name a next
      // step; surfacing them verbatim beats a generic apology.
      setError(e.response?.data?.error || 'That did not work. Try one of the other methods.');
    }
    setBusy(false);
  }

  const previewCouncil = () => runPreview(() => api.post(`/schools/${school.id}/import-la-dates`, { preview: true }));
  const previewSaNational = () => runPreview(() => api.post(`/schools/${school.id}/import-sa-term-dates`, { preview: true }));
  const previewShared = () => runPreview(() => api.post(`/schools/${school.id}/adopt-directory-dates`, { preview: true }));
  const previewIcal = () => runPreview(() => api.post(`/schools/${school.id}/import-ical`, { ical_url: url.trim(), preview: true }));

  /**
   * Website and PDF are the two AI-extracted sources, and they are the two
   * that get a row wrong. They hand off to the page's existing review panel -
   * which can edit and delete individual rows, and forwards the extracted
   * source text so the shared school directory can arbitrate between families
   * who imported the same school differently. A read-only five-row preview
   * here would be a downgrade, so this sheet steps aside for them.
   */
  async function handOffForReview(request, sourceType, fallbackLabel) {
    setBusy(true); setError('');
    try {
      const { data } = await request();
      const dates = data.dates || [];
      if (!dates.length) {
        setError(data.message || `No term dates were found in that ${sourceType === 'pdf' ? 'file' : 'page'}. Try another method.`);
        setBusy(false);
        return;
      }
      onReview?.({
        schoolId: school.id,
        schoolName: school.school_name,
        sourceUrl: data.source_url || fallbackLabel,
        sourceTextPreview: data.source_text_preview || '',
        sourceText: data.source_text || '',
        sourceType,
        dates: dates.map((d, i) => ({ ...d, _id: `draft-${i}` })),
      });
      onClose();
    } catch (e) {
      const timedOut = e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '');
      setError(timedOut
        ? "The school's website is taking too long to answer. Try uploading the PDF instead, or type the terms in."
        : (e.response?.data?.error || 'That did not work. Try one of the other methods.'));
      setBusy(false);
    }
  }

  function previewWebsite() {
    // Parents paste "school.com/term-dates" as often as a full address.
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    // 90s: extraction genuinely takes 30-60s, but without a ceiling a school
    // server that never answers leaves the button reading "Reading the page…"
    // forever with no way to tell that apart from progress.
    return handOffForReview(
      () => api.post(`/schools/${school.id}/import-website/preview`, { website_url: target }, { timeout: 90000 }),
      'website',
      target,
    );
  }

  function previewPdf(file) {
    const form = new FormData();
    form.append('file', file);
    return handOffForReview(
      () => api.post(`/schools/${school.id}/import-pdf/preview`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 }),
      'pdf',
      file.name,
    );
  }

  async function confirmImport() {
    setBusy(true); setError('');
    try {
      await api.post(`/schools/${school.id}/term-dates/confirm`, {
        dates: preview.dates,
        source: preview.source,
        source_label: preview.source_label,
      });
      setStep('saved');
      setTimeout(() => { onImported?.(); onClose(); }, 1500);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save those dates. Please try again.');
      setBusy(false);
    }
  }

  async function saveManual() {
    const rows = [];
    for (const t of terms) {
      if (!t.name.trim() || !t.start || !t.end) continue;
      const ay = academicYearFor(t.start, isSa);
      rows.push({ event_type: 'term_start', date: t.start, label: `${t.name.trim()} begins`, academic_year: ay });
      rows.push({ event_type: 'term_end', date: t.end, label: `${t.name.trim()} ends`, academic_year: ay });
    }
    if (!rows.length) { setError('Add at least one term with both dates.'); return; }
    setBusy(true); setError('');
    try {
      // Manual saves directly - the parent just typed these, so previewing
      // them back would be noise.
      await api.post(`/schools/${school.id}/term-dates/confirm`, { dates: rows, source: 'manual' });
      setStep('saved');
      setTimeout(() => { onImported?.(); onClose(); }, 1500);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save those terms. Please try again.');
      setBusy(false);
    }
  }

  const isIcal = step === 'ical';
  const urlOk = isIcal
    ? /^(https?|webcal):\/\//i.test(url.trim())
    : /^https?:\/\//i.test(url.trim());

  return (
    <BottomSheet open={open} onDismiss={abandon} contentClassName="bg-white">
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {/* Header: back appears from step 2 onward, × always. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 22px 12px' }}>
          {step !== 'fork' && step !== 'saved' && (
            <button type="button" onClick={back} aria-label="Back"
              style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step !== 'saved' && (
            <button type="button" onClick={abandon} aria-label="Close"
              style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: BG_SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 22px 8px' }}>
          {error && (
            <div style={{ background: '#FDF0EB', border: '1px solid rgba(232,114,74,.3)', borderRadius: 12, padding: '10px 12px', fontSize: 12.5, color: '#8A3D22', marginBottom: 14, lineHeight: 1.45 }}>
              {error}
              {/* A dead end is where parents give up. Every failure that has
                  somewhere else to go offers the door rather than leaving them
                  to work out that the back chevron is the way out. */}
              {step !== 'fork' && step !== 'methods' && (
                <button
                  type="button"
                  onClick={() => { setError(''); setUrl(''); setStep('methods'); }}
                  style={{ display: 'block', marginTop: 8, padding: 0, border: 0, background: 'transparent', color: '#8A3D22', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Try another method
                </button>
              )}
            </div>
          )}

          {/* ── STEP 1: the fork ─────────────────────────────────────── */}
          {step === 'fork' && (
            <>
              <Heading>Where does {school.school_name} get its term dates?</Heading>
              <div style={{ height: 10 }} />

              {sharedDates?.count > 0 && (
                <div style={{ background: BRAND_SOFT, borderRadius: 16, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 11, marginBottom: 12 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="people" color={BRAND_DEEP} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: BRAND_DEEP }}>A parent here already added them</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: BRAND_DEEP, opacity: 0.75, marginTop: 3, lineHeight: 1.4 }}>
                        {sharedDates.count} dates{sharedDates.year_label ? ` for ${sharedDates.year_label}` : ''}
                        {/* Only claim a check when a human made one - the
                            column is null until then, deliberately. */}
                        {sharedDates.verified_at ? `, checked ${fmtDay(sharedDates.verified_at.slice(0, 10)).replace(/,? \d{4}$/, '')}` : ''}
                        . Kept up to date for the whole school.
                      </span>
                    </span>
                  </div>
                  <button type="button" onClick={previewShared} disabled={busy} style={cta(busy)}>
                    {busy ? 'Fetching…' : 'Use these dates'}
                  </button>
                </div>
              )}

              {sharedDates?.count > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' }}>
                  <span style={{ flex: 1, height: 1, background: LINE }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK3 }}>or add them yourself</span>
                  <span style={{ flex: 1, height: 1, background: LINE }} />
                </div>
              )}

              {/* No council on file (typical for independent schools) means
                  this row would only ever 400 - so it isn't offered. */}
              {isSa ? (
                <OptionRow icon="bank" tintBg={BRAND_SOFT} tintFg={BRAND_DEEP}
                  title="Follows the national calendar"
                  sub="Every public school in South Africa uses the same term dates."
                  onClick={previewSaNational} />
              ) : council && (
                <OptionRow icon="bank" tintBg={BRAND_SOFT} tintFg={BRAND_DEEP}
                  title={`Follows ${council}`}
                  sub="Most state schools use their council's dates as they are."
                  onClick={previewCouncil} />
              )}
              <OptionRow icon="flag" tintBg={AMBER_SOFT} tintFg={AMBER_DEEP}
                title="Sets its own dates"
                sub="Independent schools, and state schools that adjust the council dates."
                onClick={() => setStep('methods')} />

              <button type="button" onClick={() => setNotSure((v) => !v)} style={{ ...ghost, marginTop: 4 }}>
                Not sure which?
              </button>
              {notSure && (
                <div style={{ background: '#FBF8F3', borderRadius: 14, padding: '12px 14px', fontSize: 12.5, color: INK2, lineHeight: 1.5 }}>
                  Fee-paying schools always set their own. For {isSa ? 'public' : 'state'} schools, check the term
                  dates page on the school website: if it simply points to{' '}
                  {isSa ? 'the national calendar' : (council || 'the council')}, choose the first. If it lists its
                  own {isSa ? 'closure days' : 'INSET days'} or different weeks, choose the second. If you pick
                  wrong, nothing is saved until you approve the dates.
                </div>
              )}
            </>
          )}

          {/* ── STEP 2: method ───────────────────────────────────────── */}
          {step === 'methods' && (
            <>
              <Heading>How do you want to add them?</Heading>
              <Sub>Whichever is easiest. You&apos;ll check the dates before anything is saved.</Sub>
              <OptionRow icon="globe" tintBg={BRAND_SOFT} tintFg={BRAND_DEEP}
                title="From the school website"
                sub="Paste a link and we'll find the dates on the page."
                onClick={() => { setUrl(''); setStep('website'); }} />
              <OptionRow icon="doc" tintBg={GREEN_SOFT} tintFg={GREEN}
                title="Upload a PDF"
                sub="The calendar the school emailed or sent home."
                onClick={() => setStep('pdf')} />
              <OptionRow icon="calendar" tintBg={BLUE_SOFT} tintFg={BLUE_DEEP}
                title="From an iCal feed"
                sub="A calendar link from the parent portal. Stays in sync."
                onClick={() => { setUrl(''); setStep('ical'); }} />
              <OptionRow icon="pen" tintBg={AMBER_SOFT} tintFg={AMBER_DEEP}
                title="Type them in"
                sub="A few minutes, term by term. No links needed."
                onClick={() => setStep('manual')} />
            </>
          )}

          {/* ── URL input (website + iCal) ───────────────────────────── */}
          {(step === 'website' || step === 'ical') && (
            <>
              <Heading>{isIcal ? 'Paste the calendar link' : 'Paste the term dates page'}</Heading>
              <Sub>
                {isIcal
                  ? 'A calendar link from the school’s parent portal. It usually ends in .ics.'
                  : `Search "${school.school_name} term dates", open the page, and copy the address.`}
              </Sub>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={isIcal ? 'https://…/calendar.ics' : 'https://…'}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{ ...input, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try { setUrl((await navigator.clipboard.readText()).trim()); } catch { /* no permission */ }
                  }}
                  style={{ padding: '10px 14px', borderRadius: 10, border: 0, background: INK, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}
                >
                  Paste
                </button>
              </div>
              {!isIcal && (
                <p style={{ margin: 0, fontSize: 12, color: INK3, lineHeight: 1.45 }}>
                  If the dates are only in a PDF on that page, go back and choose Upload a PDF instead.
                </p>
              )}
            </>
          )}

          {/* ── PDF ──────────────────────────────────────────────────── */}
          {step === 'pdf' && (
            <>
              <Heading>Upload the school&apos;s calendar</Heading>
              <Sub>A photo of the printed calendar works too.</Sub>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                style={{
                  width: '100%', padding: '28px 16px', borderRadius: 16,
                  border: `1.5px dashed ${BRAND}`, background: BRAND_SOFT,
                  cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: BRAND_DEEP }}>
                  {busy ? 'Reading…' : 'Choose a file or photo'}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: BRAND_DEEP, opacity: 0.75, marginTop: 4 }}>PDF, JPG or PNG</span>
              </button>
              <input
                ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) previewPdf(f); e.target.value = ''; }}
              />
            </>
          )}

          {/* ── Manual ───────────────────────────────────────────────── */}
          {step === 'manual' && (
            <>
              <Heading>Type in the terms</Heading>
              <Sub>Start and end of each term is enough. Half terms and INSET days can come later.</Sub>
              {terms.map((t, i) => (
                <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: 12, marginBottom: 10 }}>
                  <input
                    value={t.name}
                    onChange={(e) => setTerms((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Autumn term"
                    style={{ ...input, marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="date" value={t.start} aria-label="First day"
                      onChange={(e) => setTerms((p) => p.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                      style={{ ...input, flex: 1 }} />
                    <input type="date" value={t.end} aria-label="Last day"
                      onChange={(e) => setTerms((p) => p.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                      style={{ ...input, flex: 1 }} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setTerms((p) => [...p, { name: '', start: '', end: '' }])} style={{ ...ghost, color: BRAND }}>
                + Add this term
              </button>
            </>
          )}

          {/* ── Preview: the safety net every import passes through ──── */}
          {step === 'preview' && preview && (
            <>
              <Heading>Do these look right?</Heading>
              <Sub>
                {preview.source_label ? `${preview.source_label} · ` : ''}
                {preview.dates.length} dates, {yearSpan(preview.dates)}. Nothing is saved until you say so.
              </Sub>
              <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', marginBottom: 10 }}>
                {preview.dates.slice(0, 5).map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderBottom: i < Math.min(5, preview.dates.length) - 1 ? `1px solid ${LINE}` : 0 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: INK }}>{d.label || d.event_type}</span>
                    <span style={{ fontSize: 12.5, color: INK3, flexShrink: 0 }}>{fmtRange(d.date, d.end_date)}</span>
                  </div>
                ))}
              </div>
              {preview.dates.length > 5 && (
                <p style={{ margin: '0 0 12px', fontSize: 12, color: INK3, textAlign: 'center' }}>
                  and {preview.dates.length - 5} more
                </p>
              )}
              {/* Only for sources that genuinely re-check. Website and PDF are
                  snapshots and must never claim to stay current. */}
              {preview.syncs && (
                <div style={{ background: GREEN_SOFT, borderRadius: 14, padding: '11px 13px', fontSize: 12.5, color: GREEN, lineHeight: 1.45 }}>
                  <strong style={{ fontWeight: 600 }}>Stays in sync.</strong>{' '}
                  {preview.source === 'council'
                    ? `If ${preview.source_label || 'the council'} moves a date, your calendar updates too.`
                    : 'If the source changes a date, your calendar updates too.'}
                </div>
              )}
            </>
          )}

          {/* ── Saved ────────────────────────────────────────────────── */}
          {step === 'saved' && (
            <div style={{ textAlign: 'center', padding: '18px 0 26px' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: GREEN_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <Icon name="tick" color={GREEN} size={30} />
              </div>
              <h2 style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: INK }}>On the family calendar.</h2>
              <p style={{ margin: 0, fontSize: 13, color: INK2 }}>
                {preview?.syncs ? 'These will keep themselves up to date.' : 'Half terms and INSET days can be added any time.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Footer: pinned, hairline top border ──────────────────── */}
        {step !== 'fork' && step !== 'methods' && step !== 'saved' && (
          <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 22px', flexShrink: 0 }}>
            {step === 'preview' && (
              <>
                <button type="button" onClick={confirmImport} disabled={busy} style={cta(busy)}>
                  {busy ? 'Adding…' : `Add ${preview.dates.length} dates to the calendar`}
                </button>
                <button type="button" onClick={() => { setPreview(null); setStep('fork'); }} style={{ ...ghost, marginTop: 4 }}>
                  These don&apos;t look right
                </button>
              </>
            )}
            {(step === 'website' || step === 'ical') && (
              <button type="button" onClick={isIcal ? previewIcal : previewWebsite} disabled={!urlOk || busy} style={cta(!urlOk || busy)}>
                {busy ? 'Reading the page…' : 'Find the dates'}
              </button>
            )}
            {step === 'manual' && (
              <button type="button" onClick={saveManual} disabled={busy || !manualDirty} style={cta(busy || !manualDirty)}>
                {busy ? 'Saving…' : `Save ${terms.filter((t) => t.name.trim() && t.start && t.end).length || ''} terms`.replace('  ', ' ')}
              </button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
