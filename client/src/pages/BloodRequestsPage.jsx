import { useCallback, useEffect, useMemo, useState } from 'react';
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

const components = [
  { value: 'whole_blood', label: 'Whole blood' },
  { value: 'red_cells', label: 'Red cells' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'platelets', label: 'Platelets' },
];
const priorities = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'emergency', label: 'Emergency' },
];
const terminalStatuses = {
  delivered: ['transfused', 'not_transfused'],
  returned: ['returned_to_inventory_quarantine'],
  discarded: ['discarded'],
};

function formatStatus(status) {
  return status.replaceAll('_', ' ');
}

function BloodRequestsPage() {
  const { user, logout } = useAuth();
  const isStaff = user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
  const isAdmin = user.roles.includes('ADMIN');
  const [searchParams] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [bloodTypes, setBloodTypes] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [eligibleUnits, setEligibleUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [approval, setApproval] = useState(null);
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [appliedFilters, setAppliedFilters] = useState({ search: '', status: '' });
  const [requestPage, setRequestPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, total: 0 });
  const [form, setForm] = useState({
    hospitalId: '',
    bloodTypeId: '',
    componentType: 'red_cells',
    quantityRequested: '1',
    priority: 'routine',
    requestDetails: '',
    neededBy: '',
  });
  const [reviewNote, setReviewNote] = useState('');
  const [approvalForm, setApprovalForm] = useState({
    policyVersion: '',
    policyDescription: 'Qualified review approved exact ABO/Rh matching only.',
    reviewerName: '',
    reviewerCredential: '',
    reviewedAt: new Date().toISOString().slice(0, 10),
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiState, setApiState] = useState('checking');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoutError, setLogoutError] = useState('');

  const loadRequests = useCallback(async () => {
    const params = new URLSearchParams({ page: String(requestPage), pageSize: '20' });
    if (appliedFilters.search.trim()) params.set('search', appliedFilters.search.trim());
    if (appliedFilters.status) params.set('status', appliedFilters.status);
    const result = await managementRequest(`/api/blood-requests?${params}`);
    setRequests(result.requests);
    setPagination(result.pagination);
  }, [appliedFilters, requestPage]);

  const loadDetails = useCallback(async (id) => {
    const result = await managementRequest(`/api/blood-requests/${id}`);
    setSelectedRequest(result.bloodRequest);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [options] = await Promise.all([
        managementRequest('/api/blood-requests/options'),
        loadRequests(),
      ]);
      setBloodTypes(options.bloodTypes);
      setHospitals(options.hospitals);
      setForm((current) => ({
        ...current,
        hospitalId: current.hospitalId || options.hospitals[0]?.id || '',
        bloodTypeId: current.bloodTypeId || options.bloodTypes[0]?.id || '',
      }));
      if (isStaff) {
        const approvalResult = await managementRequest('/api/blood-requests/compatibility-approval');
        setApproval(approvalResult.approval);
      }
      setApiState('online');
    } catch (requestError) {
      setError(requestError.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, [isStaff, loadRequests]);

  useEffect(() => {
    load();
  }, [load]);

  // Open a specific request when the dashboard or another page links here
  // with ?requestId=..., so deep links land on the underlying record.
  useEffect(() => {
    const requestId = searchParams.get('requestId');
    if (requestId && !loading) {
      openRequest(requestId);
    }
  }, [searchParams, loading]);

  useEffect(() => {
    if (!selectedRequest || !isStaff || !['approved', 'partially_fulfilled'].includes(selectedRequest.requestStatus)) {
      setEligibleUnits([]);
      return;
    }
    const group = `${selectedRequest.bloodType.aboGroup}${selectedRequest.bloodType.rhFactor}`;
    const params = new URLSearchParams({
      page: '1',
      pageSize: '100',
      bloodGroup: group,
      component: selectedRequest.componentType,
      status: 'available',
    });
    managementRequest(`/api/blood-units?${params}`)
      .then(({ units }) => setEligibleUnits(units.filter((unit) => unit.eligibleForAllocation)))
      .catch((requestError) => setError(requestError.message));
  }, [isStaff, selectedRequest]);

  const columns = useMemo(() => [
    { key: 'requestNumber', header: 'Request', render: (row) => <strong>{row.requestNumber}</strong> },
    { key: 'hospital', header: 'Hospital', render: (row) => row.hospital.name },
    { key: 'bloodType', header: 'Blood group', render: (row) => row.bloodType.code },
    { key: 'componentType', header: 'Component', render: (row) => components.find((item) => item.value === row.componentType)?.label || row.componentType },
    { key: 'quantityRequested', header: 'Units' },
    { key: 'priority', header: 'Urgency', render: (row) => row.priority },
    { key: 'requestStatus', header: 'Status', render: (row) => <span className="request-status">{formatStatus(row.requestStatus)}</span> },
    {
      key: 'actions',
      header: 'Details',
      render: (row) => (
        <Button variant="secondary" onClick={() => openRequest(row.id)}>Open</Button>
      ),
    },
  ], []);

  async function openRequest(id) {
    setError('');
    setSuccess('');
    try {
      await loadDetails(id);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await managementRequest('/api/blood-requests', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          quantityRequested: Number(form.quantityRequested),
          neededBy: form.neededBy ? new Date(form.neededBy).toISOString() : null,
        }),
      });
      setSuccess(`Request ${result.bloodRequest.requestNumber} submitted for review.`);
      setForm((current) => ({ ...current, requestDetails: '', neededBy: '' }));
      await loadRequests();
      await loadDetails(result.bloodRequest.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(decision) {
    if (!selectedRequest) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/blood-requests/${selectedRequest.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: reviewNote || null }),
      });
      setSuccess(`Request ${decision}.`);
      setReviewNote('');
      await Promise.all([loadDetails(selectedRequest.id), loadRequests()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!selectedRequest || !window.confirm(`Cancel ${selectedRequest.requestNumber}?`)) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/blood-requests/${selectedRequest.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSuccess('Request cancelled.');
      await Promise.all([loadDetails(selectedRequest.id), loadRequests()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function allocateUnit() {
    if (!selectedRequest || !selectedUnitId) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/blood-units/${selectedUnitId}/allocate`, {
        method: 'POST',
        body: JSON.stringify({ bloodRequestId: selectedRequest.id }),
      });
      setSuccess('Unit allocated to the approved request.');
      setSelectedUnitId('');
      await Promise.all([loadDetails(selectedRequest.id), loadRequests()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function dispatchAllocation(allocationId) {
    if (!selectedRequest) return;
    if (!window.confirm('Record dispatch of this allocated unit? Dispatch history cannot be deleted.')) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/blood-requests/${selectedRequest.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ allocationIds: [allocationId] }),
      });
      setSuccess('Unit dispatch recorded. Record its delivery result when known.');
      await Promise.all([loadDetails(selectedRequest.id), loadRequests()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function setDispatchOutcome(dispatch, deliveryStatus, finalDisposition) {
    if (!window.confirm(`Record final status "${deliveryStatus}" and disposition "${finalDisposition}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await managementRequest(`/api/blood-requests/dispatches/${dispatch.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryStatus, finalDisposition }),
      });
      setSuccess('Final delivery disposition recorded.');
      await Promise.all([loadDetails(selectedRequest.id), loadRequests()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCompatibilityApproval(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await managementRequest('/api/blood-requests/compatibility-approval', {
        method: 'POST',
        body: JSON.stringify({
          ...approvalForm,
          reviewedAt: new Date(`${approvalForm.reviewedAt}T00:00:00.000Z`).toISOString(),
        }),
      });
      setApproval(result.approval);
      setSuccess('Qualified compatibility review attestation recorded.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setLogoutError('');
    try {
      await logout();
    } catch (requestError) {
      setLogoutError(requestError.message);
    }
  }

  const canCancel = selectedRequest
    && ['open', 'approved', 'rejected'].includes(selectedRequest.requestStatus)
    && selectedRequest.requestedByUserId === user.id;

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={['Blood requests']}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="blood-requests"
        eyebrow="Hospital services"
        title="Blood requests"
        description="Submit and review requests, allocate eligible units, and record dispatch and final disposition."
      >
        {error && <ErrorMessage title="Blood request workflow">{error}</ErrorMessage>}
        {success && <p className="success-message" role="status">{success}</p>}

        {isStaff && (
          <Panel
            title="Compatibility policy attestation"
            description="Allocation remains disabled until an administrator records qualified review of exact ABO/Rh matching."
          >
            {approval ? (
              <p className="management-note">
                Active policy {approval.policyVersion}, reviewed by {approval.reviewerName} ({approval.reviewerCredential}) on {new Date(approval.reviewedAt).toLocaleDateString()}.
              </p>
            ) : (
              <p className="management-note">No active qualified-review attestation is recorded. Do not allocate any unit.</p>
            )}
            {isAdmin && (
              <form className="management-form" onSubmit={saveCompatibilityApproval}>
                <div className="management-form-grid">
                  <FormField label="Policy version" value={approvalForm.policyVersion} onChange={(event) => setApprovalForm({ ...approvalForm, policyVersion: event.target.value })} maxLength={80} required />
                  <FormField label="Qualified reviewer name" value={approvalForm.reviewerName} onChange={(event) => setApprovalForm({ ...approvalForm, reviewerName: event.target.value })} maxLength={160} required />
                  <FormField label="Reviewer credential" value={approvalForm.reviewerCredential} onChange={(event) => setApprovalForm({ ...approvalForm, reviewerCredential: event.target.value })} maxLength={160} required />
                  <FormField label="Review date" type="date" value={approvalForm.reviewedAt} onChange={(event) => setApprovalForm({ ...approvalForm, reviewedAt: event.target.value })} required />
                  <FormField label="Policy description" as="textarea" value={approvalForm.policyDescription} onChange={(event) => setApprovalForm({ ...approvalForm, policyDescription: event.target.value })} maxLength={1000} required />
                </div>
                <div className="dialog-actions">
                  <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record qualified review'}</Button>
                </div>
              </form>
            )}
          </Panel>
        )}

        {!isStaff && (
          <Panel title="Submit a request" description="Enter the requested blood type, component, quantity, urgency, and operational details.">
            {hospitals.length === 0 ? (
              <p className="management-note">Your account is not linked to an active hospital or clinic. Ask an administrator to link it.</p>
            ) : (
              <form className="management-form" onSubmit={submitRequest}>
                <div className="management-form-grid">
                  <FormField label="Hospital or clinic" as="select" value={form.hospitalId} onChange={(event) => setForm({ ...form, hospitalId: event.target.value })} options={hospitals.map((hospital) => ({ value: hospital.id, label: hospital.name }))} required />
                  <FormField label="Blood group (ABO/Rh)" as="select" value={form.bloodTypeId} onChange={(event) => setForm({ ...form, bloodTypeId: event.target.value })} options={bloodTypes.map((type) => ({ value: type.id, label: type.code }))} required />
                  <FormField label="Component" as="select" value={form.componentType} onChange={(event) => setForm({ ...form, componentType: event.target.value })} options={components} required />
                  <FormField label="Number of units" type="number" min="1" max="1000" value={form.quantityRequested} onChange={(event) => setForm({ ...form, quantityRequested: event.target.value })} required />
                  <FormField label="Urgency" as="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} options={priorities} required />
                  <FormField label="Needed by (optional)" type="datetime-local" value={form.neededBy} onChange={(event) => setForm({ ...form, neededBy: event.target.value })} />
                  <FormField label="Required details" as="textarea" value={form.requestDetails} onChange={(event) => setForm({ ...form, requestDetails: event.target.value })} maxLength={1000} help="Provide operational details only; do not enter patient names or other identifying information." required />
                </div>
                <div className="dialog-actions">
                  <Button type="submit" disabled={busy || hospitals.length === 0}>{busy ? 'Submitting…' : 'Submit request'}</Button>
                </div>
              </form>
            )}
          </Panel>
        )}

        <Panel title="Requests" description="Search and filter requests available in your authorized hospital scope.">
          <form
            className="request-filter-form"
            onSubmit={(event) => {
              event.preventDefault();
              setRequestPage(1);
              setAppliedFilters({ ...filters, search: filters.search.trim() });
            }}
          >
            <FormField label="Search" type="search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
            <FormField
              label="Status"
              as="select"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
              options={[
                { value: '', label: 'All statuses' },
                ...['open', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired']
                  .map((status) => ({ value: status, label: formatStatus(status) })),
              ]}
            />
            <Button type="submit" variant="secondary">Apply filters</Button>
          </form>
          {loading ? (
            <LoadingIndicator label="Loading blood requests" />
          ) : (
            <DataTable caption="Blood requests" columns={columns} rows={requests} emptyState="No blood requests match these filters." />
          )}
          <div className="donor-pagination">
            <span>
              Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total} request(s)
            </span>
            <div>
              <Button variant="secondary" disabled={requestPage <= 1} onClick={() => setRequestPage((page) => page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={!pagination.totalPages || requestPage >= pagination.totalPages} onClick={() => setRequestPage((page) => page + 1)}>Next</Button>
            </div>
          </div>
        </Panel>

        {selectedRequest && (
          <Panel
            title={`Request ${selectedRequest.requestNumber}`}
            description={`${selectedRequest.hospital.name} · ${selectedRequest.bloodType.code} · ${selectedRequest.componentType.replaceAll('_', ' ')} · ${selectedRequest.quantityRequested} unit(s)`}
            action={<Button variant="secondary" onClick={() => setSelectedRequest(null)}>Close details</Button>}
          >
            <dl className="request-details">
              <div><dt>Status</dt><dd>{formatStatus(selectedRequest.requestStatus)}</dd></div>
              <div><dt>Urgency</dt><dd>{selectedRequest.priority}</dd></div>
              <div><dt>Needed by</dt><dd>{selectedRequest.neededBy ? new Date(selectedRequest.neededBy).toLocaleString() : 'Not specified'}</dd></div>
              <div><dt>Request details</dt><dd>{selectedRequest.requestDetails || 'No details recorded.'}</dd></div>
              {selectedRequest.reviewNote && <div><dt>Review note</dt><dd>{selectedRequest.reviewNote}</dd></div>}
            </dl>

            {isStaff && selectedRequest.requestStatus === 'open' && (
              <div className="request-actions">
                <FormField label="Review note (required to reject)" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} />
                <Button disabled={busy} onClick={() => reviewRequest('approved')}>Approve request</Button>
                <Button variant="secondary" disabled={busy || !reviewNote.trim()} onClick={() => reviewRequest('rejected')}>Reject request</Button>
              </div>
            )}

            {canCancel && (
              <div className="request-actions">
                <Button variant="secondary" disabled={busy} onClick={cancelRequest}>Cancel request</Button>
              </div>
            )}

            {isStaff && ['approved', 'partially_fulfilled'].includes(selectedRequest.requestStatus) && (
              <div className="request-actions">
                <FormField
                  label="Eligible available unit"
                  as="select"
                  value={selectedUnitId}
                  onChange={(event) => setSelectedUnitId(event.target.value)}
                  options={[
                    { value: '', label: eligibleUnits.length ? 'Select a released matching unit' : 'No eligible matching units available', disabled: true },
                    ...eligibleUnits.map((unit) => ({
                      value: unit.id,
                      label: `${unit.unitCode} · expires ${new Date(unit.expiresAt).toLocaleDateString()}`,
                    })),
                  ]}
                />
                <Button disabled={busy || !selectedUnitId || !approval} onClick={allocateUnit}>Allocate unit</Button>
              </div>
            )}

            {selectedRequest.allocations?.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>Allocation, donor, laboratory, and dispatch traceability</caption>
                  <thead>
                    <tr>
                      <th scope="col">Unit</th>
                      <th scope="col">Donation</th>
                      {isStaff && <th scope="col">Donor / testing</th>}
                      <th scope="col">Allocation</th>
                      <th scope="col">Dispatch</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRequest.allocations.map((allocation) => (
                      <tr key={allocation.id}>
                        <td>
                          {allocation.bloodUnit.unitCode}<br />
                          {allocation.bloodUnit.unitStatus}
                          {isStaff && allocation.bloodUnit.currentStorageLocation && (
                            <div>Current storage: {allocation.bloodUnit.currentStorageLocation.name} ({allocation.bloodUnit.currentStorageLocation.code})</div>
                          )}
                          {isStaff && allocation.bloodUnit.movements?.map((movement) => (
                            <div key={movement.id}>
                              {movement.fromStorageLocation?.code || 'Outside storage'} → {movement.toStorageLocation?.code || 'Outside storage'} · {new Date(movement.movedAt).toLocaleString()}
                            </div>
                          ))}
                        </td>
                        <td>
                          {allocation.bloodUnit.donation.donationNumber}
                          {allocation.bloodUnit.donation.collectedAt && (
                            <div>Collected: {new Date(allocation.bloodUnit.donation.collectedAt).toLocaleString()}</div>
                          )}
                          {isStaff && allocation.bloodUnit.donation.collectedBy && (
                            <div>Collector: {allocation.bloodUnit.donation.collectedBy.employeeNumber}</div>
                          )}
                        </td>
                        {isStaff && (
                          <td>
                            {allocation.bloodUnit.donation.donor?.donorNumber || '—'}
                            {allocation.bloodUnit.laboratoryTests?.map((labTest) => (
                              <div key={labTest.id}>
                                {labTest.testType}: {labTest.testStatus} / {labTest.reviewStatus}
                                {labTest.resultCode ? ` · ${labTest.resultCode}` : ''}
                                {labTest.performedBy ? ` · tested by ${labTest.performedBy.employeeNumber}` : ''}
                                {labTest.reviewedBy ? ` · reviewed by ${labTest.reviewedBy.employeeNumber}` : ''}
                              </div>
                            ))}
                          </td>
                        )}
                        <td>{allocation.allocationStatus}</td>
                        <td>
                          {allocation.dispatch ? (
                            <>
                              {allocation.dispatch.deliveryStatus}{allocation.dispatch.finalDisposition ? ` · ${allocation.dispatch.finalDisposition}` : ''}
                              {allocation.dispatch.statusHistory?.map((entry) => (
                                <div key={entry.id}>
                                  {entry.newStatus} · {new Date(entry.changedAt).toLocaleString()} · {entry.changedBy.displayName}
                                </div>
                              ))}
                            </>
                          ) : 'Not dispatched'}
                        </td>
                        <td>
                          {isStaff && allocation.allocationStatus === 'reserved' && !allocation.dispatch && (
                            <Button variant="secondary" disabled={busy} onClick={() => dispatchAllocation(allocation.id)}>Dispatch</Button>
                          )}
                          {isStaff && allocation.dispatch?.deliveryStatus === 'dispatched' && (
                            <div className="request-actions">
                              {Object.entries(terminalStatuses).map(([status, values]) => (
                                <Button
                                  key={status}
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => setDispatchOutcome(allocation.dispatch, status, values[0])}
                                >
                                  Mark {status}
                                </Button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedRequest.statusHistory?.length > 0 && (
              <ol className="request-history">
                {selectedRequest.statusHistory.map((entry) => (
                  <li key={entry.id}>
                    <strong>{formatStatus(entry.newStatus)}</strong>
                    <span>{new Date(entry.changedAt).toLocaleString()} · {entry.changedBy.displayName}</span>
                    {entry.note && <p>{entry.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}
      </PageContainer>
    </AppLayout>
  );
}

export default BloodRequestsPage;
