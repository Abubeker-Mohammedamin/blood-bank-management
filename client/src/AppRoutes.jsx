import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.jsx';
import { useAuth } from './auth/AuthContext.jsx';
import RequireAuthentication from './auth/RequireAuthentication.jsx';
import { LoginPage, RegistrationPage, UnauthorizedPage } from './pages/AuthPage.jsx';
import DonorsPage from './pages/DonorsPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import HospitalsPage from './pages/HospitalsPage.jsx';
import DonationsPage from './pages/DonationsPage.jsx';
import LaboratoryPage from './pages/LaboratoryPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import BloodRequestsPage from './pages/BloodRequestsPage.jsx';
import DonorDashboardPage from './pages/DonorDashboardPage.jsx';
import HospitalDashboardPage from './pages/HospitalDashboardPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';

function HomeRoute() {
  const { user } = useAuth();
  const destination = user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role))
    ? '/overview'
    : user.roles.includes('HOSPITAL')
      ? '/hospital-dashboard'
      : '/donor-dashboard';
  return <Navigate to={destination} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route element={<RequireAuthentication roles={['STAFF', 'ADMIN']} />}>
        <Route path="/overview" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/donors" element={<DonorsPage />} />
        <Route path="/donations" element={<DonationsPage />} />
        <Route path="/laboratory" element={<LaboratoryPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
      </Route>
      <Route element={<RequireAuthentication roles={['ADMIN']} />}>
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/hospitals" element={<HospitalsPage />} />
      </Route>
      <Route element={<RequireAuthentication roles={['DONOR']} />}>
        <Route path="/donor-dashboard" element={<DonorDashboardPage />} />
        <Route path="/my-profile" element={<DonorsPage selfOnly />} />
      </Route>
      <Route element={<RequireAuthentication roles={['HOSPITAL']} />}>
        <Route path="/hospital-dashboard" element={<HospitalDashboardPage />} />
      </Route>
      <Route element={<RequireAuthentication roles={['STAFF', 'ADMIN', 'HOSPITAL']} />}>
        <Route path="/requests" element={<BloodRequestsPage />} />
      </Route>
      <Route element={<RequireAuthentication roles={['STAFF', 'ADMIN', 'HOSPITAL', 'DONOR']} />}>
        <Route path="/" element={<HomeRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
