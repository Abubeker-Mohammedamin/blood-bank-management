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

const staffStatusOptions = [
  { value: '', label: 'All staff statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const accountStatusOptions = [
  { value: '', label: 'All account statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];
const editableAccountStatusOptions = accountStatusOptions.slice(1);

function StaffForm({
  staff,
  hospitals = [],
  accounts = [],
  accountSearch,
  onAccountSearch,
  onCancel,
  onSave,
}) {
  const [values, setValues] = useState({
    userId: '',
    displayName: staff?.user.displayName || '',
    email: staff?.user.email || '',
    phoneE164: staff?.user.phoneE164 || '',
    hospitalId: staff?.hospitalId || hospitals[0]?.id || '',
    employeeNumber: staff?.employeeNumber || '',
    jobTitle: staff?.jobTitle || '',
    staffStatus: staff?.staffStatus || 'active',
    accountStatus: staff?.user.accountStatus || 'pending',
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
    const body = {
      hospitalId: values.hospitalId,
      employeeNumber: values.employeeNumber,
      jobTitle: values.jobTitle || null,
      staffStatus: values.staffStatus,
      accountStatus: values.accountStatus,
    };
    if (staff) {
      body.displayName = values.displayName;
      body.email = values.email;
      body.phoneE164 = values.phoneE164 || null;
    } else if (values.userId) {
      body.userId = values.userId;
    } else {
      body.displayName = values.displayName;
      body.email = values.email;
      body.phoneE164 = values.phoneE164 || null;
    }

    try {
      await onSave(body);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit}>
      {error && <ErrorMessage title="Staff record was not saved">{error}</ErrorMessage>}
      {!staff && (
        <>
          <FormField
            label="Search existing user accounts"
            type="search"
            value={accountSearch}
            onChange={(event) => onAccountSearch(event.target.value)}
          />
          <FormField
            label="Account link"
            as="select"
            value={values.userId}
            onChange={(event) => {
              const userId = event.target.value;
              const account = accounts.find((item) => item.id === userId);
              setValues((current) => ({
                ...current,
                userId,
                accountStatus: account?.accountStatus || 'pending',
              }));
            }}
            options={[
              { value: '', label: 'Create a new linked account' },
              ...accounts.map((account) => ({
                value: account.id,
                label: `${account.displayName} · ${account.email}`,
              })),
            ]}
          />
        </>
      )}
      {!values.userId || staff ? (
        <div className="management-form-grid">
          <FormField
            label="Full name"
            value={values.displayName}
            onChange={(event) => update('displayName', event.target.value)}
            maxLength={120}
            required
          />
          <FormField
            label="Email"
            type="email"
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
            maxLength={254}
            required
          />
          <FormField
            label="Phone number"
            type="tel"
            help="Optional; use international E.164 format."
            value={values.phoneE164}
            onChange={(event) => update('phoneE164', event.target.value)}
            maxLength={16}
          />
        </div>
      ) : (
        <p className="management-note">
          {accounts.find((account) => account.id === values.userId)?.displayName || 'Selected account'} will be linked to this staff profile.
        </p>
      )}
      <div className="management-form-grid">
        <FormField
          label="Hospital"
          as="select"
          value={values.hospitalId}
          onChange={(event) => update('hospitalId', event.target.value)}
          options={hospitals.map((hospital) => ({ value: hospital.id, label: hospital.name }))}
          required
        />
        <FormField
          label="Employee identifier"
          value={values.employeeNumber}
          onChange={(event) => update('employeeNumber', event.target.value)}
          maxLength={40}
          required
        />
        <FormField
          label="Job title"
          value={values.jobTitle}
          onChange={(event) => update('jobTitle', event.target.value)}
          maxLength={100}
        />
        <FormField
          label="Staff status"
          as="select"
          value={values.staffStatus}
          onChange={(event) => update('staffStatus', event.target.value)}
          options={staffStatusOptions.slice(1)}
        />
        <FormField
          label="Account status"
          as="select"
          value={values.accountStatus}
          onChange={(event) => update('accountStatus', event.target.value)}
          options={editableAccountStatusOptions}
        />
      </div>
      {!staff && !values.userId && (
        <p className="management-note">
          New accounts have no password. Secure credentials must be provisioned separately.
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving || !hospitals.length}>
          {saving ? 'Saving…' : 'Save staff record'}
        </Button>
      </div>
    </form>
  );
}

function StaffPage() {
  const { user, logout } = useAuth();
  const [apiState, setApiState] = useState('checking');
  const [logoutError, setLogoutError] = useState('');
  const [staff, setStaff] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [staffStatus, setStaffStatus] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [pendingAction, setPendingAction] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pagination.pageSize),
    });
    if (appliedSearch) params.set('search', appliedSearch);
    if (staffStatus) params.set('status', staffStatus);
    if (accountStatus) params.set('accountStatus', accountStatus);
    if (hospitalFilter) params.set('hospitalId', hospitalFilter);
    try {
      const result = await managementRequest(`/api/staff?${params}`);
      setStaff(result.staff);
      setPagination(result.pagination);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [accountStatus, appliedSearch, hospitalFilter, page, pagination.pageSize, staffStatus]);

  useEffect(() => {
    managementRequest('/api/health')
      .then(() => setApiState('online'))
      .catch(() => setApiState('offline'));
    managementRequest('/api/hospitals?isActive=true&pageSize=100')
      .then((result) => {
        if (!Array.isArray(result.hospitals)) throw new Error('The active hospital list is unavailable.');
        setHospitals(result.hospitals);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleLogout = useCallback(async () => {
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }, [logout]);

  async function openCreate() {
    setFormError('');
    try {
      const result = await managementRequest('/api/staff/linkable-accounts');
      if (!Array.isArray(result.accounts)) throw new Error('The user account list is unavailable.');
      setAccounts(result.accounts);
      setAccountSearch('');
      setCreating(true);
    } catch (error) {
      setFormError(error.message);
    }
  }

  useEffect(() => {
    if (!creating) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (accountSearch.trim()) params.set('search', accountSearch.trim());
      managementRequest(`/api/staff/linkable-accounts?${params}`, { signal: controller.signal })
        .then((result) => {
          if (!Array.isArray(result.accounts)) throw new Error('The user account list is unavailable.');
          setAccounts(result.accounts);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') setFormError(error.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountSearch, creating]);

  async function saveStaff(body) {
    if (editing) {
      await managementRequest(`/api/staff/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      await managementRequest('/api/staff', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    setCreating(false);
    setEditing(null);
    await loadStaff();
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    setPendingAction(true);
    setFormError('');
    try {
      await managementRequest(`/api/staff/${deactivating.id}`, {
        method: 'PUT',
        body: JSON.stringify({ staffStatus: 'inactive', accountStatus: 'disabled' }),
      });
      setDeactivating(null);
      await loadStaff();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setPendingAction(false);
    }
  }

  async function toggleActive(record) {
    setPendingAction(true);
    setFormError('');
    try {
      await managementRequest(`/api/staff/${record.id}`, {
        method: 'PUT',
        body: JSON.stringify(record.staffStatus === 'active'
          ? { staffStatus: 'inactive', accountStatus: 'disabled' }
          : { staffStatus: 'active', accountStatus: 'active' }),
      });
      await loadStaff();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setPendingAction(false);
    }
  }

  const columns = useMemo(() => [
    { key: 'employeeNumber', header: 'Employee ID', render: (record) => <strong>{record.employeeNumber}</strong> },
    {
      key: 'person',
      header: 'Staff member',
      render: (record) => (
        <span className="management-person">
          <strong>{record.user.displayName}</strong>
          <span>{record.user.email}</span>
          <span>{record.user.phoneE164 || 'Phone not provided'}</span>
        </span>
      ),
    },
    { key: 'jobTitle', header: 'Job title', render: (record) => record.jobTitle || '—' },
    { key: 'hospital', header: 'Hospital', render: (record) => record.hospital.name },
    {
      key: 'statuses',
      header: 'Staff / account',
      render: (record) => `${record.staffStatus} / ${record.user.accountStatus}`,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (record) => (
        <span className="management-row-actions">
          <Button variant="quiet" onClick={() => { setFormError(''); setEditing(record); }}>Edit</Button>
          <Button
            variant="quiet"
            disabled={pendingAction}
            onClick={() => record.staffStatus === 'active' ? setDeactivating(record) : toggleActive(record)}
          >
            {record.staffStatus === 'active' ? 'Deactivate' : 'Reactivate'}
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
      breadcrumbs={[{ label: 'Administration' }, { label: 'Staff' }]}
    >
      <PageContainer
        id="overview"
        eyebrow="ADMINISTRATION"
        title="Staff"
        description="Manage staff identifiers, contact details, account links, and access status."
        actions={<Button onClick={openCreate}>Add staff member</Button>}
      >
        {formError && <ErrorMessage title="Staff operation was not completed">{formError}</ErrorMessage>}
        {loadError && <ErrorMessage title="Staff records could not be loaded">{loadError}</ErrorMessage>}
        <Panel
          title="Staff directory"
          description={`${pagination.totalItems} matching ${pagination.totalItems === 1 ? 'staff record' : 'staff records'}`}
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
              label="Search staff"
              type="search"
              placeholder="Name, email, employee ID, title, hospital"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <FormField
              label="Staff status"
              as="select"
              value={staffStatus}
              onChange={(event) => { setPage(1); setStaffStatus(event.target.value); }}
              options={staffStatusOptions}
            />
            <FormField
              label="Account status"
              as="select"
              value={accountStatus}
              onChange={(event) => { setPage(1); setAccountStatus(event.target.value); }}
              options={accountStatusOptions}
            />
            <FormField
              label="Hospital"
              as="select"
              value={hospitalFilter}
              onChange={(event) => { setPage(1); setHospitalFilter(event.target.value); }}
              options={[{ value: '', label: 'All hospitals' }, ...hospitals.map((item) => ({ value: item.id, label: item.name }))]}
            />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          {loading
            ? <LoadingIndicator label="Loading staff records" />
            : <DataTable caption="Staff directory" columns={columns} rows={staff} emptyState="No staff records match these filters." />}
          <div className="donor-pagination">
            <span>Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
            <div>
              <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        </Panel>
        <footer className="page-footer">
          <span>HEMA · STAFF ADMINISTRATION</span>
          <span>Staff profiles are deactivated, never deleted, to preserve operational history.</span>
        </footer>
      </PageContainer>

      <Dialog
        open={creating || Boolean(editing)}
        className="management-dialog"
        onClose={() => { setCreating(false); setEditing(null); setFormError(''); }}
        title={editing ? 'Edit staff record' : 'Add staff member'}
        description="Account, staff identifier, and hospital link are stored together."
      >
        <div className="management-dialog-body">
          {formError && <ErrorMessage title="Staff record could not be loaded">{formError}</ErrorMessage>}
          {(creating || editing) && (
            <StaffForm
              staff={editing}
              hospitals={hospitals}
              accounts={accounts}
              accountSearch={accountSearch}
              onAccountSearch={setAccountSearch}
              onCancel={() => { setCreating(false); setEditing(null); }}
              onSave={saveStaff}
            />
          )}
        </div>
      </Dialog>

      <ConfirmationDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate staff member?"
        description="This preserves the staff record and history but disables the linked user account."
        confirmLabel="Deactivate staff"
        pending={pendingAction}
      />
    </AppLayout>
  );
}

export default StaffPage;
