import { Link } from 'react-router-dom';

export default function CheckEmail() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <img src="/Curata-Symbol-white.png" alt="Curata" className="h-16 mx-auto mb-4 bg-emerald-600 rounded-2xl p-2" />
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-5xl mb-4">📧</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Check your email</h1>
          <p className="text-gray-500 mb-6">
            We've sent you a verification link. Click it to activate your account, then come back and log in.
          </p>
          <Link
            to="/login"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Go to login
          </Link>
        </div>
      </div>
    </div>
  );
}
