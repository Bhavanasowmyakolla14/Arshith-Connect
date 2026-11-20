import { useState } from 'react';
import {
  Activity, Bell, BriefcaseBusiness, CalendarDays, ClipboardCheck, Clock3,
  LayoutDashboard, LogOut, Users, UserRound, CalendarClock, MessageCircle,
  Settings, ChevronLeft, ChevronRight, Menu,
} from 'lucide-react';

const employeeLinks = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'announcements', label: 'Announcements', icon: Bell },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays },
  { id: 'assignments', label: 'Assignments', icon: BriefcaseBusiness },
  { id: 'hourly', label: 'Hourly updates', icon: Clock3 },
  { id: 'leaves', label: 'Leave management', icon: CalendarClock },
  { id: 'profile', label: 'My profile', icon: UserRound },
];

const adminLinks = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'sessions', label: 'Login history', icon: Activity },
  { id: 'announcements', label: 'Announcements', icon: Bell },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays },
  { id: 'assignments', label: 'Assignments', icon: BriefcaseBusiness },
  { id: 'hourly', label: 'Hourly updates', icon: Clock3 },
  { id: 'leaves', label: 'Leave management', icon: CalendarClock },
  { id: 'reports', label: 'Reports', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'profile', label: 'My profile', icon: UserRound },
];

export default function Sidebar({ role, selected, onSelect, onLogout, collapsed, onToggleCollapse }) {
  const links = role === 'admin' ? adminLinks : employeeLinks;

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand-row">
        <a className="brand" href="#" onClick={event => { event.preventDefault(); onSelect('dashboard'); }}>
          <span className="brand-mark">AC</span>
          {!collapsed && (
            <span>
              <strong>ARSHITH CONNECT</strong>
              <small>One Platform. Every Connection.</small>
            </span>
          )}
        </a>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {!collapsed && <div className="workspace-label">WORKSPACE</div>}

      <nav className="side-nav">
        {links.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item ${selected === id ? 'active' : ''}`}
            onClick={() => onSelect(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} strokeWidth={1.8} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {!collapsed && (
          <div className="security-note">
            <span className="security-dot" />Secure Workspace
          </div>
        )}
        <button
          type="button"
          className="nav-item logout-link"
          onClick={onLogout}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={18} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

export function ProfileAvatar({ name = 'Employee', size = 'normal' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <span className={`avatar avatar-${size}`}>{initials || <UserRound size={16} />}</span>;
}
