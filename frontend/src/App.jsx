import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, User, LogOut, Menu, Settings } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { ProfileAvatar } from './components/Sidebar.jsx';
import Sidebar from './components/Sidebar.jsx';
import LoginPage from './components/LoginPage.jsx';
import PasswordSetupPage from './components/PasswordSetupPage.jsx';
import NotificationCenter from './components/NotificationCenter.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
import AnnouncementsPage from './pages/AnnouncementsPage.jsx';
import MeetingsPage from './pages/MeetingsPage.jsx';
import AssignmentsPage from './pages/AssignmentsPage.jsx';
import HourlyUpdatesPage from './pages/HourlyUpdatesPage.jsx';
import LeavesPage from './pages/LeavesPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import { Notice } from './components/ui.jsx';

const titles = {
  dashboard: 'Overview',
  employees: 'Employees',
  attendance: 'Attendance',
  sessions: 'Login history',
  announcements: 'Announcements',
  meetings: 'Meetings',
  assignments: 'Assignments',
  hourly: 'Hourly updates',
  leaves: 'Leave management',
  reports: 'Reports & Analytics',
  settings: 'Settings',
  profile: 'My profile',
  chat: 'Internal Chat',
};

export default function App() {
  const { user, profile, loading, logout, trackingWarning } = useAuth();
  const [page, setPage] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [passwordFlow, setPasswordFlow] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const flow = params.get('type') || new URLSearchParams(window.location.search).get('type');
    return flow === 'invite' || flow === 'recovery';
  });
  const [logoutMessage, setLogoutMessage] = useState('');
  const profileMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    }
    if (profileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileDropdownOpen]);

  if (loading) {
    return (
      <div className="app-loading">
        <span className="brand-mark">AC</span>
        <div>
          <strong>ARSHITH CONNECT</strong>
          <small style={{ display: 'block', color: '#64748b', fontSize: 11 }}>One Platform. Every Connection.</small>
        </div>
      </div>
    );
  }

  if (!user || !profile) return <LoginPage />;
  if (passwordFlow || profile.must_change_password) {
    return <PasswordSetupPage onComplete={() => setPasswordFlow(false)} />;
  }

  const content = {
    dashboard: <DashboardPage onNavigate={setPage} />,
    employees: <EmployeesPage />,
    attendance: <AttendancePage />,
    sessions: <SessionsPage />,
    announcements: <AnnouncementsPage />,
    meetings: <MeetingsPage />,
    assignments: <AssignmentsPage />,
    hourly: <HourlyUpdatesPage />,
    leaves: <LeavesPage />,
    reports: profile.role === 'admin' ? <ReportsPage /> : <DashboardPage onNavigate={setPage} />,
    settings: profile.role === 'admin' ? <SettingsPage /> : <DashboardPage onNavigate={setPage} />,
    profile: <ProfilePage />,
    chat: <ChatPage />,
  }[page] || <DashboardPage onNavigate={setPage} />;

  async function handleLogout() {
    setLogoutMessage('');
    try {
      await logout();
    } catch (error) {
      setLogoutMessage(error.message);
    }
  }

  // Quick navigation search handler
  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return;
      if (q.includes('att') || q.includes('check')) setPage('attendance');
      else if (q.includes('emp') || q.includes('staff')) setPage('employees');
      else if (q.includes('leave') || q.includes('vacation')) setPage('leaves');
      else if (q.includes('task') || q.includes('assign')) setPage('assignments');
      else if (q.includes('chat') || q.includes('message')) setPage('chat');
      else if (q.includes('meet') || q.includes('cal')) setPage('meetings');
      else if (q.includes('hour') || q.includes('update')) setPage('hourly');
      else if (q.includes('rep') || q.includes('stat')) setPage('reports');
      else if (q.includes('set') || q.includes('conf')) setPage('settings');
      else if (q.includes('ann') || q.includes('news')) setPage('announcements');
      else if (q.includes('prof') || q.includes('user')) setPage('profile');
      setSearchQuery('');
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'shell-collapsed' : ''}`}>
      <Sidebar
        role={profile.role}
        selected={page}
        onSelect={setPage}
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label="Toggle menu"
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>ARSHITH CONNECT</span>
              <span className="crumb-slash">/</span>
              <strong>{titles[page] || 'Overview'}</strong>
            </div>
          </div>

          {/* Quick Search */}
          <div className="topbar-search">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              placeholder="Jump to page (e.g. attendance, leaves, chat)…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          <div className="topbar-right">
            {/* Centralized Notification Center */}
            <NotificationCenter onNavigate={setPage} />

            <span className="topbar-divider" />

            {/* Profile Dropdown */}
            <div className="profile-menu-wrapper" ref={profileMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="account-menu"
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                aria-label="Open profile menu"
              >
                <ProfileAvatar name={profile.full_name} />
                <span className="account-meta">
                  <strong>{profile.full_name || 'Team Member'}</strong>
                  <small>{profile.role === 'admin' ? 'Administrator' : profile.job_title || 'Employee'}</small>
                </span>
                <ChevronDown size={14} />
              </button>

              {profileDropdownOpen && (
                <div className="profile-dropdown-menu">
                  <div className="profile-dropdown-header">
                    <strong>{profile.full_name || 'User'}</strong>
                    <small>{profile.email}</small>
                  </div>
                  <div className="profile-dropdown-divider" />
                  <button
                    type="button"
                    className="profile-dropdown-item"
                    onClick={() => { setPage('profile'); setProfileDropdownOpen(false); }}
                  >
                    <User size={15} /> My Profile
                  </button>
                  {profile.role === 'admin' && (
                    <button
                      type="button"
                      className="profile-dropdown-item"
                      onClick={() => { setPage('settings'); setProfileDropdownOpen(false); }}
                    >
                      <Settings size={15} /> Platform Settings
                    </button>
                  )}
                  <div className="profile-dropdown-divider" />
                  <button
                    type="button"
                    className="profile-dropdown-item text-danger"
                    onClick={() => { setProfileDropdownOpen(false); handleLogout(); }}
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="page-content">
          <Notice>{logoutMessage}</Notice>
          <Notice>{trackingWarning}</Notice>
          {content}
        </main>

        <footer className="app-footer">
          <span><strong>ARSHITH CONNECT</strong> — One Platform. Every Connection.</span>
          <span>Enterprise Employee Management &amp; Workplace Portal</span>
        </footer>
      </div>
    </div>
  );
}
