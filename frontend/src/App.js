import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import WelcomePage from './pages/WelcomePage';
import OrganizerPage from './pages/OrganizerPage';
import GuestPage from './pages/GuestPage';
import JoinPage, { InvitationJoinPage } from './pages/JoinPage';
import SettingsPage from './pages/SettingsPage';
import AccountPage from './pages/AccountPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import PasskeyModal from './components/PasskeyModal';
import packageJson from '../package.json';
import './App.css';
const { version } = packageJson;

function ProtectedRoute({ children, requiredLevel, accountOnly = false }) {
  const { authLevel, initializing, partyId, memberId } = useAuth();
  const location = useLocation();
  if (initializing) return <div className="passkey-screen" role="status">Checking session...</div>;
  if (authLevel === 'none') return <PasskeyModal />;
  if (authLevel === 'guest') {
    const guestPath = `/guest/${partyId}/${memberId}`;
    if (accountOnly || location.pathname !== guestPath) return <Navigate to={guestPath} replace />;
  }
  if (requiredLevel === 'admin' && authLevel !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppRoutes() {
  const { logout, loading, error, authLevel } = useAuth();
  const navigate = useNavigate();

  const handleSwitchUser = async () => {
    if (await logout()) navigate('/', { replace: true });
  };

  const switchUserButton = (
    <button type="button" className="btn btn-ghost" onClick={handleSwitchUser} disabled={loading}>
      <LogOut size={17} aria-hidden="true" /> Sign out
    </button>
  );

  return (
    <>
      {authLevel !== 'none' && error && <p className="error-msg" role="alert">{error}</p>}
      <Routes>
        <Route path="/" element={<ProtectedRoute accountOnly><WelcomePage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/join" element={<ProtectedRoute accountOnly><JoinPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/join/:joinCode" element={<InvitationJoinPage />} />
        <Route path="/organizer/:partyId/:memberId" element={<ProtectedRoute accountOnly><OrganizerPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/guest/:partyId/:memberId" element={<ProtectedRoute><GuestPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/account" element={<ProtectedRoute accountOnly><AccountPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute requiredLevel="admin"><SettingsPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <div className="version-watermark">v{version}</div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

