import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 3.5C12.8 8.5 7 14.2 7 20a9 9 0 1 0 18 0c0-5.8-5.8-11.5-9-16.5Z" />
        <path d="M12.1 21.3a4.2 4.2 0 0 0 4.2 4.2" />
      </svg>
    </span>
  );
}

function AppSidebar() {
  const { user } = useAuth();
  const isDonor = user.roles.includes('DONOR')
    && !user.roles.some((role) => ['ADMIN', 'STAFF', 'HOSPITAL'].includes(role));
  const isAdministrator = user.roles.includes('ADMIN');
  const isStaff = user.roles.some((role) => ['ADMIN', 'STAFF'].includes(role));
  const isHospitalUser = user.roles.includes('HOSPITAL') && !isStaff;

  return (
    <aside className="sidebar">
      <NavLink className="brand" to={isDonor ? '/donor-dashboard' : isHospitalUser ? '/hospital-dashboard' : '/overview'} aria-label="Hema, overview">
        <BrandMark />
        <span className="brand-copy">
          <strong>hema</strong>
          <span>Blood services</span>
        </span>
      </NavLink>

      <div className="sidebar-divider" />
      <p className="nav-caption">Workspace</p>
      <nav className="primary-navigation" aria-label="Main navigation">
        {isStaff && (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
            to="/overview"
            end
            aria-label="Overview"
            title="Overview"
          >
            <span className="nav-link-indicator" />
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 9.2 10 4l6.5 5.2v6.5a.8.8 0 0 1-.8.8h-4.1v-4.7H8.4v4.7H4.3a.8.8 0 0 1-.8-.8V9.2Z" />
            </svg>
            <span className="nav-link-label">Overview</span>
          </NavLink>
        )}
        {isStaff && (
          <>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/donations"
              aria-label="Donations"
              title="Donations"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 2.8c-2.2 3.2-5.5 6.7-5.5 10.1a5.5 5.5 0 0 0 11 0C15.5 9.5 12.2 6 10 2.8Z" />
                <path d="M7.5 13.3a2.5 2.5 0 0 0 2.5 2.5" />
              </svg>
              <span className="nav-link-label">Donations</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/laboratory"
              aria-label="Laboratory"
              title="Laboratory"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M7 3.5h6M8 3.5v5L4 15a1 1 0 0 0 .9 1.5h10.2A1 1 0 0 0 16 15l-4-6.5v-5M6.5 12h7" />
              </svg>
              <span className="nav-link-label">Laboratory</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/inventory"
              aria-label="Blood inventory"
              title="Blood inventory"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4.5h12v11H4zM7 4.5v-2h6v2M7 8h6M7 11h6M7 14h3" />
              </svg>
              <span className="nav-link-label">Inventory</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/reports"
              aria-label="Operational reports"
              title="Operational reports"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 16.5h12M5.5 14V9.5M10 14V4.5M14.5 14v-7" />
              </svg>
              <span className="nav-link-label">Reports</span>
            </NavLink>
          </>
        )}
        {isDonor ? (
          <>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/donor-dashboard"
              aria-label="Donor dashboard"
              title="Donor dashboard"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 9.2 10 4l6.5 5.2v6.5a.8.8 0 0 1-.8.8h-4.1v-4.7H8.4v4.7H4.3a.8.8 0 0 1-.8-.8V9.2Z" />
              </svg>
              <span className="nav-link-label">Dashboard</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/my-profile"
              aria-label="My donor profile"
              title="My donor profile"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="6.5" r="3" />
                <path d="M4.5 16.5c.6-2.6 2.5-4 5.5-4s4.9 1.4 5.5 4" />
              </svg>
              <span className="nav-link-label">My profile</span>
            </NavLink>
          </>
        ) : isStaff ? (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
            to="/donors"
            aria-label="Donors"
            title="Donors"
          >
            <span className="nav-link-indicator" />
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="2.6" />
              <path d="M2.8 15.8c.4-2.2 1.8-3.4 4.2-3.4 1.1 0 2 .3 2.7.8M12.5 5.2a2.4 2.4 0 1 1 0 4.8M11.5 13c.6-.4 1.3-.6 2.2-.6 2 0 3.2 1.1 3.5 3.4" />
            </svg>
            <span className="nav-link-label">Donors</span>
          </NavLink>
        ) : null}
        {isHospitalUser && (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
            to="/hospital-dashboard"
            aria-label="Hospital dashboard"
            title="Hospital dashboard"
          >
            <span className="nav-link-indicator" />
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 17V5.5h13V17M7 5.5V3h6v2.5M7 9h1.5M11.5 9H13M7 12h1.5M11.5 12H13M9 17v-2.5h2V17" />
            </svg>
            <span className="nav-link-label">Dashboard</span>
          </NavLink>
        )}
        {(isStaff || isHospitalUser) && (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
            to="/requests"
            aria-label="Blood requests"
            title="Blood requests"
          >
            <span className="nav-link-indicator" />
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 3.5h10v13H5zM7.5 7h5M7.5 10h5M7.5 13h3" />
            </svg>
            <span className="nav-link-label">Requests</span>
          </NavLink>
        )}
        {isAdministrator && (
          <>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/staff"
              aria-label="Staff management"
              title="Staff management"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.6" />
                <path d="M2.8 15.8c.4-2.2 1.8-3.4 4.2-3.4 1.1 0 2 .3 2.7.8M12.5 5.2a2.4 2.4 0 1 1 0 4.8M11.5 13c.6-.4 1.3-.6 2.2-.6 2 0 3.2 1.1 3.5 3.4" />
              </svg>
              <span className="nav-link-label">Staff</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-current' : ''}`}
              to="/hospitals"
              aria-label="Hospitals and clinics"
              title="Hospitals and clinics"
            >
              <span className="nav-link-indicator" />
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 17V5.5h13V17M7 5.5V3h6v2.5M7 9h1.5M11.5 9H13M7 12h1.5M11.5 12H13M9 17v-2.5h2V17" />
              </svg>
              <span className="nav-link-label">Hospitals</span>
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-note">
        <span className="sidebar-note-mark" aria-hidden="true">H</span>
        <p>Designed for careful, traceable blood bank operations.</p>
      </div>
      <div className="sidebar-footer">HEALTHCARE OPERATIONS</div>
    </aside>
  );
}

export default AppSidebar;
