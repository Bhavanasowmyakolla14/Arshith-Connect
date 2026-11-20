import { useState, useEffect, useRef } from 'react';
import { Bell, Check, CheckCheck, Calendar, BriefcaseBusiness, Clock3, CalendarDays, ExternalLink, X } from 'lucide-react';
import { api, formatDate, formatTime } from '../lib/api.js';

export default function NotificationCenter({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  async function fetchNotifications() {
    try {
      const data = await api('/notifications');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      console.warn('Could not load notifications:', err.message);
    }
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000); // Poll every 20s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleMarkRead(id, e) {
    if (e) e.stopPropagation();
    try {
      await api(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.warn('Error marking notification as read:', err.message);
    }
  }

  async function handleMarkAllRead() {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Error marking all notifications as read:', err.message);
    }
  }

  function handleNotificationClick(item) {
    handleMarkRead(item.id);
    setOpen(false);
    if (item.link && onNavigate) {
      onNavigate(item.link);
    }
  }

  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications;

  const getTypeIcon = (type) => {
    switch (type) {
      case 'announcement': return <Bell size={16} className="notif-icon-blue" />;
      case 'meeting': return <Calendar size={16} className="notif-icon-cyan" />;
      case 'leave': return <CalendarDays size={16} className="notif-icon-amber" />;
      case 'assignment': return <BriefcaseBusiness size={16} className="notif-icon-indigo" />;
      case 'hourly': return <Clock3 size={16} className="notif-icon-teal" />;
      default: return <Bell size={16} className="notif-icon-blue" />;
    }
  };

  return (
    <div className="notif-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`icon-button notif-bell-btn ${open ? 'active' : ''}`}
        aria-label="Open notifications"
        title="Notifications"
        onClick={() => setOpen(!open)}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>Notifications</strong>
              {unreadCount > 0 && <span className="notif-count-pill">{unreadCount} new</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="text-button notif-mark-all"
                  onClick={handleMarkAllRead}
                  title="Mark all as read"
                >
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
              <button
                type="button"
                className="notif-close-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="notif-filter-tabs">
            <button
              type="button"
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              className={filter === 'unread' ? 'active' : ''}
              onClick={() => setFilter('unread')}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="notif-list">
            {filtered.length === 0 ? (
              <div className="notif-empty">
                <Bell size={24} style={{ opacity: 0.3, marginBottom: 6 }} />
                <span>No {filter === 'unread' ? 'unread ' : ''}notifications</span>
              </div>
            ) : (
              filtered.map(item => (
                <div
                  key={item.id}
                  className={`notif-item ${!item.read ? 'unread' : ''}`}
                  onClick={() => handleNotificationClick(item)}
                >
                  <div className="notif-icon-box">
                    {getTypeIcon(item.type)}
                  </div>
                  <div className="notif-content">
                    <div className="notif-title-row">
                      <strong className="notif-title">{item.title}</strong>
                      <span className="notif-time">{formatTime(item.created_at)}</span>
                    </div>
                    <p className="notif-message">{item.message}</p>
                  </div>
                  {!item.read && (
                    <button
                      type="button"
                      className="notif-check-btn"
                      title="Mark as read"
                      onClick={(e) => handleMarkRead(item.id, e)}
                    >
                      <Check size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
