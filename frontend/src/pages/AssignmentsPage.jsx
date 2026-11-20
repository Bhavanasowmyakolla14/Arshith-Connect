import { useCallback, useEffect, useState } from 'react';
import { BriefcaseBusiness, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatDate } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

const initialForm = { employeeId: '', title: '', description: '', instructions: '', priority: 'medium', startsOn: '', dueOn: '' };
const taskStates = ['pending', 'in_progress', 'completed'];

export default function AssignmentsPage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [updates, setUpdates] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setTasks((await api('/assignments')).assignments);
      if (admin) setEmployees((await api('/sessions/employees')).employees);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [admin]);
  useEffect(() => { load(); }, [load]);

  async function createTask(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await api('/assignments', { method: 'POST', body: { ...form, startsOn: form.startsOn || null, dueOn: form.dueOn || null } });
      setForm(initialForm); setSuccess('Assignment created.'); await load();
    } catch (createError) { setError(createError.message); }
    finally { setBusy(false); }
  }

  async function submitUpdate(task) {
    const update = updates[task.id] || { status: task.status, comment: '' };
    setUpdatingTaskId(task.id);
    setError(''); setSuccess('');
    try {
      await api(`/assignments/${task.id}/updates`, { method: 'POST', body: update });
      setUpdates(current => ({ ...current, [task.id]: { ...update, comment: '' } }));
      setSuccess(`Progress saved for “${task.title}”.`); await load();
    } catch (updateError) { setError(updateError.message); }
    finally { setUpdatingTaskId(''); }
  }

  async function editTask(task) {
    const title = window.prompt('Edit assignment title', task.title);
    if (title === null) return;
    const description = window.prompt('Edit task description', task.description || '');
    if (description === null) return;
    setError('');
    try {
      await api(`/assignments/${task.id}`, { method: 'PATCH', body: { title, description } });
      setSuccess('Assignment updated.'); await load();
    } catch (editError) { setError(editError.message); }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}” and its progress history?`)) return;
    setError('');
    try {
      await api(`/assignments/${task.id}`, { method: 'DELETE' });
      setTasks(current => current.filter(item => item.id !== task.id));
      setSuccess('Assignment deleted.');
    } catch (deleteError) { setError(deleteError.message); }
  }

  return <div>
    <PageHeader eyebrow="FOCUSED WORK" title="Assignments" description={admin ? 'Create clear work, set priorities, and follow progress.' : 'Your work, priorities, and progress in one place.'} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    {admin && <Panel title="Create an assignment" className="composer-panel">
      <form className="stack-form" onSubmit={createTask}>
        <div className="form-two"><Field label="Task title" placeholder="What needs to be done?" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required />
          <label className="field"><span>Assign to</span><select value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })} required>
            <option value="">Select an employee</option>{employees.filter(employee => employee.is_active !== false).map(employee => <option value={employee.id} key={employee.id}>{employee.full_name}</option>)}
          </select></label></div>
        <div className="form-two"><Field as="textarea" label="Description" rows={3} placeholder="What is the outcome?" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
          <Field as="textarea" label="Instructions" rows={3} placeholder="Helpful steps or context" value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} /></div>
        <div className="form-three"><label className="field"><span>Priority</span><select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select></label><Field label="Start date" type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} />
          <Field label="Due date" type="date" value={form.dueOn} onChange={event => setForm({ ...form, dueOn: event.target.value })} /></div>
        <AsyncButton className="button button-primary" type="submit" busy={busy}><Plus size={16} />Create assignment</AsyncButton>
      </form>
    </Panel>}
    <div className="assignment-list">
      {loading ? <Panel><Loading /></Panel> : tasks.length ? tasks.map(task => {
        const currentUpdate = updates[task.id] || { status: task.status, comment: '' };
        return <Panel className="assignment-card" key={task.id}>
          <div className="assignment-heading"><div className="assignment-icon"><BriefcaseBusiness size={19} /></div>
            <div className="assignment-title"><div className="assignment-labels"><StatusBadge tone={`priority-${task.priority}`}>{task.priority} priority</StatusBadge><StatusBadge tone={task.status}>{task.status.replace('_', ' ')}</StatusBadge></div>
              <h3>{task.title}</h3><span>{admin ? `Assigned to ${task.profiles?.full_name || task.profiles?.email}` : 'Assigned to you'}</span></div>
            {admin && <div className="card-actions"><button title="Edit assignment" onClick={() => editTask(task)}><Pencil size={15} /></button><button title="Delete assignment" onClick={() => deleteTask(task)}><Trash2 size={15} /></button></div>}
          </div>
          {task.description && <p className="assignment-description">{task.description}</p>}
          {task.instructions && <div className="instructions-box"><strong>Instructions</strong><p>{task.instructions}</p></div>}
          <div className="assignment-dates"><span>Start <strong>{task.starts_on ? formatDate(`${task.starts_on}T12:00:00`) : '—'}</strong></span><span>Due <strong>{task.due_on ? formatDate(`${task.due_on}T12:00:00`) : 'No deadline'}</strong></span></div>
          {task.assignment_updates?.length > 0 && <div className="task-update-history"><strong>Progress updates</strong>{task.assignment_updates.slice().reverse().slice(0, 3).map(update => <div key={update.id}>
            <p>{update.comment}</p><small><StatusBadge tone={update.status}>{update.status.replace('_', ' ')}</StatusBadge> · {formatDate(update.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>
          </div>)}</div>}
          {!admin && <div className="task-update-form">
            <label className="field"><span>Update status</span><select value={currentUpdate.status} onChange={event => setUpdates({ ...updates, [task.id]: { ...currentUpdate, status: event.target.value } })}>
              {taskStates.map(state => <option key={state} value={state}>{state.replace('_', ' ')}</option>)}
            </select></label>
            <Field as="textarea" label="Progress note" rows={2} placeholder="Share an update or completion details…" value={currentUpdate.comment} onChange={event => setUpdates({ ...updates, [task.id]: { ...currentUpdate, comment: event.target.value } })} />
            <AsyncButton className="button button-outline button-small" busy={updatingTaskId === task.id} disabled={!currentUpdate.comment.trim()} onClick={() => submitUpdate(task)}><CheckCircle2 size={14} />Submit update</AsyncButton>
          </div>}
        </Panel>;
      }) : <Panel><EmptyState title="No assignments yet" message={admin ? 'Create a task to get work moving.' : 'Your assigned work will appear here.'} /></Panel>}
    </div>
  </div>;
}
