import AppHeader from './AppHeader.jsx';
import AppSidebar from './AppSidebar.jsx';

function AppLayout({ apiState, breadcrumbs, userName, onLogout, logoutError, children }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppSidebar />
      <div className="app-main">
        <AppHeader
          apiState={apiState}
          breadcrumbs={breadcrumbs}
          userName={userName}
          onLogout={onLogout}
          logoutError={logoutError}
        />
        {children}
      </div>
    </div>
  );
}

export default AppLayout;
