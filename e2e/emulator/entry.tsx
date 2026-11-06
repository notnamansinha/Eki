import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebase';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import PassengerWorkspace from '@/components/passenger/PassengerWorkspace';
import SettingsPanel from '@/components/admin/SettingsPanel';
import FleetManagementPanel from '@/components/admin/FleetManagementPanel';
import RideHistoryPanel from '@/components/admin/RideHistoryPanel';
import FeedbackPanel from '@/components/admin/FeedbackPanel';
import RouteManagementPanel from '@/components/admin/RouteManagementPanel';
import DashboardPanel from '@/components/admin/DashboardPanel';
import AdminPage from '@/app/admin/page';
import RoleGuard from '@/components/shared/RoleGuard';
import '../../frontend/src/app/globals.css';
// passenger/layout.tsx loads the passenger theme; it applies inside .passenger-layout.
import '../../frontend/src/app/passenger/theme.css';

function Fixture() {
  const { user, loading, roleError } = useAuth();
  const [loginError, setLoginError] = useState('');
  const panel = new URLSearchParams(location.search).get('panel');
  return <>
    <aside aria-label="Emulator fixture controls" style={{ position: 'fixed', top: 0, zIndex: 3000, background: '#111827', padding: 4 }}>
      {['qa_passenger', 'qa_other', 'qa_admin'].map(uid => <button key={uid} onClick={() => {
        setLoginError(''); void signInWithEmailAndPassword(auth, `${uid}@example.invalid`, 'SyntheticOnly123!').catch(() => setLoginError('Emulator sign-in failed'));
      }}>Sign in {uid}</button>)}
      <output aria-label="Verified fixture account">{loading ? 'verifying' : user?.uid ?? 'signed out'}</output>
      {(loginError || roleError) && <p role="alert">{loginError || roleError}</p>}
    </aside>
    <div style={{ height: '100dvh', paddingTop: 45, boxSizing: 'border-box' }}>
      {panel ? <RoleGuard allowedRoles={['admin']}>
        {panel === 'admin' ? <AdminPage /> : panel === 'settings' ? <SettingsPanel /> : panel === 'fleet' ? <FleetManagementPanel /> : panel === 'history' ? <RideHistoryPanel /> : panel === 'routes' ? <RouteManagementPanel /> : panel === 'ops' ? <DashboardPanel /> : <FeedbackPanel />}
      </RoleGuard> : <div className="passenger-layout relative h-full overflow-hidden">
        {/* The fixture controls take the top 45px; fit the 100dvh workspace to the rest. */}
        <style>{'[data-passenger-workspace] { height: 100% !important; }'}</style>
        <PassengerWorkspace />
      </div>}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<AuthProvider><Fixture /></AuthProvider>);
