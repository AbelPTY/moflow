import React from 'react';
import QuickActionsFab from './components/QuickActionsFab';
import QuickCaptureTask from './components/QuickCaptureTask';
import Routes from './Routes';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import UpdatePassword from './components/auth/UpdatePassword';
import BrandMark from './components/BrandMark';

function AppContent() {
  const { isAuthenticated, loading, recovery } = useAuth();

  if (recovery) {
    return <UpdatePassword />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 animate-pulse">
          <BrandMark size={30} />
        </span>
        <div className="text-foreground font-semibold text-lg mt-4">Loading MoFlow…</div>
        <p className="text-xs text-muted-foreground mt-1">Checking your secure session</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="relative min-h-screen bg-background pb-16 md:pb-0">
      <Routes />

      {/* Merged "+" speed-dial: Add Transaction + Bulk Upload in one FAB */}
      <QuickActionsFab onDataChanged={() => window.location.reload()} />

      {/* Standalone draggable voice mic (movable around the screen) */}
      <QuickCaptureTask />
    </div>
  );
}

function App() {
  return (
    <div className="App font-sans antialiased text-foreground">
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </div>
  );
}

export default App;
