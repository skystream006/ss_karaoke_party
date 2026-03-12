import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import OrganizerPage from './pages/OrganizerPage';
import GuestPage from './pages/GuestPage';
import JoinPage from './pages/JoinPage';
import SettingsPage from './pages/SettingsPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:joinCode" element={<JoinPage />} />
        <Route path="/organizer/:partyId" element={<OrganizerPage />} />
        <Route path="/guest/:partyId" element={<GuestPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
