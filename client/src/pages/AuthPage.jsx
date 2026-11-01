import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/Button.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

function AuthBrand() {
  return (
    <Link className="auth-brand" to="/login" aria-label="Hema blood services">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M16 3.5C12.8 8.5 7 14.2 7 20a9 9 0 1 0 18 0c0-5.8-5.8-11.5-9-16.5Z" />
          <path d="M12.1 21.3a4.2 4.2 0 0 0 4.2 4.2" />
        </svg>
      </span>
      <span className="brand-copy">
        <strong>hema</strong>
        <span>Blood services</span>
      </span>
    </Link>
  );
}

function AuthPageFrame({ eyebrow, title, description, children, footer }) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <AuthBrand />
        <div className="auth-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
        <div className="auth-panel-footer">{footer}</div>
      </section>
      <footer className="auth-page-footer">HEMA · BLOOD SERVICES ADMINISTRATION</footer>
    </main>
  );
}

function LoginPage() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(location.state?.message || '');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const hasStaffAccess = user && ['STAFF', 'ADMIN'].some((role) => user.roles.includes(role));
    const hasDonorAccess = user?.roles.includes('DONOR');
    const hasHospitalAccess = user?.roles.includes('HOSPITAL');
    return <Navigate to={hasStaffAccess ? '/overview' : hasDonorAccess ? '/donor-dashboard' : hasHospitalAccess ? '/hospital-dashboard' : '/unauthorized'} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(email, password);
      const hasStaffAccess = ['STAFF', 'ADMIN'].some((role) => user.roles.includes(role));
      const hasDonorAccess = user.roles.includes('DONOR');
      const hasHospitalAccess = user.roles.includes('HOSPITAL');
      const defaultDestination = hasStaffAccess
        ? '/overview'
        : hasDonorAccess
          ? '/donor-dashboard'
          : hasHospitalAccess
            ? '/hospital-dashboard'
            : '/unauthorized';
      const destination = location.state?.from?.pathname
        && (hasStaffAccess
          || (hasDonorAccess && ['/my-profile', '/donor-dashboard'].includes(location.state.from.pathname))
          || (hasHospitalAccess && ['/requests', '/hospital-dashboard'].includes(location.state.from.pathname)))
        ? location.state.from.pathname
        : defaultDestination;
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageFrame
      eyebrow="SECURE STAFF ACCESS"
      title="Sign in"
      description="Use your approved blood services account to continue."
      footer={<>Need an account? <Link to="/register">Create a donor account</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <ErrorMessage title="Sign in was not successful">{error}</ErrorMessage>}
        <FormField
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in securely'}
        </Button>
        {submitting && <LoadingIndicator label="Signing in" />}
      </form>
    </AuthPageFrame>
  );
}

function RegistrationPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/unauthorized" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register({ displayName, email, password });
      navigate('/login', { replace: true, state: { message: 'Donor account created. Sign in to continue.' } });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageFrame
      eyebrow="DONOR ACCOUNT"
      title="Create an account"
      description="Public sign-up creates a basic donor account only."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <ErrorMessage title="Account was not created">{error}</ErrorMessage>}
        <FormField
          label="Full name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          minLength={1}
          maxLength={120}
          required
        />
        <FormField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          required
        />
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          help="Use at least 12 characters. Passwords are never stored in plain text."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={12}
          maxLength={72}
          required
        />
        <Button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create donor account'}
        </Button>
        {submitting && <LoadingIndicator label="Creating account" />}
      </form>
    </AuthPageFrame>
  );
}

function UnauthorizedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  async function handleLogout() {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  return (
    <AuthPageFrame
      eyebrow="ACCESS RESTRICTED"
      title="Staff access required"
      description={`The signed-in account${user?.email ? ` (${user.email})` : ''} does not have staff or administrator access.`}
      footer="Sign out, then sign in with an approved staff account."
    >
      {error && <ErrorMessage title="Could not sign out">{error}</ErrorMessage>}
      <Button className="auth-submit" onClick={handleLogout}>Sign out</Button>
    </AuthPageFrame>
  );
}

export { LoginPage, RegistrationPage, UnauthorizedPage };
