import { useCallback, useEffect, useState } from 'react';
import { Download, Filter, RotateCw } from 'lucide-react';
import { api, formatDate, formatDuration, formatTime, todayLocal } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';
import CheckInSelfieAction from '../components/CheckInSelfieAction.jsx';
import { supabase } from '../lib/supabase.js';

function SelfiePreview({ path }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loadingSelfie, setLoadingSelfie] = useState(false);
  if (!path) return '—';
  if (error) return <span title={error} className="text-muted">Unavailable</span>;
  if (!url) return <button className="text-button" disabled={loadingSelfie} onClick={async () => {
    setLoadingSelfie(true);
    try {
      const res = await api(`/attendance/selfie-url?path=${encodeURIComponent(path)}`);
      setUrl(res.signedUrl);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoadingSelfie(false); }
  }}>{loadingSelfie ? 'Loading…' : 'View Selfie'}</button>;
  return <a className="attendance-selfie-link" href={url} target="_blank" rel="noreferrer">
    <img src={url} alt="Check-in selfie" /><span>View</span>
  </a>;
}

export default function AttendancePage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [rows, setRows] = useState([]);
  const [activeAttendance, setActiveAttendance] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters] = useState({ date: '', employeeId: '', status: '' });
  const [workMode, setWorkMode] = useState('office');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const result = await api(`${admin ? '/attendance/employees' : '/attendance'}?${params}`);
      setRows(result.attendance);
      if (!admin) setActiveAttendance((await api('/attendance/current')).attendance);
      if (admin) {
        const team = await api('/sessions/employees');
        setEmployees(team.employees);
      }
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [admin, filters]);
  useEffect(() => { load(); }, [load]);

  const todayRow = rows.find(row => row.work_date === todayLocal(profile.time_zone));
  const attendanceInProgress = activeAttendance || (todayRow && !todayRow.check_out ? todayRow : null);
  const currentMonth = todayLocal(profile.time_zone).slice(0, 7);
  const monthlyRows = rows.filter(row => row.work_date.startsWith(currentMonth));
  const monthlySeconds = monthlyRows.reduce((total, row) => total + (row.duration_seconds || 0), 0);
  async function doAttendance(action, selfiePath) {
    setBusy(true); setError('');
    try {
      const isBase64 = typeof selfiePath === 'string' && selfiePath.startsWith('data:image/');
      const body = action === 'check-in'
        ? (isBase64 ? { workMode, selfieBase64: selfiePath } : { workMode, selfiePath })
        : {};
      await api(`/attendance/${action}`, { method: 'POST', body });
      await load();
    } catch (actionError) { setError(actionError.message); throw actionError; }
    finally { setBusy(false); }
  }

  function exportCsv() {
    const header = ['Employee', 'Date', 'Check in', 'Check out', 'Duration (seconds)', 'Work mode', 'Status'];
    const csvRows = rows.map(row => [row.profiles?.full_name || profile.full_name, row.work_date,
      row.check_in, row.check_out || '', row.duration_seconds ?? '', row.work_mode, row.status]);
    const csv = [header, ...csvRows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `arshith-connect-attendance-${todayLocal()}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return <div>
    <PageHeader eyebrow="WORKDAY RECORDS" title="Attendance" description="A clear view of check-ins, check-outs, and time worked."
      action={admin ? <button className="button button-outline" onClick={exportCsv}><Download size={16} />Export CSV</button> : null} />
    <Notice>{error}</Notice>
    {!admin && <Panel className="checkin-panel">
      <div><div className="eyebrow">TODAY · {new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date())}</div>
        <h2>{attendanceInProgress ? 'You are checked in' : todayRow ? 'Your workday is complete' : 'Ready to start your workday?'}</h2>
        <p>{attendanceInProgress ? `Checked in ${attendanceInProgress.work_date !== todayLocal(profile.time_zone) ? `on ${formatDate(`${attendanceInProgress.work_date}T12:00:00`)} ` : ''}at ${formatTime(attendanceInProgress.check_in, 'Asia/Kolkata')}` : todayRow ? `Checked in at ${formatTime(todayRow.check_in, 'Asia/Kolkata')} · checked out at ${formatTime(todayRow.check_out, 'Asia/Kolkata')}` : 'Check in to begin recording today’s attendance and hourly updates.'}</p></div>
      {!todayRow && !attendanceInProgress ? <div className="checkin-action"><select value={workMode} onChange={event => setWorkMode(event.target.value)}><option value="office">Office</option><option value="work_from_home">Work From Home</option></select>
        <CheckInSelfieAction disabled={busy} onCheckIn={selfiePath => doAttendance('check-in', selfiePath)} /></div>
        : attendanceInProgress ? <AsyncButton className="button button-dark" busy={busy} onClick={() => doAttendance('check-out')}>Check out</AsyncButton> : null}
    </Panel>}
    {!admin && <div className="metrics-grid attendance-month-summary">
      <div className="metric"><div className="metric-top"><span>Days recorded this month</span></div><strong>{monthlyRows.length}</strong><small>Based on your attendance history</small></div>
      <div className="metric"><div className="metric-top"><span>Completed work time</span></div><strong>{formatDuration(monthlySeconds)}</strong><small>Checked-out sessions only</small></div>
    </div>}
    <Panel title={admin ? 'Company attendance' : 'Your attendance history'} action={<button className="button button-ghost button-small" onClick={load}><RotateCw size={14} />Refresh</button>}>
      <div className="filter-bar">
        <span className="filter-label"><Filter size={15} />Filter</span>
        {admin && <select value={filters.employeeId} onChange={event => setFilters({ ...filters, employeeId: event.target.value })}>
          <option value="">All employees</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
        </select>}
        <input aria-label="Filter by date" type="date" value={filters.date} onChange={event => setFilters({ ...filters, date: event.target.value })} />
        {admin && <select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All statuses</option><option value="present">Present</option><option value="absent">Absent</option><option value="on_leave">On leave</option>
        </select>}
        {(filters.date || filters.employeeId || filters.status) && <button className="text-button" onClick={() => setFilters({ date: '', employeeId: '', status: '' })}>Clear filters</button>}
      </div>
      {loading ? <Loading /> : rows.length ? <div className="table-wrap"><table>
        <thead><tr>{admin && <th>EMPLOYEE</th>}<th>DATE</th><th>CHECK IN</th><th>CHECK OUT</th><th>HOURS</th><th>MODE</th><th>SELFIE</th><th>STATUS</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          {admin && <td><strong>{row.profiles?.full_name || 'Employee'}</strong><small>{row.profiles?.department || row.profiles?.email}</small></td>}
          <td>{formatDate(`${row.work_date}T12:00:00`)}</td><td>{formatTime(row.check_in, 'Asia/Kolkata')}</td><td>{formatTime(row.check_out, 'Asia/Kolkata')}</td>
          <td>{formatDuration(row.duration_seconds)}</td><td>{row.work_mode === 'work_from_home' ? 'Remote' : 'Office'}</td><td><SelfiePreview path={row.selfie_path} /></td>
          <td><StatusBadge tone={row.check_out ? 'completed' : 'active'}>{row.check_out ? 'Completed' : 'In progress'}</StatusBadge></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No attendance records" message="Attendance appears after an employee checks in." />}
    </Panel>
  </div>;
}
