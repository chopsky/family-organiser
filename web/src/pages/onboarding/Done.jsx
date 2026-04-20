/**
 * Final step — celebrates completion and hands control back to the wizard
 * shell. The shell's `next` prop is wired to its `finish` function on the
 * last step, which POSTs to /api/auth/mark-onboarded and navigates to the
 * dashboard. This component just renders the confirmation screen.
 */

import { serifHeading, serifHeadingStyle, kicker, primaryBtn } from './_styles';

export default function Done({ user, household, next, finishing }) {
  const firstName = user?.name?.split(' ')[0] || 'there';
  return (
    <div className="text-center">
      <div
        className="mx-auto mb-8 flex items-center justify-center"
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '20px',
          background: 'var(--color-plum-light, #F3EDFC)',
          fontSize: '32px',
        }}
        aria-hidden="true"
      >
        🎉
      </div>
      <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
        All set
      </p>
      <h1 className={serifHeading} style={serifHeadingStyle}>
        You're ready, <i>{firstName}</i>.
      </h1>
      <p className="text-cocoa mt-5 max-w-md mx-auto">
        {household?.name ? <><strong>{household.name}</strong> is ready to go.</> : <>Your household is ready to go.</>}{' '}
        Add your first shopping item, task, or calendar event from the dashboard —
        everyone you invited will see it as soon as they sign in.
      </p>
      <button type="button" onClick={next} disabled={finishing} className={primaryBtn + ' mt-8'}>
        {finishing ? 'Finishing up…' : 'Go to dashboard →'}
      </button>
    </div>
  );
}
