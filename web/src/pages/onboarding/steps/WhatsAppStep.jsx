import WhatsAppPairing from '../../../components/WhatsAppPairing';
import { Title, Em, Kicker, Ghost } from './_ui';

const GREEN = '#25A35A';

// A small 1:1 chat sketch so it's clear this is a private conversation with the
// bot, never a group chat.
function Bubble({ from, children }) {
  const mine = from === 'me';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%', padding: '9px 13px', borderRadius: 16, fontSize: 13.5, lineHeight: 1.4,
        background: mine ? GREEN : '#fff', color: mine ? '#fff' : 'var(--color-charcoal)',
        border: mine ? 'none' : '1px solid var(--color-cream-border)',
        borderBottomRightRadius: mine ? 5 : 16, borderBottomLeftRadius: mine ? 16 : 5,
      }}>
        {children}
      </div>
    </div>
  );
}

// Step 7. 1:1 WhatsApp pairing. Mounts the existing WhatsAppPairing widget
// (auto-detects OTP vs pull-push). Linking advances; "Maybe later" skips.
export default function WhatsAppStep({ next, setError }) {
  return (
    <div>
      <Kicker color={GREEN}>Stay in the loop</Kicker>
      <Title>Housemait, on <Em color={GREEN}>WhatsApp.</Em></Title>
      <p style={{ fontSize: 15.5, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '14px auto 0', maxWidth: 420 }}>
        Message Housemait like you'd text a friend, to add events and lists or get your morning brief. It's a private 1:1 chat, never a group.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '22px 0 24px', padding: 16, borderRadius: 18, background: 'var(--color-sage-light, #EDF5EE)' }}>
        <Bubble from="me">Dentist for Leo next Tuesday at 4pm</Bubble>
        <Bubble from="bot">Added ✓ Dentist · Leo · Tue 16:00. Want a reminder the day before?</Bubble>
        <Bubble from="me">Yes please 🙏</Bubble>
      </div>

      <WhatsAppPairing onSuccess={() => next()} onError={setError} />

      <Ghost onClick={next}>Maybe later</Ghost>
    </div>
  );
}
