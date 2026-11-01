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

const componentNames = {
  whole_blood: 'Whole blood',
  red_cells: 'Red cells',
  plasma: 'Plasma',
  platelets: 'Platelets',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatStatus(value) {
  return value.replaceAll('_', ' ');
}

function fulfillmentSummary(request) {
  if (!request.allocations.length) return 'No units allocated yet.';
  return request.allocations.map((allocation, index) => {
    const dispatch = allocation.dispatch;
    const history = [
      `Allocated ${formatDateTime(allocation.allocatedAt)}`,
      ...(allocation.fulfilledAt ? [`Fulfilled ${formatDateTime(allocation.fulfilledAt)}`] : []),
      ...(allocation.cancelledAt ? [`Cancelled ${formatDateTime(allocation.cancelledAt)}`] : []),
    ];
    if (!dispatch) {
      return `Unit ${index + 1}: ${formatStatus(allocation.allocationStatus)} · ${history.join(' · ')}`;
    }
    history.push(...dispatch.statusHistory.map((entry) => (
      `${formatStatus(entry.newStatus)} · ${formatDateTime(entry.changedAt)}`
    )));
    if (dispatch.statusHistory.length === 0) {
      history.push(`${formatStatus(dispatch.deliveryStatus)} · ${formatDateTime(dispatch.dispatchedAt)}`);
      if (dispatch.deliveredAt) history.push(`Delivered ${formatDateTime(dispatch.deliveredAt)}`);
    }
    if (dispatch.finalDisposition) history.push(`Final disposition: ${formatStatus(dispatch.finalDisposition)}`);
    return `Unit ${index + 1}: ${[...new Set(history)].join(' → ')}`;
  }).join('; ');
}

function HospitalDashboardPage() {
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
      setData(await managementRequest('/api/portal/hospital'));
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

  const columns = [
    { key: 'requestNumber', header: 'Request', render: (row) => <strong>{row.requestNumber}</strong> },
    { key: 'requestedAt', header: 'Submitted', render: (row) => formatDateTime(row.requestedAt) },
    { key: 'request', header: 'Requested', render: (row) => `${row.quantityRequested} · ${row.bloodType.code} ${componentNames[row.componentType] || row.componentType}` },
    { key: 'requestStatus', header: 'Current status', render: (row) => <span className="request-status">{formatStatus(row.requestStatus)}</span> },
    { key: 'history', header: 'Fulfillment history', render: (row) => <span className="portal-fulfillment">{fulfillmentSummary(row)}</span> },
    {
      key: 'details',
      header: 'Record',
      render: (row) => (
        <Button variant="quiet" onClick={() => navigate(`/requests?requestId=${encodeURIComponent(row.id)}`)}>
          Open request
        </Button>
      ),
    },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Hospital dashboard' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="hospital-dashboard"
        eyebrow="HOSPITAL SERVICES"
        title="Request dashboard"
        description="Track requests submitted by your account and review their current status and fulfillment history."
        actions={<Button variant="secondary" onClick={loadDashboard} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      >
        {loadError && <ErrorMessage title="Your request dashboard could not load">{loadError}</ErrorMessage>}
        {loading && !data ? (
          <LoadingIndicator label="Loading your hospital dashboard" />
        ) : data && (
          <>
            <div className="portal-summary-grid">
              <div className="portal-summary-card">
                <span>Your requests</span>
                <strong>{data.total}</strong>
              </div>
              {data.limited && (
                <div className="portal-summary-card">
                  <span>Showing</span>
                  <strong>Latest 50</strong>
                </div>
              )}
            </div>
            <Panel
              title="Your requests"
              description="Only requests submitted by your account at your active member hospitals are shown."
              action={<Button variant="quiet" onClick={() => navigate('/requests')}>Open requests</Button>}
            >
              <DataTable
                caption="Your hospital requests and fulfillment history"
                columns={columns}
                rows={data.requests}
                emptyState="No requests have been submitted by your account."
              />
            </Panel>
            <p className="portal-note">
              Fulfillment history shows allocation and dispatch statuses. Donor and laboratory screening details are not included.
            </p>
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

export default HospitalDashboardPage;
