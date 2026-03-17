import { Link } from 'react-router-dom';

export default function CheckEmail() {
  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <img src="/Anora-favicon.png" alt="Anora" className="h-16 mx-auto mb-4 rounded-2xl" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          <div className="text-5xl mb-4">📧</div>
          <h1 className="text-2xl font-bold text-bark mb-3">Check your email</h1>
          <p className="text-cocoa mb-6">
            We've sent you a verification link. Click it to activate your account, then come back and log in.
          </p>
          <Link
            to="/login"
            className="inline-block bg-primary hover:bg-primary-pressed text-white font-semibold py-3 px-8 rounded-2xl transition-colors"
          >
            Go to login
          </Link>
        </div>
      </div>
    </div>
  );
}
