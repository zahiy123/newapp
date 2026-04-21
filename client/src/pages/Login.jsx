import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60000; // 1 minute

export default function Login() {
  const { t } = useTranslation();
  const { login, register, resetPassword } = useAuth();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();

  const [isLogin, setIsLogin] = useState(true);
  const [showForgot, setShowForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const attemptsRef = useRef(0);
  const lockTimerRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (locked) {
      setError(isRTL ? 'נחסמת זמנית. נסה שוב בעוד דקה.' : 'Temporarily locked. Try again in 1 minute.');
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError(t('auth.errorPasswordMatch'));
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        await login(email, password);
        attemptsRef.current = 0;
      } else {
        await register(email, password);
      }
      navigate('/');
    } catch (err) {
      if (isLogin) {
        attemptsRef.current++;
        if (attemptsRef.current >= MAX_ATTEMPTS) {
          setLocked(true);
          setError(isRTL ? 'יותר מדי ניסיונות. נחסמת לדקה.' : 'Too many attempts. Locked for 1 minute.');
          lockTimerRef.current = setTimeout(() => {
            setLocked(false);
            attemptsRef.current = 0;
            setError('');
          }, LOCKOUT_MS);
        } else {
          setError(err.message);
        }
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!email) {
      setError(isRTL ? 'הזן אימייל קודם' : 'Enter your email first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(email);
      setSuccess(isRTL ? 'נשלח אימייל לאיפוס סיסמה. בדוק את תיבת הדואר.' : 'Password reset email sent. Check your inbox.');
      setShowForgot(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
          {t('app.title')}
        </h1>
        <h2 className="text-lg text-center text-gray-500 mb-6">
          {showForgot ? (isRTL ? 'איפוס סיסמה' : 'Reset Password') : isLogin ? t('auth.login') : t('auth.register')}
        </h2>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 text-green-600 p-3 rounded-lg mb-4 text-sm">
            {success}
          </div>
        )}

        {showForgot ? (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth.email')}
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? t('app.loading') : isRTL ? 'שלח אימייל איפוס' : 'Send Reset Email'}
            </button>
            <p className="text-center text-sm text-gray-500 mt-2">
              <button onClick={() => { setShowForgot(false); setError(''); setSuccess(''); }} className="text-blue-600 font-medium hover:underline">
                {isRTL ? 'חזרה להתחברות' : 'Back to Login'}
              </button>
            </p>
          </form>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('auth.email')}
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('auth.password')}
                </label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              {!isLogin && (
                <div>
                  <label htmlFor="login-confirm" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('auth.confirmPassword')}
                  </label>
                  <input
                    id="login-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || locked}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {loading ? t('app.loading') : isLogin ? t('auth.loginBtn') : t('auth.registerBtn')}
              </button>
            </form>

            {isLogin && (
              <p className="text-center text-sm text-gray-400 mt-2">
                <button onClick={() => { setShowForgot(true); setError(''); setSuccess(''); }} className="text-blue-500 hover:underline">
                  {isRTL ? 'שכחתי סיסמה' : 'Forgot Password?'}
                </button>
              </p>
            )}

            <p className="text-center text-sm text-gray-500 mt-3">
              {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}{' '}
              <button
                onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess(''); }}
                className="text-blue-600 font-medium hover:underline"
              >
                {isLogin ? t('auth.registerBtn') : t('auth.loginBtn')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
