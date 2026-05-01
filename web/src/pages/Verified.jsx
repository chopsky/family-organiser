import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Landed on after clicking the "Verify email" link in a welcome email.
// Deliberately renders regardless of auth state — the user may be on a
// browser where another account is already logged in (especially admins
// testing new signups), and we want them to see the confirmation before
// any route guard bounces them off to a dashboard.
export default function Verified() {
  const { token } = useAuth();
  const continueTo = token ? '/dashboard' : '/login';
  const continueLabel = token ? 'Continue to dashboard' : 'Log in';

  return (
    <div className="min-h-screen bg-oat px-4 py-8 md:py-12 flex flex-col items-center">
      <div className="my-auto w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/housemait-logomark.png" alt="Housemait" className="h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-3xl font-semibold text-bark">Email verified!</h1>
          <p className="text-cocoa mt-2">Your account is all set up and ready to use.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8 text-center">
          <Link
            to={continueTo}
            className="inline-block bg-primary hover:bg-primary-pressed text-white font-semibold py-3 px-8 rounded-2xl transition-colors"
          >
            {continueLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
