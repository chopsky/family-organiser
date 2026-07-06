// Kids mode — Note. Once a day the kid draws (finger-paint canvas) and/or
// types a little note for their grown-ups. Sending pushes to every adult's
// phone; parents react with an emoji from the Dashboard card and the
// reaction shows up HERE, on the sent state — closing that loop is the
// whole point of the feature. One note per day (the backend upserts on
// child+date), so "Start again" simply replaces today's note.
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { KIDS_INK } from '../../lib/kidsTheme';

const CRAYONS = ['#312B4B', '#E94F64', '#F5A623', '#FFD447', '#3FA65C', '#3E8EF0', '#8D5BE8', '#F06EAA'];
const ERASER = '#FFFFFF';

const todayStr = () => new Date().toLocaleDateString('en-CA');

export default function NoteScreen({ kid, theme, members }) {
  const isMobile = useIsMobile();
  const [todayNote, setTodayNote] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Switching the active kid resets the screen (render-time prop-change
  // reset, per the React docs pattern - the shell keeps us mounted).
  const [lastKidId, setLastKidId] = useState(kid.id);
  if (lastKidId !== kid.id) {
    setLastKidId(kid.id);
    setLoaded(false);
    setTodayNote(null);
  }

  // Fetch today's note, then refresh every 30s while the screen is up so a
  // parent's reaction appears without the kid doing anything. The cancelled
  // flag stops a slow response from a previous kid landing after a switch.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/kids/notes', { params: { child_id: kid.id, limit: 3 } });
        if (cancelled) return;
        setTodayNote((data.notes || []).find((n) => n.note_date === todayStr()) || null);
      } catch { /* keep whatever we have */ }
      if (!cancelled) setLoaded(true);
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [kid.id]);

  if (!loaded) return null;
  // One note per day: once today's is sent, there's no "make another" -
  // the kid sees their note and their grown-ups' reactions until tomorrow.
  const showCompose = !todayNote;

  return (
    <div style={{ padding: isMobile ? '20px 18px 0' : 0, maxWidth: isMobile ? undefined : 680 }}>
      <div style={{ fontSize: isMobile ? 30 : 34, fontWeight: 600, letterSpacing: -0.6, margin: isMobile ? '0 0 16px' : '0 0 8px' }}>
        My Note <span className="kids-wobble">💌</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: KIDS_INK.ink2, marginBottom: 18 }}>
        {showCompose ? 'Draw or write something for your grown-ups!' : 'Your note is on its way!'}
      </div>

      {showCompose
        ? <Compose kid={kid} theme={theme} onSent={setTodayNote} />
        : <SentState note={todayNote} members={members} />}
    </div>
  );
}

function Compose({ kid, theme, onSent }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawing = useRef(false);
  const [colour, setColour] = useState(CRAYONS[0]);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Size the bitmap once to the card's rendered width (device-pixel-ratio
  // scaled so lines stay crisp) and paint it white - a transparent PNG
  // turns black in lots of viewers.
  useEffect(() => {
    const canvas = canvasRef.current;
    const w = wrapRef.current.clientWidth;
    const h = Math.round(w * 0.72);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    // Keep the stroke tracking even when the finger leaves the canvas.
    // Guarded: setPointerCapture throws NotFoundError when the pointer is
    // already released, and that must not kill the drawing handler.
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch { /* keep drawing */ }
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(e);
    ctx.strokeStyle = colour;
    ctx.lineWidth = colour === ERASER ? 26 : 7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot counts too - kids tap as much as they drag.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    if (colour !== ERASER) setHasDrawn(true);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasDrawn(false);
  };

  const send = async () => {
    if (busy || (!hasDrawn && !text.trim())) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('child_id', kid.id);
      if (text.trim()) form.append('text', text.trim());
      if (hasDrawn) {
        const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'));
        form.append('image', blob, 'note.png');
      }
      const { data } = await api.post('/kids/notes', form);
      onSent(data.note);
    } catch (err) {
      // 409 = today's note is already sent (e.g. from another device).
      // Refetch so the screen flips to the sent state instead of nagging.
      if (err?.response?.status === 409) {
        try {
          const { data } = await api.get('/kids/notes', { params: { child_id: kid.id, limit: 3 } });
          const mine = (data.notes || []).find((n) => n.note_date === todayStr());
          if (mine) { onSent(mine); return; }
        } catch { /* fall through to the message */ }
        setError("You've already sent today's note! Come back tomorrow. 💌");
      } else {
        setError("Oh no, it didn't send. Try again!");
      }
      setBusy(false);
    }
  };

  const canSend = hasDrawn || !!text.trim();

  return (
    <div>
      <div ref={wrapRef} style={{ background: '#fff', borderRadius: 22, boxShadow: '0 6px 18px rgba(49,43,75,0.10)', border: '2px solid rgba(49,43,75,0.06)', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{ display: 'block', width: '100%', touchAction: 'none', cursor: 'crosshair' }}
        />
      </div>

      {/* Crayon box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {CRAYONS.map((c) => (
          <button key={c} onClick={() => setColour(c)} aria-label={`Crayon ${c}`} style={{ width: 34, height: 34, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
            border: colour === c ? '3px solid #fff' : '2px solid rgba(49,43,75,0.10)',
            boxShadow: colour === c ? `0 0 0 3px ${c}, 0 4px 10px rgba(49,43,75,0.2)` : 'none',
            transform: colour === c ? 'scale(1.12)' : 'none', transition: 'transform .15s' }} />
        ))}
        <button onClick={() => setColour(ERASER)} aria-label="Eraser" style={{ width: 34, height: 34, borderRadius: '50%', background: '#fff', cursor: 'pointer', padding: 0, fontSize: 16,
          border: colour === ERASER ? '3px solid rgba(49,43,75,0.35)' : '2px solid rgba(49,43,75,0.10)',
          transform: colour === ERASER ? 'scale(1.12)' : 'none', transition: 'transform .15s' }}>🧽</button>
        <div style={{ flex: 1 }} />
        <button onClick={clear} style={{ border: 0, background: 'rgba(255,255,255,0.8)', borderRadius: 99, padding: '8px 14px', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, color: KIDS_INK.ink2, cursor: 'pointer' }}>
          Start over
        </button>
      </div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 200))}
        placeholder="Or write a message…"
        style={{ width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 16, border: '2px solid rgba(49,43,75,0.08)', background: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 500, color: KIDS_INK.ink, outline: 'none', boxSizing: 'border-box' }}
      />

      {error && <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: '#E94F64' }}>{error}</div>}

      <button onClick={send} disabled={!canSend || busy} style={{ width: '100%', marginTop: 14, marginBottom: 20, border: 0, borderRadius: 20, padding: '16px 0', fontFamily: 'inherit', fontSize: 18, fontWeight: 600, color: '#fff', cursor: canSend ? 'pointer' : 'default',
        background: canSend ? theme.grad : 'rgba(49,43,75,0.15)', boxShadow: canSend ? '0 8px 20px rgba(49,43,75,0.18)' : 'none', opacity: busy ? 0.7 : 1 }}>
        {busy ? 'Sending…' : 'Send to my grown-ups 💌'}
      </button>
    </div>
  );
}

function SentState({ note, members }) {
  const reactions = Object.entries(note.reactions || {});
  const nameOf = (userId) => members.find((m) => m.id === userId)?.name || 'Someone';

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 22, boxShadow: '0 6px 18px rgba(49,43,75,0.10)', border: '2px solid rgba(49,43,75,0.06)', overflow: 'hidden' }}>
        {note.image_url && <img src={note.image_url} alt="My note" style={{ display: 'block', width: '100%' }} />}
        {note.text_note && (
          <div style={{ padding: '16px 18px', fontSize: 18, fontWeight: 600, color: KIDS_INK.ink, borderTop: note.image_url ? '2px solid rgba(49,43,75,0.06)' : 'none' }}>
            “{note.text_note}”
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.75)', borderRadius: 20, padding: '16px 18px' }}>
        {reactions.length === 0 ? (
          <div style={{ fontSize: 15, fontWeight: 500, color: KIDS_INK.ink2, textAlign: 'center' }}>
            Sent! 💌 Now we wait for your grown-ups to see it…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reactions.map(([userId, emoji]) => (
              <div key={userId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="kids-wobble" style={{ fontSize: 30 }}>{emoji}</span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{nameOf(userId)} loved your note!</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* One note a day - so no "make another"; just a warm nudge to come
          back tomorrow. */}
      <div style={{ marginTop: 16, marginBottom: 20, textAlign: 'center', fontSize: 15, fontWeight: 600, color: KIDS_INK.ink2 }}>
        Come back tomorrow to send another! 🌙
      </div>
    </div>
  );
}
