import WhatsAppPairing from '../../../components/WhatsAppPairing';
import { Title, Em, Kicker, Lead, Ghost } from './_ui';

const GREEN = '#25A35A';

// Step 7. 1:1 WhatsApp pairing. Example "message -> result" rows make clear it
// is a private conversation with the bot, never a group chat. Mounts the
// existing WhatsAppPairing widget (auto-detects OTP vs pull-push). Linking
// advances; "Maybe later" skips.
const EXAMPLES = [
  { e: '🛒', m: '“We need milk and eggs”', r: 'adds to your shopping list' },
  { e: '📋', m: '“Remind John to book the car service”', r: 'becomes a task' },
  { e: '📅', m: '“Dentist on Tuesday for Arlo at 3pm”', r: 'lands on the calendar' },
  { e: '📸', m: 'Snap a receipt', r: 'matches items back to your list' },
];

export default function WhatsAppStep({ next, setError }) {
  return (
    <div>
      <Kicker color={GREEN}>WhatsApp</Kicker>
      <Title>Just <Em color={GREEN}>WhatsApp it.</Em></Title>
      <Lead>No more nagging each other. Message Housemait on WhatsApp instead, and it lands in the right place. It's a private 1:1 chat, never a group.</Lead>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '24px 0 24px', textAlign: 'left' }}>
        {EXAMPLES.map((x) => (
          <div key={x.m} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', borderRadius: 14, background: '#fff', border: '1px solid var(--color-cream-border)' }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: '#E7F6EC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{x.e}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-charcoal)' }}>{x.m}</div>
              <div style={{ fontSize: 13, color: 'var(--color-warm-grey)', marginTop: 1 }}>{x.r}</div>
            </div>
          </div>
        ))}
      </div>

      <WhatsAppPairing onSuccess={() => next()} onError={setError} />

      <Ghost onClick={next}>Maybe later</Ghost>
    </div>
  );
}
