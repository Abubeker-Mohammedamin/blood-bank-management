import { useCallback, useEffect, useState } from 'react';
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

function utcDate(value) {
  return value.toISOString().slice(0, 10);
}

function initialRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: utcDate(start), endDate: utcDate(end) };
}

function ReportsPage() {
  const { user, logout } = useAuth();
  const [filters, setFilters] = useState(initialRange);
  const [appliedFilters, setAppliedFilters] = useState(initialRange);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [apiState, setApiState] = useState('checking');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setReports(null);
    try {
      const params = new URLSearchParams(appliedFilters);
      setReports(await managementRequest(`/api/reports?${params}`));
      setApiState('online');
    } catch (error) {
      setLoadError(error.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function exportCsv() {
    setExporting(true);
    setExportError('');
    setExportSuccess('');
    try {
      const params = new URLSearchParams(appliedFilters);
      const response = await fetch(`/api/reports/export.csv?${params}`, { credentials: 'include' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result?.error?.message || 'The report export could not be completed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'blood-bank-reports.csv';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportSuccess('The report CSV was downloaded.');
    } catch (error) {
      setExportError(error.message);
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  const applyFilters = (event) => {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  };
  const distributionColumns = [
    { key: 'bloodGroup', header: 'Blood group' },
    { key: 'componentType', header: 'Component', render: (row) => row.componentType.replaceAll('_', ' ') },
    { key: 'totalUnits', header: 'Collected units' },
    { key: 'available', header: 'Available status' },
    { key: 'releaseEligibleAvailable', header: 'Release eligible' },
    { key: 'quarantined', header: 'Quarantined' },
    { key: 'reserved', header: 'Reserved' },
    { key: 'issued', header: 'Issued' },
    { key: 'expired', header: 'Expired status' },
    { key: 'discarded', header: 'Discarded' },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Operations', href: '/overview' }, { label: 'Reports' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="reports"
        eyebrow="OPERATIONS"
        title="Reports"
        description="Aggregate operational trends for your authorized facilities. Reports exclude donor identifiers, personal data, and laboratory results."
        actions={<Button variant="secondary" onClick={exportCsv} disabled={exporting || loading}>{exporting ? 'Preparing CSV…' : 'Export CSV'}</Button>}
      >
        {(loadError || exportError) && (
          <ErrorMessage title={exportError ? 'Report export failed' : 'Reports could not load'}>
            {exportError || loadError}
          </ErrorMessage>
        )}
        {exportSuccess && <p className="workflow-success" role="status">{exportSuccess}</p>}
        <Panel title="Date range" description="Select a UTC date range of up to 366 days.">
          <form className="inventory-filter-form" onSubmit={applyFilters}>
            <FormField label="Start date (UTC)" type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} required />
            <FormField label="End date (UTC)" type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} required />
            <Button type="submit" variant="secondary" disabled={loading}>Apply dates</Button>
          </form>
        </Panel>

        {loading ? (
          <LoadingIndicator label="Loading operational reports" />
        ) : reports && (
          <>
            <p className="portal-note">Showing {reports.range.startDate} through {reports.range.endDate}, inclusive. Calculations are based on recorded dates and current unit/request statuses as defined below.</p>
            <div className="workspace-grid">
              <Panel title="Donation trends" description={reports.definitions.donationTrends}>
                <DataTable
                  caption="Donation volume and counts by date"
                  columns={[
                    { key: 'date', header: 'Collection date' },
                    { key: 'donations', header: 'Donations' },
                    { key: 'volumeMl', header: 'Recorded volume (ml)' },
                  ]}
                  rows={reports.donationTrends}
                  emptyState="No donations were recorded in this date range."
                />
              </Panel>
              <Panel title="Request fulfillment" description={reports.definitions.requestFulfillment}>
                <dl className="donor-detail-grid">
                  <div><dt>Requests submitted</dt><dd>{reports.requestFulfillment.submittedRequests}</dd></div>
                  <div><dt>Currently fulfilled</dt><dd>{reports.requestFulfillment.fulfilledRequests}</dd></div>
                  <div><dt>Fulfillment rate</dt><dd>{reports.requestFulfillment.fulfillmentRatePercent}%</dd></div>
                  <div><dt>Dispatches in period</dt><dd>{reports.requestFulfillment.dispatchesInPeriod}</dd></div>
                </dl>
                <DataTable
                  caption="Current request statuses for requests submitted in the selected period"
                  columns={[{ key: 'status', header: 'Current status' }, { key: 'count', header: 'Requests' }]}
                  rows={reports.requestFulfillment.currentStatusCounts}
                  emptyState="No requests were submitted in this date range."
                />
              </Panel>
            </div>

            <Panel title="Blood-group and component distribution" description={reports.definitions.bloodGroupComponentDistribution}>
              <DataTable
                caption="Blood-unit counts by blood group, component, and current status"
                columns={distributionColumns}
                rows={reports.bloodGroupComponentDistribution}
                emptyState="No blood units were collected in this date range."
              />
            </Panel>

            <div className="workspace-grid">
              <Panel title="Inventory turnover" description={reports.definitions.inventoryTurnover}>
                <dl className="donor-detail-grid">
                  <div><dt>Units dispatched in period</dt><dd>{reports.inventoryTurnover.dispatchedUnits}</dd></div>
                  <div><dt>Eligible available units now</dt><dd>{reports.inventoryTurnover.eligibleAvailableUnits}</dd></div>
                  <div><dt>Turnover proxy</dt><dd>{reports.inventoryTurnover.turnoverRatio}</dd></div>
                </dl>
              </Panel>
              <Panel title="Expired or rejected units" description={reports.definitions.expiredOrRejectedUnits}>
                <dl className="donor-detail-grid">
                  <div><dt>Expired</dt><dd>{reports.expiredOrRejectedUnits.expiredUnits}</dd></div>
                  <div><dt>Rejected review</dt><dd>{reports.expiredOrRejectedUnits.rejectedUnits}</dd></div>
                </dl>
              </Panel>
            </div>

            <Panel title="Operational activity" description={reports.definitions.operationalActivity}>
              <DataTable
                caption="Aggregate operational activity by date and event"
                columns={[
                  { key: 'date', header: 'Date (UTC)' },
                  { key: 'type', header: 'Activity', render: (row) => row.type.replaceAll('_', ' ') },
                  { key: 'count', header: 'Events' },
                ]}
                rows={reports.operationalActivity}
                emptyState="No operational activity was recorded in this date range."
              />
            </Panel>
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

export default ReportsPage;
