import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BellRing, Clock3, MessageSquareText, Send, TimerReset } from 'lucide-react';
import { api, formatDate, formatTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

const initialForm = { completedWork: '', currentTask: '', progress: '', pendingWork: '', blockers: '' };

function countdown(value) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function HourlyUpdatesPage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [updates, setUpdates] = useState([]);
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState({ employeeId: '', date: '' });
  const [employees, setEmployees] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [tick, setTick] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [feedback, setFeedback] = useState({});
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported',
  );
  const notifiedDeadline = useRef('');

  const load = useCallback(async () => {
    setError('');
    try {
      if (admin) {
        const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
        const [result, team, deadlines] = await Promise.all([
          api(`/hourly-updates?${params}`), api('/sessions/employees'), api('/hourly-updates/admin-status'),
        ]);
        setUpdates(result.updates); setEmployees(team.employees); setSchedule(deadlines.schedules);
      } else {
        const [result, dailyStatus] = await Promise.all([api('/hourly-updates'), api('/hourly-updates/status')]);
        setUpdates(result.updates); setStatus(dailyStatus);
      }
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [admin, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pendingCount = useMemo(() => schedule.reduce((total, entry) =>
    total + entry.slots.filter(slot => slot.status !== 'submitted').length, 0), [schedule]);
  const nextSlot = status?.slots?.find(slot => slot.status !== 'submitted');
  const isDue = nextSlot && new Date(nextSlot.deadline) <= tick;

  useEffect(() => {
    if (admin || !isDue || notificationPermission !== 'granted' || notifiedDeadline.current === nextSlot.deadline) return;
    new Notification('Arshith Connect · Work update due', {
      body: `Please submit your hourly update by ${formatTime(nextSlot.deadline)}.`,
    });
    notifiedDeadline.current = nextSlot.deadline;
  }, [admin, isDue, nextSlot, notificationPermission]);

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') setSuccess('Browser reminders are enabled for hourly updates.');
    else setError('Browser notification permission was not granted. The countdown will remain visible here.');
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await api('/hourly-updates', { method: 'POST', body: form });
      setForm(initialForm); setSuccess('Your work update has been submitted.'); await load();
    } catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  }

  async function addFeedback(update) {
    const comment = feedback[update.id]?.trim();
    if (!comment) return;
    setError('');
    try {
      await api(`/hourly-updates/${update.id}/feedback`, { method: 'POST', body: { comment } });
      setFeedback(current => ({ ...current, [update.id]: '' })); setSuccess('Feedback added.'); await load();
    } catch (feedbackError) { setError(feedbackError.message); }
  }

  return <div>
    <PageHeader eyebrow="STEADY PROGRESS" title="Hourly work updates" description={admin ? 'Review submitted updates and see which check-ins are due or overdue.' : 'A brief check-in each hour keeps your team in sync.'}
      action={!admin && notificationPermission !== 'granted' && notificationPermission !== 'unsupported'
        ? <button className="button button-outline" onClick={enableNotifications}><BellRing size={15} />Enable reminders</button> : null} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    {!admin && <div className="hourly-top-grid">
      <Panel className={`deadline-panel ${isDue ? 'deadline-overdue' : ''}`}>
        <div className="deadline-copy"><span className="deadline-icon"><TimerReset size={19} /></span>
          <span className="eyebrow">{status?.active ? 'NEXT UPDATE' : 'WORKDAY STATUS'}</span>
          <h2>{status?.active ? nextSlot ? isDue ? 'Your update is due' : 'Time for your next check-in' : 'All caught up for today' : 'Check in to begin'}</h2>
          <p>{status?.active ? nextSlot ? `Due by ${formatTime(nextSlot.deadline)}. Your work schedule pauses reminders outside work hours.` : 'No more hourly updates are scheduled for today.' : 'Hourly update reminders begin with your attendance check-in.'}</p>
        </div>
        {status?.active && nextSlot && <div className="countdown-block"><small>TIME LEFT</small><strong>{countdown(nextSlot.deadline)}</strong><StatusBadge tone={isDue ? 'overdue' : 'due'}>{isDue ? 'Overdue' : 'Due soon'}</StatusBadge></div>}
      </Panel>
      <Panel title="Today's update rhythm">
        <div className="slot-list">{status?.slots?.length ? status.slots.map(slot => <div className="slot-row" key={slot.index}>
          <span className={`slot-dot slot-${slot.status}`} />
          <span><strong>Update {slot.index}</strong><small>Due {formatTime(slot.deadline)}</small></span>
          <StatusBadge tone={slot.status}>{slot.status}</StatusBadge>
        </div>) : <div className="slot-empty"><Clock3 size={18} /><span>Your hourly timeline will appear after check-in.</span></div>}</div>
      </Panel>
    </div>}
    {!admin && <Panel title="Share a work update" className="composer-panel">
      <form className="hourly-form" onSubmit={submit}>
        <div className="form-two"><Field as="textarea" label="What work did you complete in the last hour?" rows={3} value={form.completedWork} onChange={event => setForm({ ...form, completedWork: event.target.value })} required />
          <Field as="textarea" label="What task are you currently working on?" rows={3} value={form.currentTask} onChange={event => setForm({ ...form, currentTask: event.target.value })} required /></div>
        <div className="form-two"><Field as="textarea" label="What is the progress?" rows={3} value={form.progress} onChange={event => setForm({ ...form, progress: event.target.value })} required />
          <Field as="textarea" label="What work is pending?" rows={3} value={form.pendingWork} onChange={event => setForm({ ...form, pendingWork: event.target.value })} required /></div>
        <Field as="textarea" label="Issues or blockers (optional)" rows={2} value={form.blockers} onChange={event => setForm({ ...form, blockers: event.target.value })} />
        <AsyncButton className="button button-primary" type="submit" busy={busy} disabled={!status?.active}><Send size={15} />Submit work update</AsyncButton>
        {!status?.active && <span className="form-hint">An active check-in is required before an update can be submitted.</span>}
      </form>
    </Panel>}
    {admin && <Panel title="Today's hourly schedule" action={<span className="count-pill">{pendingCount} due or overdue</span>}>
      {loading ? <Loading /> : schedule.length ? <div className="table-wrap"><table>
        <thead><tr><th>EMPLOYEE</th><th>DEADLINE</th><th>STATUS</th></tr></thead>
        <tbody>{schedule.flatMap(entry => entry.slots.filter(slot => slot.status !== 'submitted').map(slot => <tr key={`${entry.attendanceId}-${slot.index}`}>
          <td><strong>{entry.employee?.full_name}</strong><small>{entry.employee?.department || entry.employee?.email}</small></td>
          <td>{formatTime(slot.deadline)}</td><td><StatusBadge tone={slot.status}>{slot.status}</StatusBadge></td>
        </tr>))}</tbody>
      </table>
        {!pendingCount && <div className="all-clear"><CheckCircleIcon />All expected updates are submitted or no update is due yet.</div>}
      </div> : <EmptyState title="No active attendance today" message="Hourly deadlines appear once employees check in." />}
    </Panel>}
    <Panel title={admin ? 'Employee submissions' : 'Your previous updates'}>
      {admin && <div className="filter-bar">
        <label className="filter-label">Employee</label><select value={filters.employeeId} onChange={event => setFilters({ ...filters, employeeId: event.target.value })}>
          <option value="">All employees</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
        </select><input aria-label="Filter by date" type="date" value={filters.date} onChange={event => setFilters({ ...filters, date: event.target.value })} />
      </div>}
      {loading ? <Loading /> : updates.length ? <div className="hourly-update-list">{updates.map(update => <article className="hourly-update-card" key={update.id}>
        <div className="hourly-update-heading"><div className="update-avatar">{(update.profiles?.full_name || profile.full_name).slice(0, 1)}</div><div><strong>{admin ? update.profiles?.full_name : 'Your update'}</strong>
          <small>{formatDate(update.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div>
          {update.blockers && <StatusBadge tone="overdue"><AlertTriangle size={12} />Blocker</StatusBadge>}
        </div>
        <div className="hourly-answers"><div><strong>Completed</strong><p>{update.completed_work}</p></div><div><strong>Current task</strong><p>{update.current_task}</p></div>
          <div><strong>Progress</strong><p>{update.progress}</p></div><div><strong>Pending</strong><p>{update.pending_work}</p></div>
          {update.blockers && <div className="blocker-answer"><strong>Issues / blockers</strong><p>{update.blockers}</p></div>}
        </div>
        {update.hourly_update_feedback?.length > 0 && <div className="feedback-list">{update.hourly_update_feedback.map(item => <p key={item.id}><MessageSquareText size={14} />{item.comment}</p>)}</div>}
        {admin && <div className="feedback-form"><input placeholder="Add feedback for this employee…" value={feedback[update.id] || ''} onChange={event => setFeedback({ ...feedback, [update.id]: event.target.value })} />
          <button className="button button-outline button-small" disabled={!feedback[update.id]?.trim()} onClick={() => addFeedback(update)}>Add feedback</button></div>}
      </article>)}</div> : <EmptyState title="No updates submitted" message={admin ? 'Submitted work updates will be listed here.' : 'Your submitted updates will be kept here.'} />}
    </Panel>
  </div>;
}

function CheckCircleIcon() {
  return <span className="all-clear-icon">✓</span>;
}
