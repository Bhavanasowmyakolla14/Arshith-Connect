import { useState, useEffect } from 'react';
import { Settings, Building2, Clock, ShieldAlert, Calendar, Bell, Save, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { AsyncButton, Loading, Notice, PageHeader, Panel } from '../components/ui.jsx';

const daysOfWeek = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await api('/settings');
        setSettings(res.settings);
      } catch (err) {
        setError(err.message || 'Failed to load settings.');
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api('/settings', {
        method: 'PATCH',
        body: settings,
      });
      setSettings(res.settings);
      setSuccess('Platform settings have been updated successfully.');
    } catch (err) {
      setError(err.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  }

  function toggleWorkday(d) {
    const current = settings.workdays || [];
    const next = current.includes(d) ? current.filter(x => x !== d) : [...current, d].sort();
    setSettings({ ...settings, workdays: next });
  }

  if (loading) return <Loading label="Loading settings…" />;

  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Platform Settings & Policies"
        description="Configure organization details, working schedules, attendance rules, and leave categories."
      />

      <Notice>{error}</Notice>
      {success && <Notice tone="success"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} />{success}</span></Notice>}

      <form onSubmit={handleSave} className="stack-form">
        {/* Organization & Branding */}
        <Panel title="Platform & Organization" icon={Building2}>
          <div className="form-grid">
            <label className="field">
              <span>Platform Name</span>
              <input
                type="text"
                value={settings.platform_name || ''}
                onChange={e => setSettings({ ...settings, platform_name: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input
                type="text"
                value={settings.tagline || ''}
                onChange={e => setSettings({ ...settings, tagline: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Organization Name</span>
              <input
                type="text"
                value={settings.organization_name || ''}
                onChange={e => setSettings({ ...settings, organization_name: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Official Email</span>
              <input
                type="email"
                value={settings.official_email || ''}
                onChange={e => setSettings({ ...settings, official_email: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Contact Number</span>
              <input
                type="text"
                value={settings.contact_number || ''}
                onChange={e => setSettings({ ...settings, contact_number: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Website</span>
              <input
                type="url"
                value={settings.website || ''}
                onChange={e => setSettings({ ...settings, website: e.target.value })}
              />
            </label>
            <label className="field full-width">
              <span>Office Address</span>
              <input
                type="text"
                value={settings.office_address || ''}
                onChange={e => setSettings({ ...settings, office_address: e.target.value })}
              />
            </label>
          </div>
        </Panel>

        {/* Schedule & Working Hours */}
        <Panel title="Working Schedule & Time Zone" icon={Clock}>
          <div className="form-grid">
            <label className="field">
              <span>Daily Work Start</span>
              <input
                type="time"
                value={settings.work_start || '09:00'}
                onChange={e => setSettings({ ...settings, work_start: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Daily Work End</span>
              <input
                type="time"
                value={settings.work_end || '18:00'}
                onChange={e => setSettings({ ...settings, work_end: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Time Zone</span>
              <select
                value={settings.time_zone || 'Asia/Kolkata'}
                onChange={e => setSettings({ ...settings, time_zone: e.target.value })}
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                <option value="UTC">UTC (+0:00)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST +4:00)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT +8:00)</option>
              </select>
            </label>
            <div className="field full-width">
              <span>Standard Working Days</span>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                {daysOfWeek.map(({ day, label }) => {
                  const active = (settings.workdays || []).includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleWorkday(day)}
                      className={`button ${active ? 'button-primary' : 'button-outline'}`}
                      style={{ minWidth: 54, padding: '8px 12px' }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>

        {/* Attendance Rules */}
        <Panel title="Attendance & Verification Rules" icon={ShieldAlert}>
          <div className="form-grid">
            <label className="field">
              <span>Late Arrival Grace Period (Minutes)</span>
              <input
                type="number"
                min="0"
                max="120"
                value={settings.late_threshold_minutes ?? 15}
                onChange={e => setSettings({ ...settings, late_threshold_minutes: Number(e.target.value) })}
                required
              />
            </label>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.selfie_required)}
                  onChange={e => setSettings({ ...settings, selfie_required: e.target.checked })}
                />
                <span style={{ fontWeight: 600 }}>Require Selfie Verification on Check-in</span>
              </label>
              <small style={{ color: '#64748b', marginTop: 4 }}>
                Captures a photo via employee camera before allowing check-in.
              </small>
            </div>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.allow_remote)}
                  onChange={e => setSettings({ ...settings, allow_remote: e.target.checked })}
                />
                <span style={{ fontWeight: 600 }}>Allow Remote / Work-from-Home Option</span>
              </label>
              <small style={{ color: '#64748b', marginTop: 4 }}>
                Enables employees to select Work from Home mode during check-in.
              </small>
            </div>
          </div>
        </Panel>

        {/* Leave Categories */}
        <Panel title="Leave Categories" icon={Calendar}>
          <div className="field full-width">
            <span>Configured Leave Types</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {(settings.leave_categories || []).map((cat, idx) => (
                <span
                  key={idx}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid #bfdbfe'
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
            <small style={{ color: '#64748b', marginTop: 8, display: 'block' }}>
              Standard categories recognized across leave requests and calendar calculations.
            </small>
          </div>
        </Panel>

        {/* Notification Preferences */}
        <Panel title="Platform Notification Preferences" icon={Bell}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.notifications?.announcements ?? true}
                onChange={e => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, announcements: e.target.checked }
                })}
              />
              <span>New Announcement Alerts</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.notifications?.leave_decisions ?? true}
                onChange={e => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, leave_decisions: e.target.checked }
                })}
              />
              <span>Leave Application Updates</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.notifications?.assignments ?? true}
                onChange={e => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, assignments: e.target.checked }
                })}
              />
              <span>Task Assignments</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.notifications?.meetings ?? true}
                onChange={e => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, meetings: e.target.checked }
                })}
              />
              <span>Meeting Reminders</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.notifications?.hourly_reminders ?? true}
                onChange={e => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, hourly_reminders: e.target.checked }
                })}
              />
              <span>Hourly Work Reminders</span>
            </label>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <AsyncButton
            type="submit"
            className="button button-primary"
            busy={saving}
            style={{ minWidth: 160, padding: '12px 24px', fontSize: 14 }}
          >
            <Save size={16} /> Save Changes
          </AsyncButton>
        </div>
      </form>
    </div>
  );
}
