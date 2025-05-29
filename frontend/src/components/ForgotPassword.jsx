import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef();

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');
    setLoading(true);

    try {
      // Adjust endpoint to your backend URL structure as needed
      const response = await api.post('/accounts/auth/password-reset/request/', { email });
      // Always display success message for privacy/security
      setMessage('✅ If your email is registered, you will receive a reset link shortly.');
    } catch (err) {
      // For network errors, show an error; otherwise, always show the success message for privacy
      if (err.response && err.response.status >= 400 && err.response.status < 500) {
        setMessage('✅ If your email is registered, you will receive a reset link shortly.');
      } else {
        setError('⚠️ Network error. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-100 to-blue-300">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <h2 className="text-2xl font-bold text-blue-700 mb-6">Forgot Password</h2>

        <form className="space-y-4" onSubmit={handleReset}>
          <input
            ref={emailRef}
            type="email"
            id="emailInput"
            placeholder="Enter your registered email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            pattern="[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$"
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            aria-label="Email Input"
          />

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className={`w-full py-2 flex items-center justify-center ${
              loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            } text-white rounded-lg transition duration-300`}
            aria-label="Send Reset Link"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 mr-2 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-8 8z"></path>
              </svg>
            ) : (
              "Send Reset Link"
            )}
          </button>
        </form>

        {/* Dynamic Messages */}
        {message && (
          <div aria-live="polite" className="mt-4 text-green-600 flex items-center gap-2 transition-all duration-300">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <p>{message}</p>
          </div>
        )}

        {error && (
          <div aria-live="polite" className="mt-4 text-red-600 flex items-center gap-2 transition-all duration-300">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p>{error}</p>
          </div>
        )}

        <div className="mt-4">
          <Link to="/signin" className="text-blue-600 hover:underline">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}




