import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
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
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? <Navigate to="/" /> : children;
}

function App() {
  return (
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
  );
}

export default App;
