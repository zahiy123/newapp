import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { getLoginAs } from './utils/clinicApi';
import ClinicianPortal from './pages/ClinicianPortal';
import AdminPage from './pages/AdminPage';
import MyCare from './pages/MyCare';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import ErrorBoundary from './components/ErrorBoundary';
import './i18n';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import ProfileGate from './pages/ProfileGate';
import SportSelection from './pages/SportSelection';
import Goals from './pages/Goals';
import Dashboard from './pages/Dashboard';
import Training from './pages/Training';
import Stats from './pages/Stats';
import Progress from './pages/Progress';
import GameMode from './pages/GameMode';
import RehabSelection from './pages/RehabSelection';
import AnatomicScan from './pages/AnatomicScan';
import ValidationReport from './pages/ValidationReport';

function PrivateRoute({ children }) {
  const { user, loading, authError, refreshProfile, portal } = useAuth();
  const location = useLocation();
  // a clinician (by the server's answer, or the clinician login) never lands in the trainee app
  const clinicianSide = portal?.role === 'clinician' || getLoginAs() === 'clinician';
  if (user && !loading && clinicianSide && !location.pathname.startsWith('/clinician')) return <Navigate to="/clinician" />;
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
            <Route path="/clinician" element={<PrivateRoute><ClinicianPortal /></PrivateRoute>} />
            <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/care" element={<MyCare />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/profile" element={<ProfileGate />} />
              <Route path="/sport-selection" element={<SportSelection />} />
              <Route path="/rehab-selection" element={<RehabSelection />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/training" element={<Training />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/game" element={<GameMode />} />
              <Route path="/scan" element={<AnatomicScan />} />
              <Route path="/validation" element={<ValidationReport />} />
            </Route>
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
