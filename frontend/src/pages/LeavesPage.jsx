import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import { api, formatDate } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

const leaveTypes = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Other'];

export default function LeavesPage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [applications, setApplications] = useState([]);
  const [form, setForm] = useState({ leaveType: 'Casual Leave', startsOn: '', endsOn: '', reason: '' });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = filter ? `?status=${filter}` : '';
      setApplications((await api(`/leaves${params}`)).applications);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function apply(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await api('/leaves', { method: 'POST', body: form });
      setForm({ leaveType: 'Casual Leave', startsOn: '', endsOn: '', reason: '' });
      setSuccess('Your leave application has been submitted.'); await load();
    } catch (applyError) { setError(applyError.message); }
    finally { setBusy(false); }
  }

  async function review(application, status) {
    const reviewNote = window.prompt(`Optional note for ${status} leave`, application.review_note || '');
    if (reviewNote === null) return;
    setReviewingId(application.id);
    setError(''); setSuccess('');
    try {
      await api(`/leaves/${application.id}/review`, { method: 'PATCH', body: { status, reviewNote } });
      setSuccess(`Leave application ${status}.`); await load();
    } catch (reviewError) { setError(reviewError.message); }
    finally { setReviewingId(''); }
  }

  return <div>
    <PageHeader eyebrow="TIME AWAY" title="Leave management" description={admin ? 'Review employee leave requests and keep decisions visible.' : 'Request time away and follow the status of your applications.'} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    <div className={admin ? '' : 'leave-layout'}>
      {!admin && <Panel title="Apply for leave" className="leave-form-panel">
        <p className="panel-intro">Submit your dates and a short reason for your manager to review.</p>
        <form className="stack-form" onSubmit={apply}>
          <label className="field"><span>Leave type</span><select value={form.leaveType} onChange={event => setForm({ ...form, leaveType: event.target.value })}>
            {leaveTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>
          <div className="form-two"><Field label="Start date" type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} required />
            <Field label="End date" type="date" value={form.endsOn} onChange={event => setForm({ ...form, endsOn: event.target.value })} required /></div>
          <Field as="textarea" label="Reason" rows={4} placeholder="Share any context your manager should know…" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} required />
          <AsyncButton className="button button-primary" type="submit" busy={busy}><CalendarClock size={16} />Submit application</AsyncButton>
        </form>
      </Panel>}
      <Panel title={admin ? 'Leave applications' : 'Your applications'} action={admin ? <select className="inline-select" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
      </select> : <span className="count-pill">{applications.length} requests</span>}>
        {loading ? <Loading /> : applications.length ? <div className="leave-list">{applications.map(application => <article className="leave-card" key={application.id}>
          <div className="leave-card-head"><span className="leave-type-icon"><CalendarClock size={18} /></span><div><strong>{admin ? application.profiles?.full_name : application.leave_type}</strong>
            <small>{admin ? `${application.leave_type} · ${application.profiles?.department || application.profiles?.email}` : `${formatDate(application.starts_on)} – ${formatDate(application.ends_on)}`}</small>
          </div><StatusBadge tone={application.status}>{application.status}</StatusBadge></div>
          {admin && <div className="leave-date-range">{formatDate(application.starts_on)} – {formatDate(application.ends_on)}</div>}
          <p className="leave-reason">{application.reason}</p>
          {application.review_note && <div className="review-note"><strong>Review note</strong><p>{application.review_note}</p></div>}
          {admin && application.status === 'pending' && <div className="review-actions">
            <AsyncButton className="button button-outline button-small approve-button" busy={reviewingId === application.id} onClick={() => review(application, 'approved')}><Check size={14} />Approve</AsyncButton>
            <AsyncButton className="button button-outline button-small reject-button" busy={reviewingId === application.id} onClick={() => review(application, 'rejected')}><X size={14} />Decline</AsyncButton>
          </div>}
          <small className="application-date">Submitted {formatDate(application.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </article>)}</div> : <EmptyState title="No leave applications" message={admin ? 'Employee leave requests will appear here.' : 'You have not requested any leave yet.'} />}
      </Panel>
    </div>
  </div>;
}
