import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AppLayout from '../components/AppLayout.jsx';
import Button from '../components/Button.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
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
const componentOptions = Object.entries(componentNames).map(([value, label]) => ({ value, label }));
const bloodGroupOptions = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({ value, label: value }));
const priorityLabels = { routine: 'Routine', urgent: 'Urgent', emergency: 'Emergency' };
const pendingStatusLabels = { open: 'Open', approved: 'Approved', partially_fulfilled: 'Partially fulfilled' };

function formatStatus(status) {
  return pendingStatusLabels[status] || status.replaceAll('_', ' ');
}

function formatPriority(priority) {
  return priorityLabels[priority] || priority;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function RefreshIcon({ spinning = false }) {
  return (
    <svg className={spinning ? 'refresh-icon is-spinning' : 'refresh-icon'} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M16 8a6.1 6.1 0 0 0-10.7-2L4 7.5M4 4v3.5h3.5M4 12a6.1 6.1 0 0 0 10.7 2l1.3-1.5M16 16v-3.5h-3.5" />
    </svg>
  );
}

function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [apiState, setApiState] = useState('checking');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState(null);
  const [logoutError, setLogoutError] = useState('');

  // Client-side filters over the dashboard's pre-aggregated lists.
  const [stockFilter, setStockFilter] = useState({ component: '', bloodGroup: '' });
  const [pendingFilter, setPendingFilter] = useState({ status: '', priority: '' });
  const [expiringFilter, setExpiringFilter] = useState({ component: '', bloodGroup: '' });

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await managementRequest('/api/dashboard');
      setData(result);
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

  const filteredStock = useMemo(() => {
    const stock = data?.stock || [];
    return stock.filter((row) => (
      (!stockFilter.component || row.componentType === stockFilter.component)
      && (!stockFilter.bloodGroup || row.bloodGroup === stockFilter.bloodGroup)
    ));
  }, [data, stockFilter]);

  const filteredPending = useMemo(() => {
    const recent = data?.pendingRequests?.recent || [];
    return recent.filter((row) => (
      (!pendingFilter.status || row.requestStatus === pendingFilter.status)
      && (!pendingFilter.priority || row.priority === pendingFilter.priority)
    ));
  }, [data, pendingFilter]);

  const filteredExpiring = useMemo(() => {
    const expiring = data?.expiringUnits || [];
    return expiring.filter((row) => (
      (!expiringFilter.component || row.componentType === expiringFilter.component)
      && (!expiringFilter.bloodGroup || row.bloodGroup === expiringFilter.bloodGroup)
    ));
  }, [data, expiringFilter]);

  const generatedLabel = data?.generatedAt
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(data.generatedAt))
    : null;

  const configuration = data?.configuration || { lowStockConfigured: false, expiryWarningDays: null, releaseConfigured: false };
  const pending = data?.pendingRequests || { total: 0, byStatus: [], byPriority: [], recent: [] };

  const stockColumns = [
    { key: 'bloodGroup', header: 'Blood group' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'available', header: 'Eligible units', render: (row) => <strong>{row.available}</strong> },
    {
      key: 'view',
      header: 'Inventory',
      render: (row) => (
        <Button
          variant="quiet"
          onClick={() => navigate(`/inventory?status=available&bloodGroup=${encodeURIComponent(row.bloodGroup)}&component=${encodeURIComponent(row.componentType)}`)}
        >
          View stock
        </Button>
      ),
    },
  ];

  const pendingColumns = [
    { key: 'requestNumber', header: 'Request', render: (row) => <strong>{row.requestNumber}</strong> },
    { key: 'hospital', header: 'Hospital', render: (row) => row.hospital?.name || '—' },
    { key: 'bloodType', header: 'Blood group', render: (row) => row.bloodType?.code || '—' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'quantityRequested', header: 'Requested' },
    { key: 'allocated', header: 'Allocated', render: (row) => row._count?.allocations || 0 },
    { key: 'priority', header: 'Urgency', render: (row) => formatPriority(row.priority) },
    { key: 'requestStatus', header: 'Status', render: (row) => <span className="request-status">{formatStatus(row.requestStatus)}</span> },
    { key: 'neededBy', header: 'Needed by', render: (row) => (row.neededBy ? formatDateTime(row.neededBy) : '—') },
    {
      key: 'open',
      header: 'Details',
      render: (row) => (
        <Button variant="quiet" onClick={() => navigate(`/requests?requestId=${encodeURIComponent(row.id)}`)}>
          Open request
        </Button>
      ),
    },
  ];

  const expiringColumns = [
    { key: 'unitCode', header: 'Unit ID' },
    { key: 'bloodGroup', header: 'Blood group', render: (row) => row.bloodGroup || 'Unconfirmed' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'expiresAt', header: 'Expires', render: (row) => formatDateTime(row.expiresAt) },
    { key: 'daysUntilExpiry', header: 'Remaining', render: (row) => `${row.daysUntilExpiry} day${row.daysUntilExpiry === 1 ? '' : 's'}` },
    { key: 'storageLocation', header: 'Location', render: (row) => row.storageLocation || 'Not assigned' },
    {
      key: 'view',
      header: 'Inventory',
      render: (row) => (
        <Button variant="quiet" onClick={() => navigate(`/inventory?search=${encodeURIComponent(row.unitCode)}`)}>
          View unit
        </Button>
      ),
    },
  ];

  const donationColumns = [
    { key: 'donationNumber', header: 'Donation ID' },
    { key: 'donor', header: 'Donor', render: (row) => `${row.donor?.donorNumber || ''} · ${row.donor?.user?.displayName || ''}`.trim(' ·') },
    { key: 'hospital', header: 'Facility', render: (row) => row.hospital?.name || '—' },
    { key: 'collectedAt', header: 'Collected', render: (row) => (row.collectedAt ? formatDateTime(row.collectedAt) : '—') },
    { key: 'volumeMl', header: 'Volume (ml)', render: (row) => (row.volumeMl ?? '—') },
    { key: 'donationStatus', header: 'Status', render: (row) => row.donationStatus },
    { key: 'bloodUnits', header: 'Units', render: (row) => `${row.bloodUnits?.length || 0} unit${row.bloodUnits?.length === 1 ? '' : 's'}` },
    {
      key: 'view',
      header: 'Records',
      render: (row) => (
        <Button variant="quiet" onClick={() => navigate(`/donations?search=${encodeURIComponent(row.donationNumber)}`)}>
          View donation
        </Button>
      ),
    },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Operations', href: '/overview' }, { label: 'Staff dashboard' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="dashboard"
        eyebrow="BLOOD BANK OPERATIONS"
        title="Staff dashboard"
        description="Live stock, pending hospital requests, approaching-expiry alerts, and recent activity pulled from the blood bank records."
        actions={(
          <Button variant="secondary" onClick={() => loadDashboard()} disabled={loading}>
            <RefreshIcon spinning={loading} />
            {loading ? 'Refreshing' : 'Refresh'}
          </Button>
        )}
      >
        {loadError && <ErrorMessage title="The dashboard could not load">{loadError}</ErrorMessage>}

        {loading && !data ? (
          <LoadingIndicator label="Loading the staff dashboard" />
        ) : data && (
          <>
            {generatedLabel && (
              <p className="dashboard-meta">Last updated {generatedLabel}{configuration.expiryWarningDays ? ` · expiry alert window ${configuration.expiryWarningDays} days` : ''}.</p>
            )}

            <div className="inventory-alert-row" aria-label="Dashboard summary counts">
              <div className="inventory-alert-count">
                <strong>{data.stockTotal}</strong>
                <span>Eligible available units</span>
              </div>
              <div className="inventory-alert-count">
                <strong>{pending.total}</strong>
                <span>Pending hospital requests</span>
              </div>
              <div className="inventory-alert-count">
                <strong>{configuration.expiryWarningDays === null ? 'Off' : data.expiringUnits.length}</strong>
                <span>Approaching expiry</span>
              </div>
              <div className="inventory-alert-count">
                <strong>{data.blockedUnits.length}</strong>
                <span>Blocked from release</span>
              </div>
            </div>

            {!configuration.releaseConfigured && (
              <p className="inventory-policy-note">
                Eligible stock is zero until the organization-approved required test types are entered in
                {' '}<code>BLOOD_UNIT_REQUIRED_TEST_TYPES</code>. Quarantined, reserved, issued, expired, discarded,
                and unconfirmed units are never counted as eligible.
              </p>
            )}
            {configuration.expiryWarningDays === null && (
              <p className="inventory-policy-note">
                Approaching-expiry alerts are off until an organization-approved warning window is entered in
                {' '}<code>INVENTORY_EXPIRY_WARNING_DAYS</code>.
              </p>
            )}

            <div className="workspace-grid">
              <Panel
                title="Available stock by blood group and component"
                description="Counts release-eligible units only: available, non-expired, blood-group confirmed, and passing the configured test gate."
                action={<Button variant="quiet" onClick={() => navigate('/inventory')}>Open inventory</Button>}
              >
                <form className="inventory-filter-form" onSubmit={(event) => event.preventDefault()}>
                  <FormField
                    label="Blood group"
                    as="select"
                    value={stockFilter.bloodGroup}
                    onChange={(event) => setStockFilter((current) => ({ ...current, bloodGroup: event.target.value }))}
                    options={[{ value: '', label: 'All groups' }, ...bloodGroupOptions]}
                  />
                  <FormField
                    label="Component"
                    as="select"
                    value={stockFilter.component}
                    onChange={(event) => setStockFilter((current) => ({ ...current, component: event.target.value }))}
                    options={[{ value: '', label: 'All components' }, ...componentOptions]}
                  />
                </form>
                <DataTable
                  caption="Eligible available stock by blood group and component"
                  columns={stockColumns}
                  rows={filteredStock}
                  emptyState="No eligible available stock for these filters."
                />
              </Panel>

              <Panel
                title="Pending hospital requests"
                description="Open, approved, and partially fulfilled requests awaiting staff action."
                action={<Button variant="quiet" onClick={() => navigate('/requests')}>Open requests</Button>}
              >
                <ul className="dashboard-count-chips" aria-label="Pending requests by status">
                  {pending.byStatus.map((item) => (
                    <li key={item.status} className="dashboard-count-chip">
                      <span>{formatStatus(item.status)}</span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                  {pending.byPriority.length > 0 && (
                    <li className="dashboard-count-chip dashboard-count-chip--priority">
                      <span>Emergency</span>
                      <strong>{pending.byPriority.find((item) => item.priority === 'emergency')?.count || 0}</strong>
                    </li>
                  )}
                </ul>
                <form className="inventory-filter-form" onSubmit={(event) => event.preventDefault()}>
                  <FormField
                    label="Status"
                    as="select"
                    value={pendingFilter.status}
                    onChange={(event) => setPendingFilter((current) => ({ ...current, status: event.target.value }))}
                    options={[
                      { value: '', label: 'All pending' },
                      ...Object.entries(pendingStatusLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                  <FormField
                    label="Urgency"
                    as="select"
                    value={pendingFilter.priority}
                    onChange={(event) => setPendingFilter((current) => ({ ...current, priority: event.target.value }))}
                    options={[{ value: '', label: 'All urgencies' }, { value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'emergency', label: 'Emergency' }]}
                  />
                </form>
                <DataTable
                  caption="Most recent pending hospital requests"
                  columns={pendingColumns}
                  rows={filteredPending}
                  emptyState="No pending requests for these filters."
                />
              </Panel>
            </div>

            <Panel
              title="Approaching expiration"
              description={configuration.expiryWarningDays
                ? `Units expiring within the next ${configuration.expiryWarningDays} days. Expired, discarded, and issued units are excluded.`
                : 'Configure an expiry warning window to enable these alerts.'}
              action={<Button variant="quiet" onClick={() => navigate('/inventory')}>Open inventory</Button>}
            >
              {configuration.expiryWarningDays !== null && (
                <form className="inventory-filter-form" onSubmit={(event) => event.preventDefault()}>
                  <FormField
                    label="Blood group"
                    as="select"
                    value={expiringFilter.bloodGroup}
                    onChange={(event) => setExpiringFilter((current) => ({ ...current, bloodGroup: event.target.value }))}
                    options={[{ value: '', label: 'All groups' }, ...bloodGroupOptions]}
                  />
                  <FormField
                    label="Component"
                    as="select"
                    value={expiringFilter.component}
                    onChange={(event) => setExpiringFilter((current) => ({ ...current, component: event.target.value }))}
                    options={[{ value: '', label: 'All components' }, ...componentOptions]}
                  />
                </form>
              )}
              <DataTable
                caption="Blood units approaching expiration"
                columns={expiringColumns}
                rows={filteredExpiring}
                emptyState={configuration.expiryWarningDays ? 'No units approaching expiry for these filters.' : 'Expiry warning window not configured.'}
              />
            </Panel>

            <div className="workspace-grid">
              <Panel
                title="Recent donations"
                description="The latest collections recorded at the facility."
                action={<Button variant="quiet" onClick={() => navigate('/donations')}>Open donations</Button>}
              >
                <DataTable
                  caption="Recent blood donations"
                  columns={donationColumns}
                  rows={data.recentDonations || []}
                  emptyState="No donations recorded yet."
                />
              </Panel>

              <Panel
                title="Recent activity"
                description="The latest donation collections and hospital request submissions."
              >
                <ul className="dashboard-activity">
                  {(data.activity || []).length === 0 ? (
                    <li className="dashboard-activity-empty">No recent activity to show.</li>
                  ) : data.activity.map((event) => (
                    <li key={`${event.kind}-${event.id}`} className="dashboard-activity-item">
                      <span className={`dashboard-activity-mark dashboard-activity-mark--${event.kind}`} aria-hidden="true">
                        {event.kind === 'donation' ? 'D' : 'R'}
                      </span>
                      <div className="dashboard-activity-body">
                        <strong>{event.title}</strong>
                        {event.subtitle && <span>{event.subtitle}</span>}
                      </div>
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                      <Button variant="quiet" onClick={() => navigate(event.href)}>View record</Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

export default DashboardPage;
