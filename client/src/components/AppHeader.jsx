import Breadcrumbs from './Breadcrumbs.jsx';
import StatusIndicator from './StatusIndicator.jsx';
import Button from './Button.jsx';

function AppHeader({ breadcrumbs, apiState, userName, onLogout, logoutError }) {
  const apiLabel = {
    checking: 'Checking API',
    online: 'API online',
    offline: 'API unavailable',
  }[apiState] || 'API unavailable';

  return (
    <header className="topbar">
      <Breadcrumbs items={breadcrumbs} />
      <div className="topbar-status">
        <StatusIndicator state={apiState} label={apiLabel} />
        <span className="topbar-divider" aria-hidden="true" />
        <span className="workspace-label">{userName || 'Administration'}</span>
        {logoutError && <span className="logout-error" role="alert">{logoutError}</span>}
        <Button variant="quiet" className="sign-out-button" onClick={onLogout}>Sign out</Button>
      </div>
    </header>
  );
}

export default AppHeader;
