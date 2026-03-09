import { Outlet } from 'react-router-dom';
import Header from './Header';
import { useLanguage } from '../../context/LanguageContext';

export default function Layout() {
  const { isRTL } = useLanguage();

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-3 py-4 sm:px-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
