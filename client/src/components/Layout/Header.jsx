import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Link, useNavigate } from 'react-router-dom';

export default function Header() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { lang, toggleLanguage } = useLanguage();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight">
          {t('app.title')}
        </Link>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleLanguage}
            className="px-3 py-1 bg-white/20 rounded-lg text-sm hover:bg-white/30 transition"
          >
            {lang === 'he' ? 'EN' : 'עב'}
          </button>

          {user && (
            <>
              <nav className="hidden md:flex items-center gap-4 text-sm">
                <Link to="/" className="hover:text-blue-200 transition">{t('nav.home')}</Link>
                <Link to="/profile" className="hover:text-blue-200 transition">{t('nav.profile')}</Link>
                <Link to="/training" className="hover:text-blue-200 transition">{t('nav.training')}</Link>
                <Link to="/stats" className="hover:text-blue-200 transition">{t('nav.stats')}</Link>
                <Link to="/game" className="hover:text-blue-200 transition">{t('nav.game')}</Link>
              </nav>
              <button
                onClick={handleLogout}
                className="px-3 py-1 bg-red-500/80 rounded-lg text-sm hover:bg-red-500 transition"
              >
                {t('nav.logout')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {user && (
        <nav className="md:hidden flex justify-around py-2 border-t border-white/20 text-sm">
          <Link to="/" className="hover:text-blue-200">{t('nav.home')}</Link>
          <Link to="/profile" className="hover:text-blue-200">{t('nav.profile')}</Link>
          <Link to="/stats" className="hover:text-blue-200">{t('nav.stats')}</Link>
          <Link to="/game" className="hover:text-blue-200">{t('nav.game')}</Link>
        </nav>
      )}
    </header>
  );
}
