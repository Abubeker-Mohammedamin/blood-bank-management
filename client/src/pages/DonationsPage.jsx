import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

const blankCollection = {
  donationNumber: '',
  donorId: '',
  hospitalId: '',
  collectedByStaffId: '',
  collectedAt: '',
  volumeMl: '',
  unitCode: '',
  componentType: 'whole_blood',
  expiresAt: '',
};

function localDateTime(value = new Date()) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function DonationsPage() {
  const { user, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const isAdministrator = user.roles.includes('ADMIN');
  const [apiState, setApiState] = useState('checking');
  const [records, setRecords] = useState([]);
  const [donors, setDonors] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [staff, setStaff] = useState([]);
  const [values, setValues] = useState({ ...blankCollection, collectedAt: localDateTime() });
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoutError, setLogoutError] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pagination.pageSize) });
      if (search.trim()) params.set('search', search.trim());
      const result = await managementRequest(`/api/donations?${params}`);
      setRecords(result.donations);
      setPagination(result.pagination);
      setApiState('online');
    } catch (error) {
      setLoadError(error.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, [page, pagination.pageSize, search]);

  useEffect(() => {
    Promise.all([
      managementRequest('/api/auth/me'),
      managementRequest('/api/donors?page=1&pageSize=100'),
      ...(isAdministrator
        ? [
          managementRequest('/api/hospitals?isActive=true&pageSize=100'),
          managementRequest('/api/staff?status=active&pageSize=100'),
        ]
        : []),
    ])
      .then(([session, donorResult, hospitalResult, staffResult]) => {
      setDonors(donorResult.donors);
      if (isAdministrator) {
        setHospitals(hospitalResult.hospitals);
        setStaff(staffResult.staff);
      } else {
        setHospitals((session.user.hospitalIds || []).map((id) => ({ id, name: `Assigned facility (${id})` })));
        setStaff(session.user.staffId ? [{ id: session.user.staffId, employeeNumber: 'Your staff profile' }] : []);
        setValues((current) => ({
          ...current,
          hospitalId: current.hospitalId || session.user.hospitalIds?.[0] || '',
          collectedByStaffId: current.collectedByStaffId || session.user.staffId || '',
        }));
      }
      })
      .catch((error) => setLoadError(error.message));
  }, [isAdministrator]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        setApiState('online');
      })
      .catch(() => setApiState('offline'));
  }, []);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setSaveError('');
    setSuccess('');
    try {
      await managementRequest('/api/donations', {
        method: 'POST',
        body: JSON.stringify({
          donationNumber: values.donationNumber,
          donorId: values.donorId,
          hospitalId: values.hospitalId,
          collectedByStaffId: values.collectedByStaffId,
          collectedAt: new Date(values.collectedAt).toISOString(),
          volumeMl: Number(values.volumeMl),
          units: [{
            unitCode: values.unitCode,
            componentType: values.componentType,
            expiresAt: new Date(values.expiresAt).toISOString(),
          }],
        }),
      });
      setValues({ ...blankCollection, collectedAt: localDateTime() });
      setSuccess('Donation recorded. Its blood unit remains quarantined until the configured laboratory review is complete.');
      setPage(1);
      await loadRecords();
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  const columns = [
    { key: 'donationNumber', header: 'Donation ID' },
    { key: 'donor', header: 'Donor', render: (row) => `${row.donor.donorNumber} · ${row.donor.user.displayName}` },
    { key: 'hospital', header: 'Collection facility', render: (row) => row.hospital.name },
    { key: 'collectedAt', header: 'Collected', render: (row) => new Date(row.collectedAt).toLocaleString() },
    { key: 'volumeMl', header: 'Volume (ml)' },
    {
      key: 'bloodUnits',
      header: 'Blood units',
      render: (row) => row.bloodUnits.map((unit) => `${unit.unitCode} (${unit.unitStatus})`).join(', '),
    },
  ];

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Overview', href: '/overview' }, { label: 'Donations' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="donations"
        eyebrow="COLLECTION WORKFLOW"
        title="Donations"
        description="Record a collection at its facility and link the collected unit. New units stay quarantined."
      >
        {(loadError || saveError) && (
          <ErrorMessage title="Donation workflow needs attention">{saveError || loadError}</ErrorMessage>
        )}
        {success && <p className="workflow-success" role="status">{success}</p>}

        <Panel title="Record a collection" description="Use the facility, donor, and staff records already in this system.">
          <form className="workflow-form" onSubmit={submit}>
            <div className="workflow-form-grid">
              <FormField label="Donation ID" value={values.donationNumber} onChange={(event) => update('donationNumber', event.target.value)} required maxLength={40} />
              <FormField
                label="Donor"
                as="select"
                value={values.donorId}
                onChange={(event) => update('donorId', event.target.value)}
                required
                options={[
                  { value: '', label: 'Select a donor' },
                  ...donors.map((donor) => ({ value: donor.id, label: `${donor.donorNumber} · ${donor.user.displayName}` })),
                ]}
              />
              <FormField
                label="Collection facility"
                as="select"
                value={values.hospitalId}
                onChange={(event) => update('hospitalId', event.target.value)}
                required
                options={[
                  { value: '', label: 'Select a facility' },
                  ...hospitals.map((hospital) => ({ value: hospital.id, label: hospital.name })),
                ]}
              />
              <FormField
                label="Collection staff member"
                as="select"
                value={values.collectedByStaffId}
                onChange={(event) => update('collectedByStaffId', event.target.value)}
                required
                options={[
                  { value: '', label: 'Select a staff member' },
                  ...staff
                    .filter((member) => !member.hospitalId || member.hospitalId === values.hospitalId)
                    .map((member) => ({
                      value: member.id,
                      label: member.employeeNumber || member.user?.displayName || 'Staff member',
                    })),
                ]}
              />
              <FormField label="Collection date and time" type="datetime-local" value={values.collectedAt} onChange={(event) => update('collectedAt', event.target.value)} required />
              <FormField label="Volume (ml)" type="number" min="1" max="32767" value={values.volumeMl} onChange={(event) => update('volumeMl', event.target.value)} required />
              <FormField label="Blood-unit ID" value={values.unitCode} onChange={(event) => update('unitCode', event.target.value)} required maxLength={60} />
              <FormField
                label="Component type"
                as="select"
                value={values.componentType}
                onChange={(event) => update('componentType', event.target.value)}
                options={[
                  { value: 'whole_blood', label: 'Whole blood' },
                  { value: 'red_cells', label: 'Red cells' },
                  { value: 'plasma', label: 'Plasma' },
                  { value: 'platelets', label: 'Platelets' },
                ]}
              />
              <FormField label="Expiry date and time" type="datetime-local" value={values.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} required />
            </div>
            <div className="workflow-form-actions">
              <p className="form-help">The expiry date is entered from your approved local procedure; the system does not calculate it.</p>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record donation'}</Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Collection history"
          description="Recorded donations and their current unit status."
          action={<Button variant="secondary" onClick={loadRecords} disabled={loading}>Refresh</Button>}
        >
          <div className="workflow-filter">
            <FormField label="Search donations, donors, or units" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </div>
          {loading
            ? <LoadingIndicator label="Loading donation records" />
            : (
              <>
                <DataTable caption="Donation records" columns={columns} rows={records} emptyState="No donations have been recorded." />
                <div className="workflow-pagination">
                  <span>{pagination.totalItems || 0} records</span>
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <span>Page {page} of {Math.max(1, pagination.totalPages || 1)}</span>
                  <Button variant="secondary" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              </>
            )}
        </Panel>
      </PageContainer>
    </AppLayout>
  );
}

export default DonationsPage;
