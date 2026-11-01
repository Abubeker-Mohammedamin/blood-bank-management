import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AppLayout from '../components/AppLayout.jsx';
import Button from '../components/Button.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import PageContainer from '../components/PageContainer.jsx';
import Panel from '../components/Panel.jsx';
import { managementRequest } from '../management/managementRequest.js';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatStatus(value) {
  return value.replaceAll('_', ' ');
}

function DonorDashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [apiState, setApiState] = useState('checking');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setData(await managementRequest('/api/portal/donor'));
      setApiState('online');
    } catch (error) {
      setLoadError(error.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function signOut() {
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  const donationColumns = [
    { key: 'donationNumber', header: 'Donation ID' },
    { key: 'collectedAt', header: 'Collected', render: (row) => formatDateTime(row.collectedAt) },
    { key: 'hospital', header: 'Collection facility', render: (row) => row.hospital?.name || '—' },
    { key: 'donationStatus', header: 'Record status', render: (row) => formatStatus(row.donationStatus) },
    { key: 'volumeMl', header: 'Volume (ml)', render: (row) => row.volumeMl ?? '—' },
  ];

  const appointmentColumns = [
    { key: 'scheduledStartAt', header: 'Appointment', render: (row) => formatDateTime(row.scheduledStartAt) },
    { key: 'hospital', header: 'Facility', render: (row) => row.hospital?.name || '—' },
    { key: 'appointmentStatus', header: 'Status', render: (row) => formatStatus(row.appointmentStatus) },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Donor dashboard' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="donor-dashboard"
        eyebrow="DONOR ACCOUNT"
        title="Your dashboard"
        description="Review your profile, donation history, appointments, and the latest staff-recorded donor review status."
        actions={<Button variant="secondary" onClick={loadDashboard} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      >
        {loadError && <ErrorMessage title="Your dashboard could not load">{loadError}</ErrorMessage>}
        {loading && !data ? (
          <LoadingIndicator label="Loading your donor dashboard" />
        ) : data && (
          <>
            {!data.profile ? (
              <Panel title="Donor profile not found" description="Create your donor profile to start using your dashboard.">
                <div className="portal-empty">
                  <p>No donor profile is currently linked to this account.</p>
                  <Button onClick={() => navigate('/my-profile')}>Create my profile</Button>
                </div>
              </Panel>
            ) : (
              <>
                <div className="portal-summary-grid">
                  <div className="portal-summary-card">
                    <span>Donor ID</span>
                    <strong>{data.profile.donorNumber}</strong>
                  </div>
                  <div className="portal-summary-card">
                    <span>Donor record status</span>
                    <strong>{formatStatus(data.profile.donorStatus)}</strong>
                  </div>
                  <div className="portal-summary-card">
                    <span>Eligibility review record</span>
                    <strong>{data.profile.eligibilityReviewedAt ? 'Recorded' : 'Not recorded'}</strong>
                  </div>
                </div>

                <Panel
                  title="Your profile"
                  description="Contact information and the staff-recorded donor status for this account."
                  action={<Button variant="quiet" onClick={() => navigate('/my-profile')}>Edit profile</Button>}
                >
                  <dl className="donor-detail-grid donor-detail-grid-standalone">
                    <div><dt>Name</dt><dd>{data.profile.user.displayName}</dd></div>
                    <div><dt>Email</dt><dd>{data.profile.user.email}</dd></div>
                    <div><dt>Phone</dt><dd>{data.profile.user.phoneE164 || 'Not provided'}</dd></div>
                    <div><dt>Date of birth</dt><dd>{formatDate(data.profile.dateOfBirth)}</dd></div>
                    <div><dt>Review recorded</dt><dd>{formatDate(data.profile.eligibilityReviewedAt)}</dd></div>
                  </dl>
                  <p className="portal-note">
                    This status and review date are recorded by staff; they are not a medical eligibility determination.
                    Screening details and consent records are not shown here.
                  </p>
                </Panel>
              </>
            )}

            <div className="workspace-grid">
              <Panel title="Donation history" description="Your recorded donations. No laboratory or screening results are included.">
                <DataTable
                  caption="Your donation history"
                  columns={donationColumns}
                  rows={data.donations}
                  emptyState="No donations have been recorded for your account."
                />
              </Panel>
              <Panel title="Appointments" description="Your scheduled and past donation appointments.">
                <DataTable
                  caption="Your donation appointments"
                  columns={appointmentColumns}
                  rows={data.appointments}
                  emptyState="No appointments have been recorded for your account."
                />
              </Panel>
            </div>
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

export default DonorDashboardPage;
