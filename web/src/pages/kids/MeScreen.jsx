// Kids mode — MeScreen (stub; filled in its build phase).
import { KIDS_INK } from '../../lib/kidsTheme';

export default function MeScreen({ kid }) {
  return (
    <div style={{ padding: '52px 18px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: KIDS_INK.ink2, marginTop: 8 }}>Coming soon, {kid.name}!</div>
    </div>
  );
}
