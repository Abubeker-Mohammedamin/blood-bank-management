import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import AppLayout from '../components/AppLayout.jsx';
import Button from '../components/Button.jsx';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import Dialog from '../components/Dialog.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import PageContainer from '../components/PageContainer.jsx';
import Panel from '../components/Panel.jsx';
import { managementRequest } from '../management/managementRequest.js';

function HospitalForm({ hospital, onCancel, onSave }) {
  const [values, setValues] = useState({
    name: hospital?.name || '',
    registrationNumber: hospital?.registrationNumber || '',
    phone: hospital?.phone || '',
    email: hospital?.email || '',
    addressLine1: hospital?.addressLine1 || '',
    addressLine2: hospital?.addressLine2 || '',
    city: hospital?.city || '',
    region: hospital?.region || '',
    postalCode: hospital?.postalCode || '',
    countryCode: hospital?.countryCode || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({
        ...values,
        registrationNumber: values.registrationNumber || null,
        phone: values.phone || null,
        email: values.email || null,
        addressLine1: values.addressLine1 || null,
        addressLine2: values.addressLine2 || null,
        city: values.city || null,
        region: values.region || null,
        postalCode: values.postalCode || null,
        countryCode: values.countryCode || null,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit}>
      {error && <ErrorMessage title="Hospital record was not saved">{error}</ErrorMessage>}
      <div className="management-form-grid">
        <FormField
          label="Hospital or clinic name"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          maxLength={160}
          required
        />
        <FormField
          label="Registration identifier"
          value={values.registrationNumber}
          onChange={(event) => update('registrationNumber', event.target.value)}
          maxLength={80}
        />
        <FormField
          label="Email"
          type="email"
          value={values.email}
          onChange={(event) => update('email', event.target.value)}
          maxLength={254}
        />
        <FormField
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(event) => update('phone', event.target.value)}
          maxLength={32}
        />
        <FormField label="Address line 1" value={values.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} maxLength={160} />
        <FormField label="Address line 2" value={values.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} maxLength={160} />
        <FormField label="City" value={values.city} onChange={(event) => update('city', event.target.value)} maxLength={100} />
        <FormField label="Region" value={values.region} onChange={(event) => update('region', event.target.value)} maxLength={100} />
        <FormField label="Postal code" value={values.postalCode} onChange={(event) => update('postalCode', event.target.value)} maxLength={20} />
        <FormField
          label="Country code"
          help="Two-letter country code."
          value={values.countryCode}
          onChange={(event) => update('countryCode', event.target.value)}
          maxLength={2}
        />
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save hospital'}</Button>
      </div>
    </form>
  );
}

function HospitalUsers({ hospital, onRefresh }) {
  const [memberships, setMemberships] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadMemberships = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const memberResult = await managementRequest(`/api/hospitals/${hospital.id}/users`);
      setMemberships(memberResult.memberships);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [hospital.id]);

  useEffect(() => {
    loadMemberships();
  }, [loadMemberships]);

  useEffect(() => {
    if (!hospital.isActive) {
      setAccounts([]);
      setSelectedUserId('');
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (accountSearch.trim()) params.set('search', accountSearch.trim());
      managementRequest(`/api/hospitals/${hospital.id}/linkable-accounts?${params}`, {
        signal: controller.signal,
      })
        .then((result) => {
          setAccounts(result.accounts);
          setSelectedUserId((current) => (
            result.accounts.some((account) => account.id === current)
              ? current
              : result.accounts[0]?.id || ''
          ));
        })
        .catch((requestError) => {
          if (requestError.name !== 'AbortError') setError(requestError.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountSearch, hospital.id, hospital.isActive]);

  async function addUser(event) {
    event.preventDefault();
    if (!selectedUserId) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/hospitals/${hospital.id}/users`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId }),
      });
      setSelectedUserId('');
      await loadMemberships();
      onRefresh();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMembership(membership) {
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/hospitals/${hospital.id}/users/${membership.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !membership.isActive }),
      });
      await loadMemberships();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="management-dialog-body">
      {error && <ErrorMessage title="Hospital users could not be updated">{error}</ErrorMessage>}
      {!hospital.isActive && (
        <p className="management-note">This hospital is inactive. Existing access is suspended until it is reactivated.</p>
      )}
      {hospital.isActive && (
        <form className="management-membership-form" onSubmit={addUser}>
          <FormField
            label="Search user accounts"
            type="search"
            value={accountSearch}
            onChange={(event) => {
              setAccountSearch(event.target.value);
              setSelectedUserId('');
            }}
          />
          <FormField
            label="Link an active user account"
            as="select"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            options={[
              { value: '', label: accounts.length ? 'Select an account' : 'No eligible accounts available' },
              ...accounts.map((account) => ({ value: account.id, label: `${account.displayName} · ${account.email}` })),
            ]}
            disabled={busy || !accounts.length}
          />
          <Button type="submit" variant="secondary" disabled={busy || !selectedUserId}>Link account</Button>
        </form>
      )}
      {loading ? (
        <LoadingIndicator label="Loading hospital users" />
      ) : (
        <DataTable
          caption={`Users linked to ${hospital.name}`}
          columns={[
            {
              key: 'person',
              header: 'User account',
              render: (membership) => (
                <span className="management-person">
                  <strong>{membership.user.displayName}</strong>
                  <span>{membership.user.email}</span>
                </span>
              ),
            },
            { key: 'accountStatus', header: 'Account', render: (membership) => membership.user.accountStatus },
            { key: 'isActive', header: 'Hospital access', render: (membership) => membership.isActive ? 'Active' : 'Inactive' },
            {
              key: 'actions',
              header: 'Action',
              render: (membership) => (
                <Button variant="quiet" disabled={busy || !hospital.isActive} onClick={() => toggleMembership(membership)}>
                  {membership.isActive ? 'Deactivate access' : 'Reactivate access'}
                </Button>
              ),
            },
          ]}
          rows={memberships}
          emptyState="No user accounts are linked to this hospital."
        />
      )}
    </div>
  );
}

function HospitalsPage() {
  const { user, logout } = useAuth();
  const [apiState, setApiState] = useState('checking');
  const [logoutError, setLogoutError] = useState('');
  const [hospitals, setHospitals] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [managingUsers, setManagingUsers] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [pendingAction, setPendingAction] = useState(false);

  const loadHospitals = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pagination.pageSize) });
    if (appliedSearch) params.set('search', appliedSearch);
    if (activeFilter) params.set('isActive', activeFilter);
    try {
      const result = await managementRequest(`/api/hospitals?${params}`);
      setHospitals(result.hospitals);
      setPagination(result.pagination);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, appliedSearch, page, pagination.pageSize]);

  useEffect(() => {
    managementRequest('/api/health')
      .then(() => setApiState('online'))
      .catch(() => setApiState('offline'));
  }, []);

  useEffect(() => {
    loadHospitals();
  }, [loadHospitals]);

  const handleLogout = useCallback(async () => {
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }, [logout]);

  async function saveHospital(body) {
    if (editing) {
      await managementRequest(`/api/hospitals/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      await managementRequest('/api/hospitals', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    setCreating(false);
    setEditing(null);
    await loadHospitals();
  }

  async function toggleActive(record, isActive) {
    setPendingAction(true);
    setFormError('');
    try {
      await managementRequest(`/api/hospitals/${record.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      });
      setDeactivating(null);
      setManagingUsers((current) => current?.id === record.id ? { ...current, isActive } : current);
      await loadHospitals();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setPendingAction(false);
    }
  }

  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Hospital / clinic',
      render: (hospital) => (
        <span className="management-person">
          <strong>{hospital.name}</strong>
          <span>{hospital.registrationNumber || 'No registration ID'}</span>
        </span>
      ),
    },
    { key: 'location', header: 'Location', render: (hospital) => [hospital.city, hospital.region].filter(Boolean).join(', ') || '—' },
    { key: 'contact', header: 'Contact', render: (hospital) => hospital.email || hospital.phone || '—' },
    { key: 'isActive', header: 'Status', render: (hospital) => hospital.isActive ? 'Active' : 'Inactive' },
    {
      key: 'counts',
      header: 'Linked records',
      render: (hospital) => `${hospital._count.staff} staff · ${hospital._count.hospitalUsers} users`,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (hospital) => (
        <span className="management-row-actions">
          <Button variant="quiet" onClick={() => { setFormError(''); setEditing(hospital); }}>Edit</Button>
          <Button variant="quiet" onClick={() => { setFormError(''); setManagingUsers(hospital); }}>Users</Button>
          <Button
            variant="quiet"
            disabled={pendingAction}
            onClick={() => hospital.isActive ? setDeactivating(hospital) : toggleActive(hospital, true)}
          >
            {hospital.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </span>
      ),
    },
  ], [pendingAction]);

  return (
    <AppLayout
      apiState={apiState}
      userName={user.displayName}
      onLogout={handleLogout}
      logoutError={logoutError}
      breadcrumbs={[{ label: 'Administration' }, { label: 'Hospitals and clinics' }]}
    >
      <PageContainer
        id="overview"
        eyebrow="ADMINISTRATION"
        title="Hospitals and clinics"
        description="Maintain facility records and link hospital-user accounts to the correct organization."
        actions={<Button onClick={() => { setFormError(''); setCreating(true); }}>Register hospital</Button>}
      >
        {formError && <ErrorMessage title="Hospital operation was not completed">{formError}</ErrorMessage>}
        {loadError && <ErrorMessage title="Hospital records could not be loaded">{loadError}</ErrorMessage>}
        <Panel
          title="Facility directory"
          description={`${pagination.totalItems} matching ${pagination.totalItems === 1 ? 'facility' : 'facilities'}`}
        >
          <form
            className="management-filter-form"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setAppliedSearch(search.trim());
            }}
          >
            <FormField
              label="Search facilities"
              type="search"
              placeholder="Name, registration ID, email, city"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <FormField
              label="Status"
              as="select"
              value={activeFilter}
              onChange={(event) => { setPage(1); setActiveFilter(event.target.value); }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          {loading
            ? <LoadingIndicator label="Loading hospital records" />
            : <DataTable caption="Hospital and clinic directory" columns={columns} rows={hospitals} emptyState="No facilities match these filters." />}
          <div className="donor-pagination">
            <span>Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
            <div>
              <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        </Panel>
        <footer className="page-footer">
          <span>HEMA · FACILITY ADMINISTRATION</span>
          <span>Inactive facility and membership records remain for historical traceability.</span>
        </footer>
      </PageContainer>

      <Dialog
        open={creating || Boolean(editing)}
        className="management-dialog"
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? 'Edit facility' : 'Register facility'}
        description="Facility identifiers are unique and stored in normalized uppercase."
      >
        <div className="management-dialog-body">
          {(creating || editing) && (
            <HospitalForm
              hospital={editing}
              onCancel={() => { setCreating(false); setEditing(null); }}
              onSave={saveHospital}
            />
          )}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(managingUsers)}
        className="management-dialog"
        onClose={() => setManagingUsers(null)}
        title={`Hospital users · ${managingUsers?.name || ''}`}
        description="Link active user accounts to this facility. Memberships are checked on every authorized request."
      >
        {managingUsers && (
          <HospitalUsers
            hospital={managingUsers}
            onRefresh={loadHospitals}
          />
        )}
      </Dialog>

      <ConfirmationDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={() => toggleActive(deactivating, false)}
        title="Deactivate this facility?"
        description="The facility, its user memberships, and operational history are retained. Hospital access is suspended until reactivation."
        confirmLabel="Deactivate facility"
        pending={pendingAction}
      />
    </AppLayout>
  );
}

export default HospitalsPage;
