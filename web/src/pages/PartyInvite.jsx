/**
 * /p/:token - the public party-invite page. This is the invitee side of the
 * organic-growth loop: a host shares one link into a class group chat, and a
 * family RSVPs here with NO account - name, yes/no, headcounts, dietary
 * notes. The address is revealed only after an RSVP, and the Housemait pitch
 * sits AFTER the value, on the confirmation screen (never as a gate).
 *
 * Deliberately noindex: these are private family gatherings, not content.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';

// Inline Lucide paths - the app's convention (no icon package installed).
function Icon({ size = 16, color = 'currentColor', strokeWidth = 1.5, style, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={style} aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const CalendarDays = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Icon>;
const Clock = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>;
const MapPin = (p) => <Icon {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></Icon>;
const Minus = (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Plus = (p) => <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Check = (p) => <Icon {...p}><polyline points="20 6 9 17 4 12" /></Icon>;

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

const ui = {
  label: { display: 'block', fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 13, color: '#2D2A33', marginBottom: 6 },
  input: {
    width: '100%', height: 48, padding: '0 14px', borderRadius: 10,
    border: '1.5px solid #E8E5EC', background: '#FBF8F3',
    fontFamily: 'var(--font-sans)', fontSize: 15, color: '#2D2A33', outline: 'none',
  },
  primaryBtn: {
    width: '100%', height: 48, borderRadius: 12, border: 'none', cursor: 'pointer',
    background: '#6B3FA0', color: '#FFFFFF',
    fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14,
    boxShadow: '0 6px 16px -8px rgba(107,63,160,0.45)',
  },
  secondaryBtn: {
    width: '100%', height: 48, borderRadius: 12, cursor: 'pointer',
    background: '#FFFFFF', color: '#6B3FA0', border: '1.5px solid #6B3FA0',
    fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    textDecoration: 'none',
  },
};

function formatTime(d) {
  let s = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '');
  return s.replace(':00', '');
}

function Stepper({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <span style={ui.label}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1.5px solid #E8E5EC', borderRadius: 10, background: '#FBF8F3', height: 48 }}>
        <button
          type="button" aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          style={{ width: 44, height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#6B6774', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Minus size={16} strokeWidth={2} />
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 16, color: '#2D2A33' }}>{value}</span>
        <button
          type="button" aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(20, value + 1))}
          style={{ width: 44, height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#6B6774', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export default function PartyInvite() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | invite | done | expired | invalid | error
  const [invite, setInvite] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [status, setStatus] = useState('yes');
  const [kids, setKids] = useState(1);
  const [adults, setAdults] = useState(1);
  const [dietary, setDietary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null); // { status, location }
  const firedRef = useRef(false);

  // Private gathering pages must never be indexed. Idempotent: reuse an
  // existing robots meta if one is present, restore its old value on leave.
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    const prev = meta?.getAttribute('content') ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');
    return () => {
      if (prev === null) meta.remove();
      else meta.setAttribute('content', prev);
    };
  }, []);

  useEffect(() => {
    if (firedRef.current) return; // StrictMode double-mount guard
    firedRef.current = true;
    (async () => {
      try {
        const { data } = await api.get(`/rsvp/${token}`);
        setInvite(data);
        setPhase('invite');
        // A returning family sees their previous answers pre-filled.
        try {
          const saved = JSON.parse(localStorage.getItem(`rsvp:${token}`) || 'null');
          if (saved) {
            setFamilyName(saved.familyName || '');
            setStatus(saved.status || 'yes');
            setKids(saved.kids ?? 1);
            setAdults(saved.adults ?? 1);
            setDietary(saved.dietary || '');
          }
        } catch { /* prefill is garnish */ }
      } catch (err) {
        if (err.response?.status === 410) setPhase('expired');
        else if (err.response?.status === 404) setPhase('invalid');
        else setPhase('error');
      }
    })();
  }, [token]);

  const when = useMemo(() => {
    if (!invite?.event) return null;
    const start = new Date(invite.event.start_time);
    const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(start);
    if (invite.event.all_day) return { date, time: null };
    const end = invite.event.end_time ? new Date(invite.event.end_time) : null;
    const time = end && end.getTime() !== start.getTime()
      ? `${formatTime(start)} – ${formatTime(end)}`
      : formatTime(start);
    return { date, time };
  }, [invite]);

  async function submit(e) {
    e.preventDefault();
    if (!familyName.trim()) { setSubmitError('Please tell the host your family name.'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const { data } = await api.post(`/rsvp/${token}`, {
        familyName: familyName.trim(),
        status,
        kidsCount: status === 'yes' ? kids : 0,
        adultsCount: status === 'yes' ? adults : 0,
        dietaryNotes: status === 'yes' ? dietary : '',
      });
      setResult(data);
      setPhase('done');
      try {
        localStorage.setItem(`rsvp:${token}`, JSON.stringify({ familyName: familyName.trim(), status, kids, adults, dietary }));
      } catch { /* best-effort */ }
    } catch (err) {
      if (err.response?.status === 410) setPhase('expired');
      else setSubmitError(err.response?.data?.error || 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const hostLine = invite?.hostFirstName ? `${invite.hostFirstName}'s family is hosting` : null;

  return (
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 760, height: 760, borderRadius: '50%', left: -180, bottom: -300, background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)', filter: 'blur(20px)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 600, height: 600, borderRadius: '50%', right: -160, top: -200, background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)', filter: 'blur(20px)' }} />

      <div className="relative w-full max-w-[440px]">
        <div
          style={{
            background: 'rgba(255,253,250,0.86)',
            backdropFilter: 'blur(18px) saturate(140%)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: 24,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            padding: '36px 32px 30px',
          }}
        >
          {phase === 'loading' && (
            <p className="text-center" style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#6B6774', margin: '24px 0' }}>
              Opening your invite…
            </p>
          )}

          {(phase === 'invalid' || phase === 'error' || phase === 'expired') && (
            <>
              <h1 className="text-center" style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#1A1620', margin: 0 }}>
                {phase === 'expired' ? (
                  <>This invite has <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>expired.</em></>
                ) : (
                  <>This invite isn't available.</>
                )}
              </h1>
              <p className="text-center" style={{ marginTop: 14, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#4A4453', lineHeight: 1.6 }}>
                {phase === 'expired'
                  ? 'The event has been and gone. Check with the host if you think that’s not right.'
                  : phase === 'error'
                    ? 'We couldn’t load this invite just now — please try again in a minute.'
                    : 'The link may have been turned off by the host. Ask them to share a fresh one.'}
              </p>
            </>
          )}

          {phase === 'invite' && invite && (
            <>
              <p className="text-center" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E8724A', margin: '0 0 10px' }}>
                You're invited
              </p>
              <h1 className="text-center" style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#1A1620', margin: 0 }}>
                {invite.event.title}
              </h1>
              {hostLine && (
                <p className="text-center" style={{ marginTop: 8, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#6B6774' }}>{hostLine}</p>
              )}

              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 16, background: '#FBF8F3', border: '1px solid #F0EBE2' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#2D2A33' }}>
                  <CalendarDays size={16} strokeWidth={1.5} color="#6B3FA0" />
                  <span>{when?.date}</span>
                </div>
                {when?.time && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#2D2A33' }}>
                    <Clock size={16} strokeWidth={1.5} color="#6B3FA0" />
                    <span>{when.time}</span>
                  </div>
                )}
                {invite.event.hasLocation && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: 13, color: '#6B6774' }}>
                    <MapPin size={16} strokeWidth={1.5} color="#7DAE82" />
                    <span>Address shared when you RSVP</span>
                  </div>
                )}
              </div>

              <form onSubmit={submit} style={{ marginTop: 22 }}>
                <label>
                  <span style={ui.label}>Your family name</span>
                  <input
                    style={ui.input}
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    placeholder="e.g. The Smiths"
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>

                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  {[
                    { v: 'yes', label: 'We’ll be there 🎉' },
                    { v: 'no', label: 'Can’t make it' },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setStatus(opt.v)}
                      style={{
                        flex: 1, height: 48, borderRadius: 12, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14,
                        background: status === opt.v ? '#6B3FA0' : '#FFFFFF',
                        color: status === opt.v ? '#FFFFFF' : '#6B3FA0',
                        border: status === opt.v ? '1.5px solid #6B3FA0' : '1.5px solid #E8E5EC',
                        transition: 'all 200ms ease-out',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {status === 'yes' && (
                  <>
                    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                      <Stepper label="Kids coming" value={kids} onChange={setKids} />
                      <Stepper label="Adults coming" value={adults} onChange={setAdults} />
                    </div>
                    <label style={{ display: 'block', marginTop: 16 }}>
                      <span style={ui.label}>Allergies or dietary needs <span style={{ color: '#6B6774', fontWeight: 400 }}>(optional)</span></span>
                      <textarea
                        style={{ ...ui.input, height: 72, padding: '12px 14px', resize: 'none', lineHeight: 1.5 }}
                        value={dietary}
                        onChange={(e) => setDietary(e.target.value)}
                        placeholder="e.g. Alfie has a nut allergy"
                        maxLength={500}
                      />
                    </label>
                  </>
                )}

                {submitError && (
                  <p style={{ marginTop: 12, fontFamily: 'var(--font-sans)', fontSize: 13, color: '#E8724A' }}>{submitError}</p>
                )}

                <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 18, opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Sending…' : 'Send RSVP'}
                </button>
              </form>
            </>
          )}

          {phase === 'done' && invite && result && (
            <>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#EDF5EE', border: '1px solid rgba(125,174,130,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Check size={28} strokeWidth={2} color="#7DAE82" />
              </div>
              <h1 className="text-center" style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#1A1620', margin: 0 }}>
                {result.status === 'yes' ? (
                  <>See you <em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>there!</em></>
                ) : (
                  <>Thanks for letting {invite.hostFirstName ? `${invite.hostFirstName} ` : 'them '}<em style={{ fontStyle: 'italic', color: '#6B3FA0' }}>know.</em></>
                )}
              </h1>
              <p className="text-center" style={{ marginTop: 10, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#4A4453', lineHeight: 1.6 }}>
                {result.status === 'yes'
                  ? `Your RSVP for ${invite.event.title} is in.`
                  : 'Your response has been passed on to the host.'}
              </p>

              {result.status === 'yes' && result.location && (
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 14, background: '#EDF5EE', border: '1px solid rgba(125,174,130,0.3)' }}>
                  <MapPin size={16} strokeWidth={1.5} color="#7DAE82" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#2D2A33', lineHeight: 1.5 }}>{result.location}</span>
                </div>
              )}

              {result.status === 'yes' && (
                <a href={`${API_BASE}/rsvp/${token}/event.ics`} style={{ ...ui.secondaryBtn, marginTop: 14 }}>
                  <CalendarDays size={16} strokeWidth={1.5} />
                  Add to your calendar
                </a>
              )}

              <button
                type="button"
                onClick={() => setPhase('invite')}
                style={{ display: 'block', margin: '16px auto 0', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: '#6B3FA0' }}
              >
                Change your response
              </button>
            </>
          )}
        </div>

        {(phase === 'invite' || phase === 'done') && (
          <div
            style={{
              marginTop: 16,
              background: 'rgba(255,253,250,0.7)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.8)',
              borderRadius: 18,
              padding: '18px 20px',
              display: 'flex', alignItems: 'center', gap: 14,
            }}
          >
            <img src="/housemait-logomark.svg" alt="" aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: '#2D2A33' }}>
                This invite was made with Housemait
              </p>
              <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12.5, color: '#6B6774', lineHeight: 1.45 }}>
                The family organiser that keeps the calendar, lists and meals in one calm place.
              </p>
            </div>
            <Link
              to="/signup?src=rsvp"
              style={{ flexShrink: 0, padding: '10px 14px', borderRadius: 10, background: '#6B3FA0', color: '#FFFFFF', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Try it free
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
