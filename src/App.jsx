import React from 'react';
import QuickActionsFab from './components/QuickActionsFab';
import QuickCaptureTask from './components/QuickCaptureTask';
import Routes from './Routes';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import UpdatePassword from './components/auth/UpdatePassword';

function AppContent() {
  const { isAuthenticated, loading, recovery } = useAuth();

  if (recovery) {
    return <UpdatePassword />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="text-blue-600 font-semibold animate-pulse text-lg">
          Loading ConPlata...
        </div>
        <p className="text-xs text-muted-foreground mt-2">Checking Supabase Session</p>
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
