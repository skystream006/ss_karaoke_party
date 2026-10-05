import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import OrganizerPage from './pages/OrganizerPage';
import GuestPage from './pages/GuestPage';
import JoinPage from './pages/JoinPage';
import SettingsPage from './pages/SettingsPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import PasswordModal from './components/PasswordModal';
import packageJson from '../package.json';
import './App.css';
const { version } = packageJson;

/** Detects QR-code access (/join/:code) and auto-grants member auth. */
function QRAuthHandler() {
  const { authLevel, loading, loginWithQR } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const qrMatch = location.pathname.match(/^\/join\/([A-Z0-9]+)$/i);
    if (qrMatch && authLevel === 'none' && !loading) {
      loginWithQR();
    }
  }, [location.pathname, authLevel, loading, loginWithQR]);

  return null;
}

/** Renders children when authenticated at the required level; otherwise shows the password modal. */
function ProtectedRoute({ children, requiredLevel = 'member' }) {
  const { authLevel, loading, usernameRequired } = useAuth();

  if (loading) {
    return null; // brief pause while auto-auth resolves (e.g., QR session)
  }

  if (authLevel === 'none' || usernameRequired) {
    return <PasswordModal />;
  }

  if (requiredLevel === 'admin' && authLevel !== 'admin') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: '#0d0d1a', color: '#e0e0ff' }}>
        <span style={{ fontSize: '3rem' }}>🔒</span>
        <h2 style={{ margin: 0 }}>Admin Access Required</h2>
        <p style={{ color: '#9090b0', margin: 0 }}>You need an admin password to view this page.</p>
      </div>
    );
  }

  return children;
}

function AppRoutes() {
  const { switchUser } = useAuth();
  const navigate = useNavigate();

  const handleSwitchUser = () => {
    switchUser();
    navigate('/', { replace: true });
  };

  const switchUserButton = (
    <button type="button" className="btn btn-ghost" onClick={handleSwitchUser}>
      Switch user
    </button>
  );

  return (
    <>
      <QRAuthHandler />
      <Routes>
        <Route path="/" element={<ProtectedRoute><WelcomePage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/join" element={<ProtectedRoute><JoinPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/join/:joinCode" element={<ProtectedRoute><JoinPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/organizer/:partyId/:memberId" element={<ProtectedRoute><OrganizerPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/guest/:partyId/:memberId" element={<ProtectedRoute><GuestPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute requiredLevel="admin"><SettingsPage switchUserButton={switchUserButton} /></ProtectedRoute>} />
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

