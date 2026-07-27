/**
 * Onboarding v4 screen 10 — reminders.
 *
 * The whole design of this screen is "show, then ask". iOS shows the
 * notification prompt exactly once per install and a refusal can only be
 * undone in Settings, so the two example notifications land BEFORE the OS
 * dialog fires — by the time it appears the user already knows what they are
 * agreeing to. Nothing here is a gate: skipping costs nothing and says so.
 *
 * The previews are built from what the user actually told us — their household
 * name, their first name — so they read as this family's notifications rather
 * than a generic screenshot.
 *
 * Unlike the prototype there is no simulated iOS dialog: the real OS prompt is
 * what fires. On a non-native build there is no prompt at all, and the screen
 * says so rather than pretending it turned something on.
 */
import { T, SHADOW, R } from './tokens';
import { Mark, Cta, Ghost } from './ui';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const SUB = { fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };
const EYEBROW = {
  font: '700 11.5px Inter, system-ui, sans-serif', letterSpacing: '.16em',
  textTransform: 'uppercase', color: T.purple,
};

/** One example notification, styled as the iOS banner it will become. */
function Notif({ time, title, body, delay = 0, reduced }) {
  return (
    <div
      className={reduced ? '' : 'ob-in'}
      style={{
        animationDelay: `${delay}s`,
        background: 'rgba(255,255,255,.82)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        borderRadius: R.bubble, padding: '12px 14px', boxShadow: SHADOW.card,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Mark size={26} />
        <span style={{ flex: 1, font: '700 13px Inter, system-ui, sans-serif', color: T.ink }}>{title}</span>
        <span style={{ fontSize: 11.5, color: T.ink3 }}>{time}</span>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.4, color: T.ink2, marginTop: 6 }}>{body}</div>
    </div>
  );
}

/**
 * Body and footer are separate exports because the Step frame pins the footer
 * outside the scrolling area. The permission state lives in the shell (as the
 * calendar sub-view's does), so this file stays presentational.
 */
export function RemindersBody({ d, reduced, note }) {
  const house = (d.house || '').trim() || 'your house';
  const name = (d.you || '').trim();

  return (
    <>
      <p style={EYEBROW}>Last one</p>
      <h1 style={{ ...H1, fontSize: 32, marginTop: 8 }}>
        A quiet nudge, <span style={{ color: T.purple }}>never a pile-up.</span>
      </h1>
      <p style={{ ...SUB, marginTop: 8 }}>
        Two a day at most: what’s coming up, and anything that needs you. Here’s
        exactly what they look like.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        <Notif
          reduced={reduced}
          delay={0.05}
          time="7:00"
          title={house}
          body={`Morning${name ? `, ${name}` : ''} — 3 things today. Arlo has swimming at 4, and the bins go out tonight.`}
        />
        <Notif
          reduced={reduced}
          delay={0.16}
          time="18:30"
          title={house}
          body="Tomorrow is non-uniform day. Nobody’s ticked it off yet."
        />
      </div>

      {note && (
        <p role="status" style={{ fontSize: 13, lineHeight: 1.45, color: T.ink2, marginTop: 16 }}>{note}</p>
      )}
    </>
  );
}

export function RemindersFooter({ busy, onAsk, onSkip }) {
  return (
    <>
      <Cta disabled={busy} onClick={onAsk}>
        {busy ? 'One moment…' : 'Turn nudges on'}
      </Cta>
      <Ghost onClick={onSkip}>Maybe later</Ghost>
    </>
  );
}
