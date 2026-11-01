import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Button from '../components/Button.jsx';

function RequireAuthentication({ roles }) {
  const { status, user, authError, refresh } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <main className="auth-loading">
        <LoadingIndicator label="Checking your session" />
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="auth-loading">
        <ErrorMessage title="Unable to check your session">{authError}</ErrorMessage>
        <Button variant="secondary" onClick={refresh}>Try again</Button>
      </main>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location, message: authError }} />;
  }

  if (roles && !roles.some((role) => user.roles.includes(role))) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}

export default RequireAuthentication;
