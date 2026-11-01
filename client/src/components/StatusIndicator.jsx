const statusLabels = {
  checking: 'Checking',
  online: 'Available',
  offline: 'Unavailable',
};

function StatusIndicator({ state, label }) {
  const safeState = Object.hasOwn(statusLabels, state) ? state : 'offline';

  return (
    <span className={`status-indicator status-${safeState}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {label || statusLabels[safeState]}
    </span>
  );
}

export default StatusIndicator;
