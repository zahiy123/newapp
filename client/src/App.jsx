import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import ErrorBoundary from './components/ErrorBoundary';
import './i18n';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Profile from './pages/Profile';
import SportSelection from './pages/SportSelection';
import Goals from './pages/Goals';
import Dashboard from './pages/Dashboard';
import Training from './pages/Training';
import Stats from './pages/Stats';
import GameMode from './pages/GameMode';

function PrivateRoute({ children }) {
  const { user, loading, authError, refreshProfile } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading...</div>;
  if (authError) return (
    <div className="min-h-screen flex items-center justify-center" dir="rtl">
      <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-sm">
        <p className="text-red-600 font-medium mb-3">בעיית חיבור לשרת</p>
        <p className="text-gray-500 text-sm mb-4">בדוק את חיבור האינטרנט ונסה שוב</p>
        <button onClick={() => refreshProfile()} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">נסה שוב</button>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading...</div>;
  return user ? <Navigate to="/" /> : children;
}

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/sport-selection" element={<SportSelection />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/training" element={<Training />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/game" element={<GameMode />} />
            </Route>
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
