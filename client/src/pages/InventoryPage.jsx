import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AppLayout from '../components/AppLayout.jsx';
import Button from '../components/Button.jsx';
import DataTable from '../components/DataTable.jsx';
import Dialog from '../components/Dialog.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import PageContainer from '../components/PageContainer.jsx';
import Panel from '../components/Panel.jsx';
import { managementRequest } from '../management/managementRequest.js';

const blankLocation = {
  hospitalId: '',
  code: '',
  name: '',
  locationType: 'refrigerator',
  minTemperatureC: '',
  maxTemperatureC: '',
};

const componentNames = {
  whole_blood: 'Whole blood',
  red_cells: 'Red cells',
  plasma: 'Plasma',
  platelets: 'Platelets',
};

function InventoryPage() {
  const { user, logout } = useAuth();
  const isAdministrator = user.roles.includes('ADMIN');
  const [searchParams] = useSearchParams();
  const initialFilters = {
    search: searchParams.get('search') || '',
    bloodGroup: searchParams.get('bloodGroup') || '',
    component: searchParams.get('component') || '',
    status: searchParams.get('status') || '',
  };
  const [apiState, setApiState] = useState('checking');
  const [units, setUnits] = useState([]);
  const [locations, setLocations] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [summary, setSummary] = useState({ stock: [], lowStock: [], expiringUnits: [], blockedUnits: [] });
  const [configuration, setConfiguration] = useState({
    lowStockConfigured: false,
    expiryWarningDays: null,
    releaseConfigured: false,
  });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [locationValues, setLocationValues] = useState({ ...blankLocation });
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingLocation, setSavingLocation] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoutError, setLogoutError] = useState('');

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pagination.pageSize) });
      for (const [key, value] of Object.entries(appliedFilters)) {
        if (value) params.set(key, value);
      }
      const [inventory, locationResult] = await Promise.all([
        managementRequest(`/api/blood-units?${params}`),
        managementRequest('/api/blood-units/locations?pageSize=100'),
      ]);
      setUnits(inventory.units);
      setSummary(inventory.summary);
      setConfiguration(inventory.configuration);
      setPagination(inventory.pagination);
      setLocations(locationResult.locations);
      setApiState('online');
    } catch (error) {
      setLoadError(error.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, pagination.pageSize]);

  useEffect(() => {
    Promise.all([
      managementRequest('/api/auth/me'),
      ...(isAdministrator ? [managementRequest('/api/hospitals?isActive=true&pageSize=100')] : []),
    ])
      .then(([session, hospitalResult]) => {
        if (isAdministrator) {
          setHospitals(hospitalResult.hospitals);
        } else {
          const assigned = session.user.hospitalIds || [];
          setHospitals(assigned.map((id) => ({ id, name: `Assigned facility (${id})` })));
          setLocationValues((current) => ({ ...current, hospitalId: current.hospitalId || assigned[0] || '' }));
        }
      })
      .catch((error) => setLoadError(error.message));
  }, [isAdministrator]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        setApiState('online');
      })
      .catch(() => setApiState('offline'));
  }, []);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  }

  async function assignLocation(unitId, storageLocationId) {
    setActionError('');
    setSuccess('');
    try {
      await managementRequest(`/api/blood-units/${unitId}/location`, {
        method: 'PATCH',
        body: JSON.stringify({ storageLocationId }),
      });
      setSuccess('Storage location updated and movement history recorded.');
      await loadInventory();
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function discardUnit(unit) {
    if (!window.confirm(`Discard blood unit ${unit.unitCode}? This action is recorded in its history.`)) return;
    setActionError('');
    setSuccess('');
    try {
      await managementRequest(`/api/blood-units/${unit.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ unitStatus: 'discarded' }),
      });
      setSuccess(`Unit ${unit.unitCode} marked discarded.`);
      setSelectedUnit(null);
      await loadInventory();
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function createLocation(event) {
    event.preventDefault();
    setSavingLocation(true);
    setActionError('');
    setSuccess('');
    try {
      await managementRequest('/api/blood-units/locations', {
        method: 'POST',
        body: JSON.stringify({
          ...locationValues,
          minTemperatureC: locationValues.minTemperatureC === '' ? null : Number(locationValues.minTemperatureC),
          maxTemperatureC: locationValues.maxTemperatureC === '' ? null : Number(locationValues.maxTemperatureC),
        }),
      });
      setLocationValues({ ...blankLocation, hospitalId: hospitals[0]?.id || '' });
      setSuccess('Storage location added.');
      await loadInventory();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setSavingLocation(false);
    }
  }

  async function toggleLocation(location) {
    setActionError('');
    setSuccess('');
    try {
      await managementRequest(`/api/blood-units/locations/${location.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !location.isActive }),
      });
      setSuccess(`Storage location ${location.isActive ? 'deactivated' : 'activated'}.`);
      await loadInventory();
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  const unitColumns = [
    { key: 'unitCode', header: 'Unit ID' },
    {
      key: 'bloodGroup',
      header: 'Blood group',
      render: (unit) => {
        const type = unit.donation.bloodType?.bloodType;
        return type ? `${type.aboGroup}${type.rhFactor}` : 'Unconfirmed';
      },
    },
    { key: 'componentType', header: 'Component', render: (unit) => componentNames[unit.componentType] || unit.componentType },
    { key: 'collectedAt', header: 'Collected', render: (unit) => new Date(unit.collectedAt).toLocaleDateString() },
    { key: 'expiresAt', header: 'Expires', render: (unit) => new Date(unit.expiresAt).toLocaleDateString() },
    {
      key: 'location',
      header: 'Storage location',
      render: (unit) => (
        <select
          aria-label={`Storage location for ${unit.unitCode}`}
          value={unit.currentStorageLocationId || ''}
          disabled={['issued', 'expired', 'discarded'].includes(unit.operationalStatus || unit.unitStatus)}
          onChange={(event) => assignLocation(unit.id, event.target.value)}
        >
          <option value="" disabled>Not assigned</option>
          {locations
            .filter((location) => location.isActive && location.hospitalId === unit.donation.hospitalId)
            .map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
        </select>
      ),
    },
    { key: 'operationalStatus', header: 'Status', render: (unit) => unit.operationalStatus || unit.unitStatus },
    { key: 'detail', header: 'Details', render: (unit) => <Button variant="quiet" onClick={() => setSelectedUnit(unit)}>View</Button> },
  ];

  const stockColumns = [
    { key: 'bloodGroup', header: 'Blood group' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'available', header: 'Eligible units' },
  ];
  const lowStockColumns = [
    { key: 'bloodGroup', header: 'Blood group' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'available', header: 'Available' },
    { key: 'threshold', header: 'Configured minimum' },
  ];
  const expiringColumns = [
    { key: 'unitCode', header: 'Unit ID' },
    { key: 'bloodGroup', header: 'Blood group', render: (row) => row.bloodGroup || 'Unconfirmed' },
    { key: 'componentType', header: 'Component', render: (row) => componentNames[row.componentType] || row.componentType },
    { key: 'expiresAt', header: 'Expires', render: (row) => new Date(row.expiresAt).toLocaleString() },
    { key: 'storageLocation', header: 'Location', render: (row) => row.storageLocation || 'Not assigned' },
  ];
  const blockedColumns = [
    { key: 'unitCode', header: 'Unit ID' },
    { key: 'blockers', header: 'Why it cannot be released', render: (row) => row.blockers.join(', ').replaceAll('_', ' ') },
  ];
  const locationColumns = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'locationType', header: 'Type' },
    { key: 'hospital', header: 'Facility', render: (row) => row.hospital.name },
    { key: 'units', header: 'Units', render: (row) => row._count.currentUnits },
    { key: 'status', header: 'Status', render: (row) => row.isActive ? 'Active' : 'Inactive' },
    {
      key: 'action',
      header: 'Action',
      render: (row) => <Button variant="quiet" onClick={() => toggleLocation(row)}>{row.isActive ? 'Deactivate' : 'Activate'}</Button>,
    },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Overview', href: '/overview' }, { label: 'Inventory' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="inventory"
        eyebrow="BLOOD PRODUCTS"
        title="Inventory"
        description="Track blood units, storage, release eligibility, and configured stock alerts."
      >
        {(loadError || actionError) && <ErrorMessage title="Inventory needs attention">{actionError || loadError}</ErrorMessage>}
        {success && <p className="workflow-success" role="status">{success}</p>}

        <div className="inventory-alert-row" aria-label="Inventory alert counts">
          <div className="inventory-alert-count"><strong>{summary.lowStock.length}</strong><span>Low-stock alerts</span></div>
          <div className="inventory-alert-count"><strong>{summary.expiringUnits.length}</strong><span>Approaching expiry</span></div>
          <div className="inventory-alert-count"><strong>{summary.blockedUnits.length}</strong><span>Unable to release</span></div>
          <div className="inventory-alert-count"><strong>{summary.stock.reduce((total, item) => total + item.available, 0)}</strong><span>Eligible available units</span></div>
        </div>

        {!configuration.lowStockConfigured && (
          <p className="inventory-policy-note">
            Low-stock alerts are off until organization-approved thresholds are entered in
            {' '}<code>INVENTORY_LOW_STOCK_THRESHOLDS</code>. No default stock target is assumed.
          </p>
        )}
        {configuration.expiryWarningDays === null && (
          <p className="inventory-policy-note">
            Expiry alerts are off until an organization-approved warning window is entered in
            {' '}<code>INVENTORY_EXPIRY_WARNING_DAYS</code>.
          </p>
        )}

        <Panel title="Eligible stock" description="Counts include available, released, blood-typed, non-expired units that pass the configured test gate.">
          <DataTable caption="Eligible stock by group and component" columns={stockColumns} rows={summary.stock} emptyState="No eligible available stock." />
        </Panel>

        <Panel title="Inventory alerts" description="Reserved, quarantined, expired, issued, discarded, and rejected units do not count as available stock.">
          <div className="inventory-alert-grid">
            <section aria-label="Low stock">
              <h3>Low stock</h3>
              <DataTable caption="Low stock alerts by blood group and component" columns={lowStockColumns} rows={summary.lowStock} emptyState={configuration.lowStockConfigured ? 'No low-stock alerts.' : 'Thresholds not configured.'} />
            </section>
            <section aria-label="Units approaching expiry">
              <h3>Approaching expiry {configuration.expiryWarningDays ? `(next ${configuration.expiryWarningDays} days)` : ''}</h3>
              <DataTable caption="Units approaching expiry" columns={expiringColumns} rows={summary.expiringUnits} emptyState={configuration.expiryWarningDays ? 'No units approaching expiry.' : 'Expiry warning window not configured.'} />
            </section>
          </div>
          <section className="inventory-blocked-section" aria-label="Units that cannot be released">
            <h3>Units that cannot be released</h3>
            <DataTable caption="Units blocked from release and reasons" columns={blockedColumns} rows={summary.blockedUnits} emptyState={configuration.releaseConfigured ? 'No units are currently blocked from release.' : 'Configure the approved laboratory test types to show release blockers.'} />
          </section>
        </Panel>

        <Panel title="Blood units" description="Search and filter tracked units; select a row action to inspect status and eligibility.">
          <form className="inventory-filter-form" onSubmit={applyFilters}>
            <FormField label="Search unit or donation" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
            <FormField
              label="Blood group"
              as="select"
              value={filters.bloodGroup}
              onChange={(event) => setFilters((current) => ({ ...current, bloodGroup: event.target.value }))}
              options={[
                { value: '', label: 'All groups' },
                ...['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({ value, label: value })),
              ]}
            />
            <FormField
              label="Component"
              as="select"
              value={filters.component}
              onChange={(event) => setFilters((current) => ({ ...current, component: event.target.value }))}
              options={[
                { value: '', label: 'All components' },
                ...Object.entries(componentNames).map(([value, label]) => ({ value, label })),
              ]}
            />
            <FormField
              label="Status"
              as="select"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              options={[
                { value: '', label: 'All statuses' },
                ...['quarantined', 'available', 'reserved', 'issued', 'expired', 'discarded'].map((value) => ({ value, label: value })),
              ]}
            />
            <Button type="submit" variant="secondary">Apply filters</Button>
          </form>
          {loading
            ? <LoadingIndicator label="Loading blood inventory" />
            : <DataTable caption="Searchable blood-unit inventory" columns={unitColumns} rows={units} emptyState="No units match these filters." />}
          <div className="workflow-pagination">
            <span>{pagination.totalItems} units</span>
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
            <span>Page {page} of {Math.max(1, pagination.totalPages)}</span>
            <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
        </Panel>

        <Panel title="Storage locations" description="Configure facilities and locations, then assign units using the inventory table.">
          <form className="workflow-form" onSubmit={createLocation}>
            <div className="workflow-form-grid">
              <FormField
                label="Facility"
                as="select"
                required
                value={locationValues.hospitalId}
                onChange={(event) => setLocationValues((current) => ({ ...current, hospitalId: event.target.value }))}
                options={[
                  { value: '', label: 'Select facility' },
                  ...hospitals.map((hospital) => ({ value: hospital.id, label: hospital.name })),
                ]}
              />
              <FormField label="Location code" required maxLength={40} value={locationValues.code} onChange={(event) => setLocationValues((current) => ({ ...current, code: event.target.value }))} />
              <FormField label="Location name" required maxLength={100} value={locationValues.name} onChange={(event) => setLocationValues((current) => ({ ...current, name: event.target.value }))} />
              <FormField
                label="Location type"
                as="select"
                value={locationValues.locationType}
                onChange={(event) => setLocationValues((current) => ({ ...current, locationType: event.target.value }))}
                options={[
                  { value: 'refrigerator', label: 'Refrigerator' },
                  { value: 'freezer', label: 'Freezer' },
                  { value: 'platelet_incubator', label: 'Platelet incubator' },
                  { value: 'other', label: 'Other' },
                ]}
              />
              <FormField label="Minimum temperature (°C)" type="number" step="0.1" value={locationValues.minTemperatureC} onChange={(event) => setLocationValues((current) => ({ ...current, minTemperatureC: event.target.value }))} />
              <FormField label="Maximum temperature (°C)" type="number" step="0.1" value={locationValues.maxTemperatureC} onChange={(event) => setLocationValues((current) => ({ ...current, maxTemperatureC: event.target.value }))} />
            </div>
            <div className="workflow-form-actions">
              <p className="form-help">Temperature limits are recorded from the facility's approved storage policy; the system does not invent them.</p>
              <Button type="submit" disabled={savingLocation}>{savingLocation ? 'Saving…' : 'Add storage location'}</Button>
            </div>
          </form>
          <DataTable caption="Configured storage locations" columns={locationColumns} rows={locations} emptyState="No storage locations have been configured." />
        </Panel>
      </PageContainer>

      <Dialog
        open={Boolean(selectedUnit)}
        onClose={() => setSelectedUnit(null)}
        title={selectedUnit ? `Blood unit ${selectedUnit.unitCode}` : 'Blood unit'}
        description="Traceable inventory details and current operational eligibility."
      >
        {selectedUnit && (
          <div className="inventory-detail">
            <dl className="donor-detail-grid">
              <div>
                <dt>Blood group / Rh</dt>
                <dd>
                  {selectedUnit.donation.bloodType?.bloodType
                    ? `${selectedUnit.donation.bloodType.bloodType.aboGroup}${selectedUnit.donation.bloodType.bloodType.rhFactor}`
                    : 'Not confirmed'}
                </dd>
              </div>
              <div><dt>Component</dt><dd>{componentNames[selectedUnit.componentType] || selectedUnit.componentType}</dd></div>
              <div><dt>Collection date</dt><dd>{new Date(selectedUnit.collectedAt).toLocaleString()}</dd></div>
              <div><dt>Expiration date</dt><dd>{new Date(selectedUnit.expiresAt).toLocaleString()}</dd></div>
              <div><dt>Current status</dt><dd>{selectedUnit.operationalStatus || selectedUnit.unitStatus}</dd></div>
              <div><dt>Collection facility</dt><dd>{selectedUnit.donation.hospital.name}</dd></div>
              <div><dt>Storage location</dt><dd>{selectedUnit.currentStorageLocation?.name || 'Not assigned'}</dd></div>
              <div><dt>Eligible for allocation</dt><dd>{selectedUnit.eligibleForAllocation ? 'Yes' : 'No'}</dd></div>
            </dl>
            {selectedUnit.releaseBlockers?.length > 0 && (
              <p className="inventory-policy-note">Release blockers: {selectedUnit.releaseBlockers.join(', ').replaceAll('_', ' ')}.</p>
            )}
            {['quarantined', 'available'].includes(selectedUnit.unitStatus) && (
              <div className="dialog-actions">
                <Button variant="secondary" onClick={() => discardUnit(selectedUnit)}>Discard unit</Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </AppLayout>
  );
}

export default InventoryPage;
