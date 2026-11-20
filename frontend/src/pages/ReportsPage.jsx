import { useCallback, useEffect, useState } from 'react';
import { Download, Filter, Printer, FileSpreadsheet, BarChart2, PieChart as PieChartIcon } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { api, formatDate, formatDuration, formatTime } from '../lib/api.js';
import { EmptyState, Loading, Notice, PageHeader, Panel } from '../components/ui.jsx';

const reportCategories = {
  attendance: 'Attendance (Daily/Roster)',
  weeklyAttendance: 'Weekly Attendance Summary',
  monthlyHours: 'Monthly Attendance & Work Hours',
  leaves: 'Leave Applications & Approvals',
  assignments: 'Tasks & Assignment Tracking',
  updates: 'Hourly Work Submissions',
  employees: 'Employee Directory & Roster',
  sessions: 'Login & Session Audits',
};

const CHART_COLORS = ['#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function employeeName(row) {
  return row.employees?.full_name || row.profiles?.full_name || row.profiles?.email || 'Employee';
}

export default function ReportsPage() {
  const [filters, setFilters] = useState({ employeeId: '', from: '', to: '' });
  const [employees, setEmployees] = useState([]);
  const [reports, setReports] = useState(null);
  const [type, setType] = useState('attendance');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const [reportResult, employeeResult, sessionsResult] = await Promise.all([
        api(`/reports?${params}`),
        api('/sessions/employees'),
        api('/sessions').catch(() => ({ sessions: [] })),
      ]);
      setReports({
        ...reportResult,
        employeesList: employeeResult.employees || [],
        sessions: sessionsResult.sessions || [],
      });
      setEmployees(employeeResult.employees || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  // Compute rows based on selected report type
  function getComputedRows() {
    if (!reports) return [];
    switch (type) {
      case 'attendance':
        return (reports.attendance || []).map(row => ({
          Employee: employeeName(row),
          Date: row.attendance_date || row.work_date,
          'Check in': row.check_in,
          'Check out': row.check_out || '',
          'Working Minutes': row.working_minutes ?? (row.duration_seconds ? Math.round(row.duration_seconds / 60) : ''),
          Mode: row.work_mode === 'work_from_home' ? 'Remote' : 'Office',
          Status: row.attendance_status || (row.check_out ? 'Completed' : 'Working'),
        }));

      case 'weeklyAttendance': {
        const byDate = new Map();
        for (const row of reports.attendance || []) {
          const date = row.attendance_date || row.work_date;
          const current = byDate.get(date) || { Date: date, Present: 0, Remote: 0, Office: 0 };
          current.Present += 1;
          if (row.work_mode === 'work_from_home') current.Remote += 1;
          else current.Office += 1;
          byDate.set(date, current);
        }
        return [...byDate.values()].sort((a, b) => b.Date.localeCompare(a.Date));
      }

      case 'monthlyHours': {
        const monthly = new Map();
        for (const row of reports.attendance || []) {
          const date = row.attendance_date || row.work_date || '';
          const month = date.slice(0, 7);
          const name = employeeName(row);
          const key = `${name}-${month}`;
          const current = monthly.get(key) || { Employee: name, Month: month, 'Days Recorded': 0, 'Total Minutes': 0 };
          current['Days Recorded'] += 1;
          current['Total Minutes'] += (row.working_minutes || (row.duration_seconds ? Math.round(row.duration_seconds / 60) : 0));
          monthly.set(key, current);
        }
        return [...monthly.values()].map(item => ({
          Employee: item.Employee,
          Month: item.Month,
          'Days Recorded': item['Days Recorded'],
          'Hours Worked': (item['Total Minutes'] / 60).toFixed(1),
        }));
      }

      case 'leaves':
        return (reports.leaves || []).map(row => ({
          Employee: employeeName(row),
          'Leave Type': row.leave_type,
          'From Date': row.start_date || row.starts_on,
          'To Date': row.end_date || row.ends_on,
          Reason: row.reason,
          Status: row.status,
          'Reviewed By': row.reviewed_at ? 'Admin' : 'Pending',
          Remarks: row.admin_comment || row.review_note || '—',
        }));

      case 'assignments':
        return (reports.assignments || []).map(row => ({
          Employee: employeeName(row),
          Title: row.title,
          Priority: row.priority,
          Status: row.status,
          Deadline: row.due_date || row.due_on || 'Ongoing',
          'Updated At': row.updated_at || row.created_at,
        }));

      case 'updates':
        return (reports.updates || []).map(row => ({
          Employee: employeeName(row),
          Submitted: row.submitted_at || row.created_at,
          Completed: row.completed_work,
          'Current Task': row.current_task,
          Progress: row.progress,
          Pending: row.pending_work,
          Blockers: row.blockers || 'None',
        }));

      case 'employees':
        return (reports.employeesList || []).map(e => ({
          'Employee Code': e.employee_code || '—',
          Name: e.full_name,
          Email: e.email,
          Department: e.department || 'General',
          Designation: e.designation || 'Staff',
          Status: e.status || (e.is_active !== false ? 'Active' : 'Inactive'),
          'Work Mode': e.work_mode || 'Office',
        }));

      case 'sessions':
        return (reports.sessions || []).map(s => ({
          Employee: employeeName(s),
          'Login At': s.login_at,
          'Logout At': s.logout_at || 'Active',
          Status: s.session_status || s.status,
        }));

      default:
        return [];
    }
  }

  const rows = getComputedRows();

  // Export CSV
  function exportCsv() {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers, ...rows.map(row => headers.map(header => row[header]))]
      .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `arshith-connect-${type}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Export Excel (.xls format with HTML table)
  function exportExcel() {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"/><title>${reportCategories[type]}</title></head>
    <body><h2>ARSHITH CONNECT - ${reportCategories[type]}</h2>
    <table border="1"><thead><tr>`;
    headers.forEach(h => { html += `<th style="background:#2563eb;color:#ffffff;">${h}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>';
      headers.forEach(h => { html += `<td>${r[h] ?? ''}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arshith-connect-${type}-report.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Generate chart data based on report type
  function getChartData() {
    if (!rows.length) return [];
    if (type === 'leaves') {
      const counts = {};
      rows.forEach(r => {
        const s = r.Status || 'Pending';
        counts[s] = (counts[s] || 0) + 1;
      });
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }
    if (type === 'assignments') {
      const counts = {};
      rows.forEach(r => {
        const s = r.Status || 'pending';
        counts[s] = (counts[s] || 0) + 1;
      });
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }
    if (type === 'weeklyAttendance') {
      return rows.slice(0, 7).reverse().map(r => ({
        name: r.Date,
        Office: r.Office,
        Remote: r.Remote,
      }));
    }
    if (type === 'monthlyHours') {
      return rows.slice(0, 10).map(r => ({
        name: r.Employee,
        Hours: parseFloat(r['Hours Worked'] || 0),
      }));
    }
    return [];
  }

  const chartData = getChartData();

  return (
    <div className="reports-page">
      <PageHeader
        eyebrow="ENTERPRISE AUDIT & ANALYTICS"
        title="Reports & Analytics"
        description="Comprehensive workplace records, attendance rosters, task progress, and exports."
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button button-outline"
              onClick={() => window.print()}
              title="Print report"
            >
              <Printer size={15} /> Print
            </button>
            <button
              type="button"
              className="button button-outline"
              onClick={exportExcel}
              disabled={!rows.length}
              title="Export as Excel"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={exportCsv}
              disabled={!rows.length}
              title="Export as CSV"
            >
              <Download size={15} /> Export CSV
            </button>
          </div>
        }
      />

      <Notice>{error}</Notice>

      {/* Filter Controls */}
      <Panel title="Report Configuration & Filters">
        <div className="filter-bar">
          <span className="filter-label"><Filter size={15} /> Select Report</span>
          <select
            aria-label="Report category"
            value={type}
            onChange={e => setType(e.target.value)}
            style={{ fontWeight: 600, color: '#1e293b' }}
          >
            {Object.entries(reportCategories).map(([key, name]) => (
              <option value={key} key={key}>{name}</option>
            ))}
          </select>

          <select
            aria-label="Filter by Employee"
            value={filters.employeeId}
            onChange={e => setFilters({ ...filters, employeeId: e.target.value })}
          >
            <option value="">All Employees</option>
            {employees.map(employee => (
              <option value={employee.id} key={employee.id}>{employee.full_name}</option>
            ))}
          </select>

          <input
            aria-label="From date"
            type="date"
            value={filters.from}
            onChange={e => setFilters({ ...filters, from: e.target.value })}
          />
          <input
            aria-label="To date"
            type="date"
            value={filters.to}
            onChange={e => setFilters({ ...filters, to: e.target.value })}
          />

          <span className="count-pill">{rows.length} Records</span>
        </div>
      </Panel>

      {/* Visual Analytics Chart (when applicable) */}
      {chartData.length > 0 && (
        <Panel title="Visual Breakdown" icon={BarChart2}>
          <div style={{ height: 220, width: '100%', marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              {type === 'leaves' || type === 'assignments' ? (
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              ) : type === 'weeklyAttendance' ? (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Office" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Remote" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="Hours" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Report Data Table */}
      <Panel title={reportCategories[type] || 'Report Data'}>
        {loading ? (
          <Loading label="Compiling report data…" />
        ) : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {Object.keys(rows[0]).map(header => (
                    <th key={header}>{header.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${type}-${index}`}>
                    {Object.entries(row).map(([key, value]) => (
                      <td key={key}>
                        {key === 'Check in' || key === 'Check out' || key === 'Submitted' || key === 'Login At' || key === 'Logout At' || key === 'Updated At'
                          ? (value && value !== 'Active' ? `${formatDate(value)} · ${formatTime(value)}` : value || '—')
                          : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
                          ? formatDate(`${value}T12:00:00`)
                          : value === '' || value == null ? '—' : String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={`No records found for ${reportCategories[type]}`}
            message="Try widening your date range or clearing the employee filter."
          />
        )}
      </Panel>
    </div>
  );
}
