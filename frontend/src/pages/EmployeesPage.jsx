import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Plus, Save, Search, UserRoundPlus } from 'lucide-react';
import { api, formatDate, formatDuration, formatTime } from '../lib/api.js';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';
import { ProfileAvatar } from '../components/Sidebar.jsx';

const emptyForm = {
  fullName: '', employeeCode: '', email: '', phone: '', department: '', designation: '',
  joiningDate: '', workMode: 'Office', status: 'Active',
};

function normalizedEmployee(employee) {
  return {
    ...employee,
    employee_code: employee.employee_code || '',
    phone: employee.phone || '',
    joining_date: employee.joining_date || '',
    work_mode: employee.work_mode === 'Work From Home' ? 'Remote' : employee.work_mode || 'Office',
    workdays: employee.workdays || [1, 2, 3, 4, 5],
    work_start: employee.work_start || '09:00',
    work_end: employee.work_end || '18:00',
    time_zone: employee.time_zone || 'Asia/Kolkata',
  };
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingEmployeeId, setSavingEmployeeId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedEmployeeId, setExpandedEmployeeId] = useState('');
  const [employeeSessions, setEmployeeSessions] = useState({});
  const [loadingSessionsId, setLoadingSessionsId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api('/sessions/employees');
      setEmployees(result.employees.map(normalizedEmployee));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const departments = useMemo(() => [...new Set(employees.map(employee => employee.department).filter(Boolean))].sort(), [employees]);
  const visibleEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees.filter(employee => {
      const matchesSearch = !needle || [
        employee.full_name, employee.employee_code, employee.email, employee.id,
      ].some(value => String(value || '').toLowerCase().includes(needle));
      const matchesDepartment = !departmentFilter || employee.department === departmentFilter;
      const matchesStatus = !statusFilter || (employee.is_active !== false ? 'Active' : 'Inactive') === statusFilter;
      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [employees, search, departmentFilter, statusFilter]);

  async function createEmployee(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    setTemporaryPassword('');
    try {
      const result = await api('/sessions/employees/invite', { method: 'POST', body: form });
      setForm(emptyForm);
      setFormOpen(false);
      setTemporaryPassword(result.temporaryPassword || '');
      setSuccess(result.invitationSent
        ? `Employee created. A secure password-setup invitation was sent to ${result.employee.email}.`
        : 'Employee created using a temporary password because Supabase invitation email could not be delivered. Share it through a secure channel; the employee must change it at first sign-in.');
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(employee) {
    setSavingEmployeeId(employee.id); setError(''); setSuccess('');
    try {
      await api(`/sessions/employees/${employee.id}/schedule`, {
        method: 'PATCH',
        body: { workStart: employee.work_start.slice(0, 5), workEnd: employee.work_end.slice(0, 5),
          workdays: employee.workdays, timeZone: employee.time_zone },
      });
      setSuccess(`Schedule saved for ${employee.full_name}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingEmployeeId('');
    }
  }

  async function saveDetails(employee) {
    setSavingEmployeeId(employee.id); setError(''); setSuccess('');
    try {
      const { employee: saved } = await api(`/sessions/employees/${employee.id}`, {
        method: 'PATCH',
        body: {
          full_name: employee.full_name,
          employee_code: employee.employee_code,
          phone: employee.phone || null,
          department: employee.department || null,
          job_title: employee.job_title || employee.designation || null,
          joining_date: employee.joining_date || null,
          work_mode: employee.work_mode,
        },
      });
      setEmployees(current => current.map(item => item.id === saved.id ? normalizedEmployee({ ...item, ...saved }) : item));
      setSuccess(`Details saved for ${saved.full_name}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingEmployeeId('');
    }
  }

  async function toggleActive(employee) {
    setSavingEmployeeId(employee.id); setError(''); setSuccess('');
    try {
      const { employee: saved } = await api(`/sessions/employees/${employee.id}`, {
        method: 'PATCH', body: { is_active: !employee.is_active },
      });
      setEmployees(current => current.map(item => item.id === saved.id ? normalizedEmployee({ ...item, ...saved }) : item));
      setSuccess(`${saved.full_name} is now ${saved.is_active ? 'active' : 'deactivated'}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingEmployeeId('');
    }
  }

  async function toggleSessions(employee) {
    setError('');
    if (expandedEmployeeId === employee.id) {
      setExpandedEmployeeId('');
      return;
    }
    setExpandedEmployeeId(employee.id);
    if (employeeSessions[employee.id]) return;
    setLoadingSessionsId(employee.id);
    try {
      const result = await api(`/sessions?employeeId=${encodeURIComponent(employee.id)}&limit=50&offset=0`);
      setEmployeeSessions(current => ({ ...current, [employee.id]: result.sessions }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingSessionsId('');
    }
  }

  function updateEmployee(id, key, value) {
    setEmployees(current => current.map(employee => employee.id === id ? { ...employee, [key]: value } : employee));
  }

  return <div>
    <PageHeader eyebrow="PEOPLE DIRECTORY" title="Employees" description="Create employee accounts, manage employee details, and review login history."
      action={<button className="button button-primary" onClick={() => { setFormOpen(open => !open); setError(''); }}><Plus size={16} />Add Employee</button>} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    {temporaryPassword && <div className="temporary-password-notice" role="status">
      <strong>Temporary password (shown once)</strong>
      <code>{temporaryPassword}</code>
      <span>Copy it now and share it with the employee through a secure channel. It is not stored in the application database, and the employee must replace it at first sign-in.</span>
    </div>}

    {formOpen && <Panel title="Add employee" className="invite-panel">
      <p className="panel-intro">An individual Supabase login will be created and a secure password-setup invitation will be emailed. Passwords are never stored by this app.</p>
      <form className="stack-form" onSubmit={createEmployee}>
        <div className="form-two">
          <Field label="Employee full name" placeholder="Full name" value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} required />
          <Field label="Employee ID / code" placeholder="e.g. AC-1042" value={form.employeeCode} onChange={event => setForm({ ...form, employeeCode: event.target.value })} required />
        </div>
        <div className="form-two">
          <Field label="Email address" type="email" placeholder="name@company.com" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required />
          <Field label="Phone number" type="tel" placeholder="Phone number" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
        </div>
        <div className="form-two">
          <Field label="Department" placeholder="e.g. Operations" value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} />
          <Field label="Designation" placeholder="e.g. Analyst" value={form.designation} onChange={event => setForm({ ...form, designation: event.target.value })} />
        </div>
        <div className="form-three">
          <Field label="Joining date" type="date" value={form.joiningDate} onChange={event => setForm({ ...form, joiningDate: event.target.value })} />
          <label className="field"><span>Work mode</span><select value={form.workMode} onChange={event => setForm({ ...form, workMode: event.target.value })}>
            <option>Office</option><option>Remote</option><option>Hybrid</option>
          </select></label>
          <label className="field"><span>Account status</span><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>
            <option>Active</option><option>Inactive</option>
          </select></label>
        </div>
        <div className="form-actions">
          <AsyncButton className="button button-primary" type="submit" busy={busy}><UserRoundPlus size={16} />Create employee and send invite</AsyncButton>
          <button type="button" className="button button-ghost" onClick={() => { setFormOpen(false); setForm(emptyForm); }}>Cancel</button>
        </div>
      </form>
    </Panel>}

    <Panel title="Employee directory" action={<span className="count-pill">{visibleEmployees.length} of {employees.length} employees</span>}>
      <div className="filter-bar">
        <span className="filter-label"><Search size={15} />Search and filter</span>
        <input aria-label="Search employees" placeholder="Name, employee code, email" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Filter by department" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}>
          <option value="">All departments</option>{departments.map(department => <option key={department}>{department}</option>)}
        </select>
        <select aria-label="Filter by account status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option><option>Active</option><option>Inactive</option>
        </select>
      </div>
      {loading ? <Loading /> : visibleEmployees.length ? <div className="schedule-list">{visibleEmployees.map(employee => <div className="schedule-person" key={employee.id}>
        <div className="schedule-person-head">
          <ProfileAvatar name={employee.full_name} />
          <span><strong>{employee.full_name}</strong><small>{employee.employee_code || employee.id} · {employee.email} · {employee.is_active === false ? 'Inactive' : 'Active'}</small></span>
          <button className="button button-outline button-small" disabled={savingEmployeeId === employee.id} onClick={() => toggleActive(employee)}>{employee.is_active === false ? 'Activate' : 'Deactivate'}</button>
        </div>
        <div className="employee-detail-controls">
          <label className="compact-field"><span>Full name</span><input value={employee.full_name || ''} onChange={event => updateEmployee(employee.id, 'full_name', event.target.value)} /></label>
          <label className="compact-field"><span>Employee code</span><input value={employee.employee_code} onChange={event => updateEmployee(employee.id, 'employee_code', event.target.value)} /></label>
          <label className="compact-field"><span>Phone</span><input value={employee.phone} onChange={event => updateEmployee(employee.id, 'phone', event.target.value)} /></label>
          <label className="compact-field"><span>Department</span><input value={employee.department || ''} onChange={event => updateEmployee(employee.id, 'department', event.target.value)} /></label>
          <label className="compact-field"><span>Designation</span><input value={employee.job_title || employee.designation || ''} onChange={event => updateEmployee(employee.id, 'job_title', event.target.value)} /></label>
          <label className="compact-field"><span>Joining date</span><input type="date" value={employee.joining_date} onChange={event => updateEmployee(employee.id, 'joining_date', event.target.value)} /></label>
          <label className="compact-field"><span>Work mode</span><select value={employee.work_mode} onChange={event => updateEmployee(employee.id, 'work_mode', event.target.value)}>
            <option>Office</option><option>Remote</option><option>Hybrid</option>
          </select></label>
          <button className="button button-outline button-small" disabled={savingEmployeeId === employee.id} onClick={() => saveDetails(employee)}><Save size={14} />Save details</button>
        </div>
        <div className="schedule-controls">
          <label className="compact-field"><span>Start</span><input type="time" value={employee.work_start.slice(0, 5)} onChange={event => updateEmployee(employee.id, 'work_start', event.target.value)} /></label>
          <label className="compact-field"><span>End</span><input type="time" value={employee.work_end.slice(0, 5)} onChange={event => updateEmployee(employee.id, 'work_end', event.target.value)} /></label>
          <label className="compact-field"><span>Time zone</span><input type="text" value={employee.time_zone} onChange={event => updateEmployee(employee.id, 'time_zone', event.target.value)} /></label>
          <button className="button button-outline button-small" disabled={savingEmployeeId === employee.id} onClick={() => saveSchedule(employee)}><Save size={14} />Save schedule</button>
          <div className="weekdays">{['M','T','W','T','F','S','S'].map((day, index) => {
            const number = index + 1;
            const selected = employee.workdays.includes(number);
            return <button type="button" className={selected ? 'day-selected' : ''} key={`${number}-${day}`}
              title={`Toggle ${day}`} onClick={() => updateEmployee(employee.id, 'workdays',
                selected ? employee.workdays.filter(item => item !== number) : [...employee.workdays, number].sort())}>{day}</button>;
          })}</div>
        </div>
        <div className="employee-created">
          <span>Member since {formatDate(employee.created_at)}</span>
          <button type="button" className="text-button" onClick={() => toggleSessions(employee)}><Clock3 size={14} />{expandedEmployeeId === employee.id ? 'Hide login history' : 'View login history'}</button>
        </div>
        {expandedEmployeeId === employee.id && <div className="employee-session-history">
          {loadingSessionsId === employee.id ? <Loading label="Loading login history…" />
            : employeeSessions[employee.id]?.length ? employeeSessions[employee.id].map(session => <div className="employee-session-row" key={session.id}>
              <span>{formatDate(session.login_at)} · {formatTime(session.login_at)}</span>
              <span>{session.logout_at ? formatTime(session.logout_at) : 'No logout'}</span>
              <span>{formatDuration(session.duration_seconds)}</span>
              <StatusBadge tone={session.status}>{session.status}</StatusBadge>
            </div>) : <span>No login sessions recorded.</span>}
        </div>}
      </div>)}</div> : <EmptyState title={employees.length ? 'No matching employees' : 'Your directory is ready'} message={employees.length ? 'Try another search or filter.' : 'Add an employee to create their secure login.'} />}
    </Panel>
  </div>;
}
