import { useCallback, useEffect, useMemo, useState } from 'react';
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

const initialForm = {
  bloodUnitId: '',
  testType: '',
  testStatus: 'pending',
  resultCode: '',
  performedAt: '',
  performedByStaffId: '',
};

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function LaboratoryPage() {
  const { user, logout } = useAuth();
  const isAdministrator = user.roles.includes('ADMIN');
  const [apiState, setApiState] = useState('checking');
  const [units, setUnits] = useState([]);
  const [tests, setTests] = useState([]);
  const [staff, setStaff] = useState([]);
  const [currentStaffId, setCurrentStaffId] = useState('');
  const [requiredTestTypes, setRequiredTestTypes] = useState([]);
  const [values, setValues] = useState({ ...initialForm, performedAt: localDateTime() });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoutError, setLogoutError] = useState('');

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [unitResult, testResult] = await Promise.all([
        managementRequest('/api/blood-units?page=1&pageSize=100'),
        managementRequest('/api/laboratory-tests?page=1&pageSize=100'),
      ]);
      setUnits(unitResult.units);
      setRequiredTestTypes(unitResult.requiredTestTypes);
      setTests(testResult.tests);
      setApiState('online');
    } catch (requestError) {
      setError(requestError.message);
      setApiState('offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      managementRequest('/api/auth/me'),
      ...(isAdministrator ? [managementRequest('/api/staff?status=active&pageSize=100')] : []),
    ])
      .then(([session, staffResult]) => {
        if (isAdministrator) {
          setStaff(staffResult.staff);
        } else if (session.user.staffId) {
          setCurrentStaffId(session.user.staffId);
          setStaff([{ id: session.user.staffId, employeeNumber: 'Your staff profile' }]);
          setValues((current) => ({ ...current, performedByStaffId: session.user.staffId }));
        }
      })
      .catch((requestError) => setError(requestError.message));
  }, [isAdministrator]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        setApiState('online');
      })
      .catch(() => setApiState('offline'));
  }, []);

  const quarantinedUnits = useMemo(
    () => units.filter((unit) => unit.unitStatus === 'quarantined'),
    [units],
  );

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await managementRequest('/api/laboratory-tests', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          performedAt: new Date(values.performedAt).toISOString(),
          resultCode: values.resultCode || null,
        }),
      });
      setValues((current) => ({
        ...initialForm,
        performedAt: localDateTime(),
        performedByStaffId: current.performedByStaffId,
      }));
      setSuccess('Laboratory test recorded. It remains pending review.');
      await loadWorkflow();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function reviewTest(test, reviewStatus) {
    setError('');
    setSuccess('');
    try {
      const reviewer = isAdministrator
        ? staff.find((member) => member.hospitalId === test.donation.hospital.id)
        : null;
      const reviewedByStaffId = reviewer?.id || currentStaffId;
      await managementRequest(`/api/laboratory-tests/${test.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          reviewStatus,
          ...(reviewedByStaffId ? { reviewedByStaffId } : {}),
        }),
      });
      setSuccess(`Test review recorded: ${reviewStatus}.`);
      await loadWorkflow();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function releaseUnit(id) {
    setError('');
    setSuccess('');
    try {
      await managementRequest(`/api/blood-units/${id}/release`, { method: 'POST' });
      setSuccess('Unit released under the configured test requirements.');
      await loadWorkflow();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch (requestError) {
      setLogoutError(requestError.message);
    }
  }

  const testColumns = [
    { key: 'unit', header: 'Blood unit', render: (row) => row.bloodUnit?.unitCode || 'Legacy donation-level test' },
    { key: 'testType', header: 'Test type' },
    { key: 'testStatus', header: 'Result status' },
    { key: 'resultCode', header: 'Result code', render: (row) => row.resultCode || '—' },
    { key: 'performedAt', header: 'Performed', render: (row) => row.performedAt ? new Date(row.performedAt).toLocaleString() : '—' },
    { key: 'reviewStatus', header: 'Review' },
    {
      key: 'actions',
      header: 'Review action',
      render: (row) => row.reviewStatus === 'pending'
        ? (
          <div className="workflow-row-actions">
            <Button variant="secondary" onClick={() => reviewTest(row, 'approved')} disabled={row.testStatus !== 'completed'}>Approve</Button>
            <Button variant="quiet" onClick={() => reviewTest(row, 'rejected')}>Reject</Button>
          </div>
        )
        : 'Final',
    },
  ];

  const unitColumns = [
    { key: 'unitCode', header: 'Blood-unit ID' },
    { key: 'donation', header: 'Donation', render: (row) => row.donation.donationNumber },
    { key: 'componentType', header: 'Component' },
    { key: 'unitStatus', header: 'Status' },
    {
      key: 'release',
      header: 'Release',
      render: (row) => row.unitStatus === 'quarantined'
        ? <Button variant="secondary" onClick={() => releaseUnit(row.id)}>Check and release</Button>
        : 'Not available',
    },
  ];

  const testTypeHelp = requiredTestTypes.length
    ? `Configured release checks: ${requiredTestTypes.join(', ')}. These are configuration values, not clinical advice.`
    : 'No required test types are configured. Release will remain blocked.';

  return (
    <AppLayout
      apiState={apiState}
      breadcrumbs={[{ label: 'Overview', href: '/overview' }, { label: 'Laboratory' }]}
      userName={user.displayName}
      onLogout={signOut}
      logoutError={logoutError}
    >
      <PageContainer
        id="laboratory"
        eyebrow="UNIT TESTING AND REVIEW"
        title="Laboratory"
        description="Record unit-level results, review them, and release units only when all configured checks pass."
      >
        {error && <ErrorMessage title="Laboratory workflow needs attention">{error}</ErrorMessage>}
        {success && <p className="workflow-success" role="status">{success}</p>}

        <Panel title="Record a laboratory test" description="Test type and result codes follow your approved local procedures.">
          <form className="workflow-form" onSubmit={submit}>
            <div className="workflow-form-grid">
              <FormField
                label="Quarantined blood unit"
                as="select"
                value={values.bloodUnitId}
                onChange={(event) => update('bloodUnitId', event.target.value)}
                required
                options={[
                  { value: '', label: 'Select a unit' },
                  ...quarantinedUnits.map((unit) => ({
                    value: unit.id,
                    label: `${unit.unitCode} · ${unit.donation.donationNumber}`,
                  })),
                ]}
              />
              <FormField label="Test type" value={values.testType} onChange={(event) => update('testType', event.target.value.toUpperCase())} required maxLength={40} help={testTypeHelp} />
              <FormField
                label="Test status"
                as="select"
                value={values.testStatus}
                onChange={(event) => update('testStatus', event.target.value)}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'invalid', label: 'Invalid' },
                ]}
              />
              <FormField label="Result code" value={values.resultCode} onChange={(event) => update('resultCode', event.target.value)} maxLength={40} required={values.testStatus === 'completed'} />
              <FormField label="Performed date and time" type="datetime-local" value={values.performedAt} onChange={(event) => update('performedAt', event.target.value)} required />
              <FormField
                label="Responsible staff member"
                as="select"
                value={values.performedByStaffId}
                onChange={(event) => update('performedByStaffId', event.target.value)}
                required
                options={[
                  { value: '', label: 'Select staff member' },
                  ...staff.map((member) => ({
                    value: member.id,
                    label: member.employeeNumber || member.user?.displayName || 'Staff member',
                  })),
                ]}
              />
            </div>
            <div className="workflow-form-actions">
              <p className="form-help">Results are restricted to administrators and blood bank staff and are excluded from audit metadata.</p>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record test'}</Button>
            </div>
          </form>
        </Panel>

        <Panel title="Blood-unit inventory" description="Newly collected units remain quarantined. The server checks every release request.">
          {requiredTestTypes.length
            ? <p className="workflow-policy">Configured required types: <strong>{requiredTestTypes.join(', ')}</strong></p>
            : <ErrorMessage title="Release is not configured">Set BLOOD_UNIT_REQUIRED_TEST_TYPES in server/.env to approved local test type codes. No clinical protocol is assumed.</ErrorMessage>}
          {loading
            ? <LoadingIndicator label="Loading blood units" />
            : <DataTable caption="Blood-unit inventory and release controls" columns={unitColumns} rows={units} emptyState="No blood units have been recorded." />}
        </Panel>

        <Panel title="Laboratory history" description="Test attempts are retained; corrections require a new attempt rather than editing history.">
          {loading
            ? <LoadingIndicator label="Loading laboratory tests" />
            : <DataTable caption="Laboratory test history" columns={testColumns} rows={tests} emptyState="No laboratory tests have been recorded." />}
        </Panel>
      </PageContainer>
    </AppLayout>
  );
}

export default LaboratoryPage;
