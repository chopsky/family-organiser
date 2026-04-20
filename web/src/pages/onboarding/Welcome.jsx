/**
 * Step 1 of the onboarding wizard — greets the user and sets expectations
 * for the rest of the flow ("a couple of minutes, you can skip anything").
 */

import { serifHeading, serifHeadingStyle, kicker, primaryBtn } from './_styles';

export default function Welcome({ user, household, next }) {
  const firstName = user?.name?.split(' ')[0] || 'there';
  return (
    <div className="text-center">
      <img
        src="/housemait-logomark.png"
        alt="Housemait"
        className="h-20 w-20 mx-auto mb-8 rounded-2xl shadow-sm"
      />
      <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
        {household?.name ? household.name : 'Your Household'}
      </p>
      <h1 className={serifHeading} style={serifHeadingStyle}>
        Welcome, <i>{firstName}</i>.
      </h1>
      <p className="text-cocoa mt-5 max-w-md mx-auto">
        Let's get your household set up in a couple of minutes. You can skip
        any step and come back to it later from Settings.
      </p>
      <button type="button" onClick={next} className={primaryBtn + ' mt-8'}>
        Get started →
      </button>
    </div>
  );
}
