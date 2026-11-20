import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ExternalLink, MapPin, Pencil, Plus, ShieldCheck, X } from 'lucide-react';
import { api, formatDate, formatTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

const initialForm = { title: '', agenda: '', description: '', date: '', startsAt: '', endsAt: '', joinUrl: '', location: '', employeeIds: [] };

function TimeField({ label, value, onChange }) {
  const [selection, setSelection] = useState(() => {
    if (!value) return { hour: '', minute: '', meridiem: '' };
    const [hours, minutes] = value.split(':').map(Number);
    return {
      hour: String(hours % 12 || 12),
      minute: String(minutes).padStart(2, '0'),
      meridiem: hours >= 12 ? 'PM' : 'AM',
    };
  });

  useEffect(() => {
    if (!value) {
      setSelection({ hour: '', minute: '', meridiem: '' });
      return;
    }
    const [hours, minutes] = value.split(':').map(Number);
    setSelection({
      hour: String(hours % 12 || 12),
      minute: String(minutes).padStart(2, '0'),
      meridiem: hours >= 12 ? 'PM' : 'AM',
    });
  }, [value]);

  function update(field, fieldValue) {
    const next = { ...selection, [field]: fieldValue };
    setSelection(next);
    if (next.hour && next.minute !== '' && next.meridiem) {
      const hour24 = Number(next.hour) % 12 + (next.meridiem === 'PM' ? 12 : 0);
      onChange(`${String(hour24).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}`);
    }
  }

  return <div className="field">
    <span>{label}</span>
    <div className="form-three">
      <select aria-label={`${label} hour`} value={selection.hour} onChange={event => update('hour', event.target.value)} required>
        <option value="">Hour</option>
        {Array.from({ length: 12 }, (_, index) => index + 1).map(hour => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <select aria-label={`${label} minute`} value={selection.minute} onChange={event => update('minute', event.target.value)} required>
        <option value="">Minute</option>
        {Array.from({ length: 60 }, (_, minute) => minute).map(minute => <option key={minute} value={String(minute).padStart(2, '0')}>{String(minute).padStart(2, '0')}</option>)}
      </select>
      <select aria-label={`${label} AM or PM`} value={selection.meridiem} onChange={event => update('meridiem', event.target.value)} required>
        <option value="">AM/PM</option><option value="AM">AM</option><option value="PM">PM</option>
      </select>
    </div>
  </div>;
}

function meetingStatus(meeting, participant, now = Date.now()) {
  if (meeting.status === 'Cancelled' || meeting.cancelled_at) return 'Cancelled';
  if (meeting.status === 'Joined' || participant?.join_status === 'Joined' || participant?.joined_at) return 'Joined';
  if (meeting.status === 'Completed' || (meeting.ends_at && new Date(meeting.ends_at).getTime() < now)) return 'Completed';
  if (meeting.status === 'Yet to Join' || new Date(meeting.starts_at).getTime() <= now) return 'Yet to Join';
  return 'Upcoming';
}

export default function MeetingsPage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [meetings, setMeetings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [joiningMeetingId, setJoiningMeetingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setMeetings((await api('/meetings')).meetings);
      if (admin) setEmployees((await api('/sessions/employees')).employees);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [admin]);
  useEffect(() => { load(); }, [load]);

  async function schedule(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await api('/meetings', { method: 'POST', body: {
        title: form.title, agenda: form.agenda, description: form.description,
        meetingDate: form.date, startsAt: form.startsAt, endsAt: form.endsAt,
        joinUrl: form.joinUrl, location: form.location, employeeIds: form.employeeIds,
      } });
      setForm(initialForm); setSuccess('Meeting scheduled.'); await load();
    } catch (scheduleError) { setError(scheduleError.message); }
    finally { setBusy(false); }
  }

  async function cancel(meeting) {
    if (!window.confirm(`Cancel “${meeting.title}”?`)) return;
    setError('');
    try {
      await api(`/meetings/${meeting.id}`, { method: 'PATCH', body: { cancelled: true } });
      await load();
    } catch (cancelError) { setError(cancelError.message); }
  }

  async function editMeeting(meeting) {
    const title = window.prompt('Meeting title', meeting.title);
    if (title === null) return;
    const agenda = window.prompt('Meeting agenda', meeting.agenda || '');
    if (agenda === null) return;
    const date = window.prompt('Meeting date (YYYY-MM-DD)', meeting.meeting_date);
    if (date === null) return;
    const startsAt = window.prompt('Start time (1:30 PM)', formatTime(meeting.starts_at));
    if (startsAt === null) return;
    const endsAt = window.prompt('End time (1:30 PM)', formatTime(meeting.ends_at));
    if (endsAt === null) return;
    const parseTime = value => {
      const match = value.trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return null;
      const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
      return `${String(hour).padStart(2, '0')}:${match[2]}`;
    };
    const startTime = parseTime(startsAt);
    const endTime = parseTime(endsAt);
    if (!startTime || !endTime) {
      setError('Enter meeting times in 12-hour format, for example 1:30 PM.');
      return;
    }
    const joinUrl = window.prompt('Meeting link (leave blank for none)', meeting.join_url || '');
    if (joinUrl === null) return;
    const location = window.prompt('Office location (leave blank for none)', meeting.location || '');
    if (location === null) return;
    setError(''); setSuccess('');
    try {
      await api(`/meetings/${meeting.id}`, { method: 'PATCH', body: {
        title, agenda, meetingDate: date, startsAt: startTime, endsAt: endTime,
        joinUrl: joinUrl || null, location: location || null,
      } });
      setSuccess('Meeting updated.'); await load();
    } catch (editError) { setError(editError.message); }
  }

  async function verifyJoin(meeting, employee) {
    setError('');
    try {
      await api(`/meetings/${meeting.id}/participants/${employee.employee_id}/verified-join`, { method: 'POST', body: {} });
      setSuccess(`Verified attendance recorded for ${employee.profiles?.full_name || 'employee'}.`); await load();
    } catch (joinError) { setError(joinError.message); }
  }

  async function joinMeeting(meeting) {
    if (meeting.join_url) window.open(meeting.join_url, '_blank', 'noopener,noreferrer');
    setJoiningMeetingId(meeting.id);
    setError(''); setSuccess('');
    try {
      await api(`/meetings/${meeting.id}/join`, { method: 'POST', body: {} });
      setSuccess(`Your participation in “${meeting.title}” has been recorded.`);
      await load();
    } catch (joinError) { setError(joinError.message); }
    finally { setJoiningMeetingId(''); }
  }

  function toggleEmployee(id) {
    setForm(current => ({ ...current, employeeIds: current.employeeIds.includes(id)
      ? current.employeeIds.filter(item => item !== id) : [...current.employeeIds, id] }));
  }

  return <div>
    <PageHeader eyebrow="TEAM CALENDAR" title="Meetings" description={admin ? 'Plan the conversation. Keep the team aligned.' : 'See what is coming up and keep your day in view.'} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    {admin && <Panel title="Schedule a meeting" className="composer-panel">
      <form className="stack-form" onSubmit={schedule}>
        <div className="form-two"><Field label="Meeting title" placeholder="e.g. Weekly team sync" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required />
          <Field label="Meeting date" type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} required /></div>
        <div className="form-three"><TimeField label="Start time" value={form.startsAt} onChange={startsAt => setForm({ ...form, startsAt })} />
          <TimeField label="End time" value={form.endsAt} onChange={endsAt => setForm({ ...form, endsAt })} />
          <Field label="Meeting link" type="url" placeholder="https://" value={form.joinUrl} onChange={event => setForm({ ...form, joinUrl: event.target.value })} /></div>
        <div className="form-two"><Field label="Agenda" placeholder="Topics to cover" value={form.agenda} onChange={event => setForm({ ...form, agenda: event.target.value })} />
          <Field label="Office location (optional)" placeholder="Room or office" value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} /></div>
        <Field as="textarea" label="Description" rows={2} placeholder="Additional meeting context" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
        <div className="recipient-picker"><strong>Invite employees</strong><span>Leave unselected to include everyone.</span>
          <div className="recipient-list">{employees.filter(employee => employee.is_active !== false).map(employee => <label key={employee.id}><input type="checkbox" checked={form.employeeIds.includes(employee.id)} onChange={() => toggleEmployee(employee.id)} />{employee.full_name}</label>)}</div>
        </div>
        <AsyncButton className="button button-primary" type="submit" busy={busy}><Plus size={16} />Schedule meeting</AsyncButton>
      </form>
    </Panel>}
    <div className="meeting-grid">
      {loading ? <Panel><Loading /></Panel> : meetings.length ? meetings.map(meeting => {
        const participant = meeting.meeting_participants?.find(item => item.profile_id === profile.id);
        const status = meetingStatus(meeting, participant);
        return <Panel className={`meeting-card ${meeting.cancelled_at ? 'meeting-cancelled' : ''}`} key={meeting.id}>
          <div className="meeting-card-top"><div className="meeting-date-icon"><strong>{new Date(meeting.starts_at).getDate()}</strong><small>{new Date(meeting.starts_at).toLocaleDateString(undefined, { month: 'short' })}</small></div>
            <StatusBadge tone={status.toLowerCase().replaceAll(' ', '-')}>{status}</StatusBadge></div>
          <h3>{meeting.title}</h3>
          <p className="meeting-time"><CalendarDays size={15} />{formatDate(meeting.starts_at)} · {formatTime(meeting.starts_at)}–{formatTime(meeting.ends_at)}</p>
          {(meeting.agenda || meeting.description) && <div className="meeting-agenda"><strong>Agenda</strong><p>{meeting.agenda || meeting.description}</p></div>}
          {meeting.location && <div className="meeting-location"><MapPin size={14} />{meeting.location}</div>}
          {admin && <div className="meeting-participants">
            <strong>Attendance</strong>{meeting.meeting_participants?.length ? meeting.meeting_participants.map(person => <div key={person.employee_id} className="participant-line">
              <span>{person.profiles?.full_name || person.profiles?.email}</span>
              {person.joined_at ? <StatusBadge tone="completed">Joined {formatTime(person.joined_at)}</StatusBadge>
                : <button className="verify-button" onClick={() => verifyJoin(meeting, person)}><ShieldCheck size={13} />Verify join</button>}
            </div>) : <small>No participants listed.</small>}
          </div>}
          <div className="meeting-actions">
            {!admin && meeting.join_url && (status === 'Upcoming' || status === 'Yet to Join') && <AsyncButton className="button button-primary" busy={joiningMeetingId === meeting.id} onClick={() => joinMeeting(meeting)}>
              <ExternalLink size={15} />Join meeting
            </AsyncButton>}
            {admin && !meeting.cancelled_at && <><button className="button button-outline button-small" onClick={() => editMeeting(meeting)}><Pencil size={14} />Edit</button>
              <button className="button button-ghost button-small danger-quiet" onClick={() => cancel(meeting)}><X size={15} />Cancel</button></>}
          </div>
        </Panel>;
      }) : <Panel><EmptyState title="No meetings scheduled" message="New meetings will show here when they are added to the calendar." /></Panel>}
    </div>
    {!admin && <div className="info-note"><ShieldCheck size={16} /><span>Clicking Join Meeting records your participation time. An administrator may verify attendance separately.</span></div>}
  </div>;
}
