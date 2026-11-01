import { useCallback, useEffect, useMemo, useState } from 'react';
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
import StatusIndicator from '../components/StatusIndicator.jsx';

const donorStatusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'registered', label: 'Registered' },
  { value: 'active', label: 'Active' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'inactive', label: 'Inactive' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function toDateInput(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

async function donorRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'The donor request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function DonorForm({ donor, canUpdateScreening, creating, onCancel, onSave }) {
  const [values, setValues] = useState({
    displayName: donor?.user?.displayName || '',
    email: donor?.user?.email || '',
    phoneE164: donor?.user?.phoneE164 || '',
    dateOfBirth: toDateInput(donor?.dateOfBirth),
    donorStatus: donor?.donorStatus || 'registered',
    eligibilityReviewedAt: toDateInput(donor?.eligibilityReviewedAt),
    consentGivenAt: toDateInput(donor?.consentGivenAt),
    consentVersion: donor?.consentVersion || '',
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
    const body = {};
    if (creating) {
      body.displayName = values.displayName;
      body.email = values.email;
      body.phoneE164 = values.phoneE164 || null;
      body.dateOfBirth = values.dateOfBirth || null;
    } else {
      body.displayName = values.displayName;
      body.email = values.email;
      body.phoneE164 = values.phoneE164 || null;
      body.dateOfBirth = values.dateOfBirth || null;
      if (canUpdateScreening) {
        body.donorStatus = values.donorStatus;
        body.eligibilityReviewedAt = values.eligibilityReviewedAt
          ? `${values.eligibilityReviewedAt}T00:00:00.000Z`
          : null;
        body.consentGivenAt = values.consentGivenAt
          ? `${values.consentGivenAt}T00:00:00.000Z`
          : null;
        body.consentVersion = values.consentVersion || null;
      }
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
    <form className="donor-form" onSubmit={submit}>
      {error && <ErrorMessage title="Donor record was not saved">{error}</ErrorMessage>}
      <div className="donor-form-grid">
        <FormField
          label="Full name"
          value={values.displayName}
          onChange={(event) => update('displayName', event.target.value)}
          maxLength={120}
          required
        />
        <FormField
          label="Email address"
          type="email"
          value={values.email}
          onChange={(event) => update('email', event.target.value)}
          maxLength={254}
          required
        />
        <FormField
          label="Phone number"
          type="tel"
          help="Use international E.164 format, for example +15551234567."
          value={values.phoneE164}
          onChange={(event) => update('phoneE164', event.target.value)}
          maxLength={16}
        />
        <FormField
          label="Date of birth"
          type="date"
          value={values.dateOfBirth}
          onChange={(event) => update('dateOfBirth', event.target.value)}
        />
      </div>

      {canUpdateScreening && !creating && (
        <section className="screening-fields" aria-labelledby="screening-fields-title">
          <div>
            <h3 id="screening-fields-title">Restricted screening record</h3>
            <p>This records staff-entered status and review metadata only. It does not assess eligibility.</p>
          </div>
          <div className="donor-form-grid">
            <FormField
              label="Donor record status"
              as="select"
              options={donorStatusOptions.filter((option) => option.value)}
              value={values.donorStatus}
              onChange={(event) => update('donorStatus', event.target.value)}
            />
            <FormField
              label="Review recorded on"
              type="date"
              value={values.eligibilityReviewedAt}
              onChange={(event) => update('eligibilityReviewedAt', event.target.value)}
            />
            <FormField
              label="Consent recorded on"
              type="date"
              value={values.consentGivenAt}
              onChange={(event) => update('consentGivenAt', event.target.value)}
            />
            <FormField
              label="Consent version"
              value={values.consentVersion}
              onChange={(event) => update('consentVersion', event.target.value)}
              maxLength={40}
            />
          </div>
        </section>
      )}

      <div className="dialog-actions donor-form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save donor'}</Button>
      </div>
    </form>
  );
}

function DonorDetail({ donor, donations, loadingHistory, isStaff }) {
  const donationColumns = [
    { key: 'donationNumber', header: 'Donation ID' },
    { key: 'collectedAt', header: 'Collected', render: (row) => formatDate(row.collectedAt) },
    { key: 'donationStatus', header: 'Record status' },
    { key: 'volumeMl', header: 'Volume (ml)', render: (row) => row.volumeMl ?? '—' },
  ];

  return (
    <div className="donor-detail">
      <dl className="donor-detail-grid">
        <div><dt>Donor ID</dt><dd>{donor.donorNumber}</dd></div>
        <div><dt>Email</dt><dd>{donor.user.email}</dd></div>
        <div><dt>Phone</dt><dd>{donor.user.phoneE164 || 'Not provided'}</dd></div>
        <div><dt>Date of birth</dt><dd>{formatDate(donor.dateOfBirth)}</dd></div>
        {isStaff && (
          <>
            <div><dt>Record status</dt><dd>{donor.donorStatus}</dd></div>
            <div><dt>Review recorded</dt><dd>{formatDate(donor.eligibilityReviewedAt)}</dd></div>
            <div><dt>Consent recorded</dt><dd>{formatDate(donor.consentGivenAt)}</dd></div>
            <div><dt>Consent version</dt><dd>{donor.consentVersion || 'Not recorded'}</dd></div>
          </>
        )}
      </dl>
      <Panel
        className="donation-history-panel"
        title="Donation history"
        description="Recorded donations only; laboratory screening results are not included."
      >
        {loadingHistory
          ? <LoadingIndicator label="Loading donation history" />
          : (
            <DataTable
              caption="Donor donation history"
              columns={donationColumns}
              rows={donations}
              emptyState="No donations have been recorded for this donor."
            />
          )}
      </Panel>
    </div>
  );
}

function DonorsPage({ selfOnly = false }) {
  const { user, logout } = useAuth();
  const isStaff = user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
  const [apiState, setApiState] = useState('checking');
  const [logoutError, setLogoutError] = useState('');
  const [donors, setDonors] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [donations, setDonations] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [editingDonor, setEditingDonor] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [missingProfile, setMissingProfile] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        setApiState('online');
      })
      .catch(() => setApiState('offline'));
  }, []);

  const loadDonors = useCallback(async (signal) => {
    setLoading(true);
    setLoadError('');
    setMissingProfile(false);
    const params = new URLSearchParams({
      page: String(selfOnly ? 1 : page),
      pageSize: String(selfOnly ? 1 : pagination.pageSize),
    });
    if (!selfOnly && appliedSearch) params.set('search', appliedSearch);
    if (!selfOnly && statusFilter) params.set('status', statusFilter);
    try {
      const result = await donorRequest(`/api/donors?${params}`, { signal });
      setDonors(result.donors);
      setPagination(result.pagination);
      setMissingProfile(selfOnly && result.donors.length === 0);
    } catch (error) {
      if (error.name !== 'AbortError') setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, pagination.pageSize, selfOnly, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    loadDonors(controller.signal);
    return () => controller.abort();
  }, [loadDonors]);

  const handleLogout = useCallback(async () => {
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }, [logout]);

  const openDonor = useCallback(async (donorSummary) => {
    setRecordError('');
    setSelectedDonor(donorSummary);
    setLoadingHistory(true);
    try {
      const [details, history] = await Promise.all([
        donorRequest(`/api/donors/${donorSummary.id}`),
        donorRequest(`/api/donors/${donorSummary.id}/donations`),
      ]);
      setSelectedDonor(details.donor);
      setDonations(history.donations);
    } catch (error) {
      setRecordError(error.message);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  async function saveNewDonor(body) {
    await donorRequest('/api/donors', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setIsCreateOpen(false);
    await loadDonors();
  }

  async function saveDonor(body) {
    const result = await donorRequest(`/api/donors/${editingDonor.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    setEditingDonor(null);
    if (selectedDonor?.id === result.donor.id) {
      setSelectedDonor(result.donor);
    }
    await loadDonors();
  }

  async function createOwnProfile() {
    setRecordError('');
    try {
      const result = await donorRequest('/api/donors', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setMissingProfile(false);
      setDonors([result.donor]);
    } catch (error) {
      setRecordError(error.message);
    }
  }

  const columns = useMemo(() => [
    {
      key: 'donorNumber',
      header: 'Donor ID',
      render: (donor) => <strong className="donor-number">{donor.donorNumber}</strong>,
    },
    {
      key: 'name',
      header: 'Donor',
      render: (donor) => (
        <span className="donor-name-cell">
          <strong>{donor.user.displayName}</strong>
          <span>{donor.user.email}</span>
        </span>
      ),
    },
    {
      key: 'donorStatus',
      header: 'Record status',
      render: (donor) => donor.donorStatus
        ? <span className={`donor-status status-label-${donor.donorStatus}`}>{donor.donorStatus}</span>
        : 'Private',
    },
    {
      key: 'donationCount',
      header: 'Donations',
      render: (donor) => donor.donationCount ?? 0,
    },
    {
      key: 'lastDonation',
      header: 'Last donation',
      render: (donor) => formatDate(donor.latestDonation?.collectedAt),
    },
    {
      key: 'actions',
      header: 'Record',
      render: (donor) => (
        <Button variant="quiet" onClick={() => openDonor(donor)}>Open</Button>
      ),
    },
  ], [openDonor]);

  const activeDonor = selfOnly ? donors[0] : null;
  const editDonor = selfOnly ? activeDonor : selectedDonor;
  const canEditScreening = isStaff && !selfOnly;

  useEffect(() => {
    if (!selfOnly || !activeDonor?.id) return undefined;
    const controller = new AbortController();
    setLoadingHistory(true);
    donorRequest(`/api/donors/${activeDonor.id}/donations`, { signal: controller.signal })
      .then((result) => setDonations(result.donations))
      .catch((error) => {
        if (error.name !== 'AbortError') setRecordError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
    return () => controller.abort();
  }, [activeDonor?.id, selfOnly]);

  return (
    <AppLayout
      apiState={apiState}
      userName={user.displayName}
      onLogout={handleLogout}
      logoutError={logoutError}
      breadcrumbs={[
        { label: 'Operations', href: '/overview' },
        { label: selfOnly ? 'My donor profile' : 'Donors' },
      ]}
    >
      <PageContainer
        id="donors"
        eyebrow={selfOnly ? 'DONOR ACCOUNT' : 'DONOR SERVICES'}
        title={selfOnly ? 'My donor profile' : 'Donors'}
        description={selfOnly
          ? 'Review your contact information and donation history.'
          : 'Register donors, maintain contact details, and review authorized screening records.'}
        actions={!selfOnly && isStaff ? (
          <Button onClick={() => setIsCreateOpen(true)}>Register donor</Button>
        ) : null}
      >
        {recordError && <ErrorMessage title="Donor record could not be loaded or created">{recordError}</ErrorMessage>}
        {loadError && <ErrorMessage title="Donor records could not be loaded">{loadError}</ErrorMessage>}

        {selfOnly ? (
          missingProfile ? (
            <Panel title="Donor profile not found" description="Create your donor record to view and update your profile.">
              <div className="donor-empty-action">
                <p>No donor profile is currently linked to this account.</p>
                <Button onClick={createOwnProfile}>Create my profile</Button>
              </div>
            </Panel>
          ) : loading ? (
            <LoadingIndicator label="Loading your donor profile" />
          ) : activeDonor ? (
            <div className="donor-profile-layout">
              <Panel
                title="Contact and profile"
                description={`Donor ID ${activeDonor.donorNumber}`}
                action={<Button variant="secondary" onClick={() => setEditingDonor(activeDonor)}>Edit profile</Button>}
              >
                <div className="donor-detail-grid donor-detail-grid-standalone">
                  <div><dt>Full name</dt><dd>{activeDonor.user.displayName}</dd></div>
                  <div><dt>Email</dt><dd>{activeDonor.user.email}</dd></div>
                  <div><dt>Phone</dt><dd>{activeDonor.user.phoneE164 || 'Not provided'}</dd></div>
                  <div><dt>Date of birth</dt><dd>{formatDate(activeDonor.dateOfBirth)}</dd></div>
                </div>
              </Panel>
              <Panel title="Donation history" description="Recorded donations for this account.">
                {loadingHistory
                  ? <LoadingIndicator label="Loading donation history" />
                  : (
                    <DataTable
                      caption="My donation history"
                      columns={[
                        { key: 'donationNumber', header: 'Donation ID' },
                        { key: 'collectedAt', header: 'Collected', render: (row) => formatDate(row.collectedAt) },
                        { key: 'donationStatus', header: 'Record status' },
                        { key: 'volumeMl', header: 'Volume (ml)', render: (row) => row.volumeMl ?? '—' },
                      ]}
                      rows={donations}
                      emptyState="No donations have been recorded."
                    />
                  )}
              </Panel>
            </div>
          ) : null
        ) : (
          <Panel
            title="Donor directory"
            description={`${pagination.totalItems} matching ${pagination.totalItems === 1 ? 'donor' : 'donors'}`}
            action={apiState === 'offline' ? <StatusIndicator state="offline" label="API unavailable" /> : null}
          >
            <form
              className="donor-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setAppliedSearch(search.trim());
              }}
            >
              <FormField
                label="Search donors"
                type="search"
                placeholder="Donor ID, name, email, or phone"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <FormField
                label="Record status"
                as="select"
                options={donorStatusOptions}
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value);
                }}
              />
              <Button type="submit" variant="secondary">Search</Button>
            </form>
            {loading ? (
              <div className="donor-loading"><LoadingIndicator label="Loading donors" /></div>
            ) : (
              <DataTable
                caption="Donor directory"
                columns={columns}
                rows={donors}
                emptyState="No donors match these filters."
                className="donor-table"
              />
            )}
            <div className="donor-pagination">
              <span>
                Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
              </span>
              <div>
                <Button
                  variant="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={page >= pagination.totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Panel>
        )}

        <footer className="page-footer">
          <span>HEMA · BLOOD SERVICES ADMINISTRATION</span>
          <span>Screening status is recorded by staff; the system does not determine eligibility.</span>
        </footer>
      </PageContainer>

      <Dialog
        open={isCreateOpen}
        className="donor-dialog"
        onClose={() => setIsCreateOpen(false)}
        title="Register donor"
        description="Create a donor contact record and a unique donor ID."
      >
        <div className="donor-dialog-body">
          <p className="donor-account-note">
            This record has no password. Account sign-in credentials must be provisioned separately.
          </p>
          <DonorForm
            creating
            donor={null}
            canUpdateScreening={false}
            onCancel={() => setIsCreateOpen(false)}
            onSave={saveNewDonor}
          />
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selectedDonor) && !editingDonor}
        className="donor-dialog"
        onClose={() => {
          setSelectedDonor(null);
          setRecordError('');
        }}
        title={selectedDonor?.user?.displayName || 'Donor record'}
        description="Donor contact details and recorded donation history."
      >
        <div className="donor-dialog-body">
          {recordError
            ? <ErrorMessage title="Donor record could not be loaded">{recordError}</ErrorMessage>
            : selectedDonor && (
              <>
                <DonorDetail
                  donor={selectedDonor}
                  donations={donations}
                  loadingHistory={loadingHistory}
                  isStaff={isStaff}
                />
                {isStaff && (
                  <div className="dialog-actions">
                    <Button variant="secondary" onClick={() => setSelectedDonor(null)}>Close</Button>
                    <Button onClick={() => setEditingDonor(selectedDonor)}>Edit donor</Button>
                  </div>
                )}
              </>
            )}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editingDonor)}
        className="donor-dialog"
        onClose={() => setEditingDonor(null)}
        title="Edit donor profile"
        description={canEditScreening
          ? 'Update contact details and restricted staff review metadata.'
          : 'Update your own contact and profile details.'}
      >
        {editingDonor && (
          <DonorForm
            donor={editingDonor}
            canUpdateScreening={canEditScreening}
            creating={false}
            onCancel={() => setEditingDonor(null)}
            onSave={saveDonor}
          />
        )}
      </Dialog>
    </AppLayout>
  );
}

export default DonorsPage;
