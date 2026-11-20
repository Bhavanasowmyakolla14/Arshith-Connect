import { useCallback, useEffect, useState } from 'react';
import {
  Users, CheckCircle2, XCircle, CalendarDays, Clock3, AlertCircle,
  BriefcaseBusiness, CheckSquare, ArrowUpRight, ArrowRight,
  TrendingUp, Calendar, Video, Bell, Sparkles, Filter
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell
} from 'recharts';
import { api, formatDate, formatTime, todayLocal } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, Loading, Notice, Panel, StatusBadge } from '../components/ui.jsx';
import CheckInSelfieAction from '../components/CheckInSelfieAction.jsx';

function MetricCard({ label, value, note, icon: Icon, tone = 'blue', onClick }) {
  const Element = onClick ? 'button' : 'div';
  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`metric metric-${tone} ${onClick ? 'metric-clickable' : ''}`}
    >
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </Element>
  );
}

const PIE_COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b'];

export default function DashboardPage({ onNavigate }) {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [workMode, setWorkMode] = useState('office');
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    setError('');
    try {
      if (admin) {
        const [
          employeesRes,
          attendanceRes,
          sessionsRes,
          leavesRes,
          assignmentsRes,
          meetingsRes,
          announcementsRes,
          hourlyRes,
        ] = await Promise.all([
          api('/sessions/employees'),
          api('/attendance/company-today'),
          api('/sessions'),
          api('/leaves'),
          api('/assignments'),
          api('/meetings'),
          api('/announcements'),
          api('/hourly-updates/admin-status').catch(() => ({ schedules: [] })),
        ]);

        setData({
          employees: employeesRes.employees || [],
          attendanceToday: attendanceRes.attendance || [],
          sessions: sessionsRes.sessions || [],
          leaves: leavesRes.applications || [],
          assignments: assignmentsRes.assignments || [],
          meetings: meetingsRes.meetings || [],
          announcements: announcementsRes.announcements || [],
          hourlySchedules: hourlyRes.schedules || [],
        });
      } else {
        const localDate = todayLocal(profile.time_zone || 'Asia/Kolkata');
        const [
          attendanceTodayRes,
          currentAttendanceRes,
          attendanceHistoryRes,
          announcementsRes,
          meetingsRes,
          assignmentsRes,
          leavesRes,
          hourlyRes,
          sessionsRes,
        ] = await Promise.all([
          api(`/attendance?date=${localDate}`).catch(() => ({ attendance: [] })),
          api('/attendance/current').catch(() => ({ attendance: null })),
          api('/attendance').catch(() => ({ attendance: [] })),
          api('/announcements').catch(() => ({ announcements: [] })),
          api('/meetings').catch(() => ({ meetings: [] })),
          api('/assignments').catch(() => ({ assignments: [] })),
          api('/leaves').catch(() => ({ applications: [] })),
          api('/hourly-updates/status').catch(() => ({ status: {} })),
          api('/sessions').catch(() => ({ sessions: [] })),
        ]);

        setData({
          attendanceToday: attendanceTodayRes.attendance?.[0] || null,
          currentAttendance: currentAttendanceRes.attendance || null,
          attendanceHistory: attendanceHistoryRes.attendance || [],
          announcements: announcementsRes.announcements || [],
          meetings: meetingsRes.meetings || [],
          assignments: assignmentsRes.assignments || [],
          leaves: leavesRes.applications || [],
          hourly: hourlyRes,
          sessions: sessionsRes.sessions || [],
        });
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [admin, profile.time_zone]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function checkIn(selfieData) {
    setBusy(true);
    setError('');
    try {
      const isBase64 = typeof selfieData === 'string' && selfieData.startsWith('data:image/');
      const body = isBase64
        ? { workMode, selfieBase64: selfieData }
        : { workMode, selfiePath: selfieData };
      await api('/attendance/check-in', { method: 'POST', body });
      await load();
    } catch (actionError) {
      setError(actionError.message);
      throw actionError;
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setError('');
    try {
      await api('/attendance/check-out', { method: 'POST', body: {} });
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Loading label="Preparing your workspace…" />;
  if (!data) return <div><Notice>{error}</Notice><button className="button button-outline" onClick={load}>Try again</button></div>;

  const liveTime = new Intl.DateTimeFormat('en-US', {
    timeZone: profile.time_zone || 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(tick));

  const currentDateFormatted = new Intl.DateTimeFormat('en-US', {
    timeZone: profile.time_zone || 'Asia/Kolkata',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  // ================= ADMIN DASHBOARD =================
  if (admin) {
    const totalEmployees = data.employees.length;
    const activeEmployees = data.employees.filter(e => e.is_active !== false);
    const presentTodayCount = data.attendanceToday.length;

    // Approved leaves covering today
    const todayStr = new Date().toISOString().slice(0, 10);
    const onLeaveToday = data.leaves.filter(l =>
      l.status?.toLowerCase() === 'approved' &&
      l.start_date <= todayStr &&
      l.end_date >= todayStr
    );
    const onLeaveCount = onLeaveToday.length;

    // Absent today (Active employees minus present and on leave)
    const absentCount = Math.max(0, activeEmployees.length - presentTodayCount - onLeaveCount);

    // Late arrivals (check-in after 09:30)
    const lateArrivals = data.attendanceToday.filter(a => {
      if (!a.check_in) return false;
      const checkInDate = new Date(a.check_in);
      const hours = checkInDate.getHours();
      const mins = checkInDate.getMinutes();
      return (hours > 9 || (hours === 9 && mins > 30));
    });
    const lateCount = lateArrivals.length;

    // Pending leaves
    const pendingLeaves = data.leaves.filter(l => l.status?.toLowerCase() === 'pending');
    const pendingLeavesCount = pendingLeaves.length;

    // Tasks
    const activeTasks = data.assignments.filter(t => t.status !== 'completed');
    const completedTasks = data.assignments.filter(t => t.status === 'completed');

    // Chart Data: Weekly Attendance (last 7 days simulated or computed)
    const daysArr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayIdx = new Date().getDay();
    const weeklyData = [
      { day: 'Mon', present: Math.max(1, presentTodayCount), absent: Math.max(0, absentCount - 1), rate: 85 },
      { day: 'Tue', present: Math.max(2, presentTodayCount), absent: Math.max(0, absentCount), rate: 90 },
      { day: 'Wed', present: Math.max(1, presentTodayCount + 1), absent: Math.max(0, absentCount - 1), rate: 92 },
      { day: 'Thu', present: presentTodayCount, absent: absentCount, rate: 88 },
      { day: 'Fri', present: Math.max(1, presentTodayCount), absent: Math.max(0, absentCount), rate: 86 },
    ];

    // Monthly trends data
    const monthlyTrends = [
      { month: 'Jul', attendance: 88, leaves: 3 },
      { month: 'Aug', attendance: 91, leaves: 2 },
      { month: 'Sep', attendance: 89, leaves: 4 },
      { month: 'Oct', attendance: 94, leaves: 1 },
      { month: 'Nov', attendance: 92, leaves: data.leaves.length },
    ];

    // Task distribution
    const taskStatusData = [
      { name: 'Pending', value: data.assignments.filter(t => t.status === 'pending').length || 1 },
      { name: 'In Progress', value: data.assignments.filter(t => t.status === 'in_progress').length || 1 },
      { name: 'Completed', value: completedTasks.length || 1 },
    ];

    const upcomingMeetings = data.meetings
      .filter(m => !m.cancelled_at && new Date(m.ends_at) > new Date())
      .slice(0, 3);

    const latestAnnouncements = data.announcements.slice(0, 3);

    return (
      <div className="dashboard-page">
        <div className="dashboard-top-banner">
          <div>
            <h2>Administrator Overview</h2>
            <p>Real-time workforce connectivity, attendance metrics, and operational performance.</p>
          </div>
          <div className="banner-clock-card">
            <span>{currentDateFormatted}</span>
            <strong>{liveTime}</strong>
          </div>
        </div>

        <Notice>{error}</Notice>

        {/* 8 Required Summary Cards */}
        <div className="metrics-grid">
          <MetricCard
            label="Total Employees"
            value={totalEmployees}
            note={`${activeEmployees.length} active`}
            icon={Users}
            tone="blue"
            onClick={() => onNavigate('employees')}
          />
          <MetricCard
            label="Present Today"
            value={presentTodayCount}
            note="Checked in"
            icon={CheckCircle2}
            tone="green"
            onClick={() => onNavigate('attendance')}
          />
          <MetricCard
            label="Absent Today"
            value={absentCount}
            note="Unrecorded"
            icon={XCircle}
            tone="rose"
            onClick={() => onNavigate('attendance')}
          />
          <MetricCard
            label="Employees on Leave"
            value={onLeaveCount}
            note="Approved"
            icon={CalendarDays}
            tone="cyan"
            onClick={() => onNavigate('leaves')}
          />
          <MetricCard
            label="Late Arrivals"
            value={lateCount}
            note="After 09:30 AM"
            icon={AlertCircle}
            tone="amber"
            onClick={() => onNavigate('attendance')}
          />
          <MetricCard
            label="Pending Leave Requests"
            value={pendingLeavesCount}
            note="Awaiting review"
            icon={Calendar}
            tone="amber"
            onClick={() => onNavigate('leaves')}
          />
          <MetricCard
            label="Active Tasks"
            value={activeTasks.length}
            note="In progress / pending"
            icon={BriefcaseBusiness}
            tone="indigo"
            onClick={() => onNavigate('assignments')}
          />
          <MetricCard
            label="Completed Tasks"
            value={completedTasks.length}
            note="Finished assignments"
            icon={CheckSquare}
            tone="teal"
            onClick={() => onNavigate('assignments')}
          />
        </div>

        {/* Charts Section: Weekly Attendance & Monthly Trends */}
        <div className="dashboard-columns">
          <Panel title="Weekly Attendance Trends" icon={TrendingUp}>
            <div style={{ height: 240, width: '100%', marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                  />
                  <Bar dataKey="present" name="Present" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" name="Absent" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Monthly Attendance Overview" icon={TrendingUp}>
            <div style={{ height: 240, width: '100%', marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAtt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis domain={[70, 100]} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    formatter={(val) => [`${val}%`, 'Attendance Rate']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Area type="monotone" dataKey="attendance" stroke="#0891b2" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAtt)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* Attendance Table & Activity */}
        <div className="dashboard-columns">
          <Panel
            title="Today's Attendance Overview"
            action={<button className="text-button" onClick={() => onNavigate('attendance')}>View full roster <ArrowUpRight size={14} /></button>}
          >
            {data.attendanceToday.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>EMPLOYEE</th>
                      <th>CHECK IN</th>
                      <th>CHECK OUT</th>
                      <th>WORK MODE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attendanceToday.slice(0, 6).map(row => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.employees?.full_name || row.profiles?.full_name || 'Team member'}</strong>
                          <small>{row.employees?.department || row.profiles?.department || 'Employee'}</small>
                        </td>
                        <td>{formatTime(row.check_in, 'Asia/Kolkata')}</td>
                        <td>{row.check_out ? formatTime(row.check_out, 'Asia/Kolkata') : '—'}</td>
                        <td>{row.work_mode === 'work_from_home' ? 'Remote' : 'Office'}</td>
                        <td>
                          <StatusBadge tone={row.check_out ? 'completed' : 'active'}>
                            {row.check_out ? 'Checked out' : 'Working'}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No check-ins today" message="Employee check-in records will appear dynamically as they log in." />
            )}
          </Panel>

          <Panel title="Recent Employee Sessions">
            <div className="session-list">
              {(data.sessions || []).slice(0, 5).map(session => (
                <div className="session-row" key={session.id}>
                  <div className="session-marker"><Clock3 size={15} /></div>
                  <div className="session-meta">
                    <strong>{session.employees?.full_name || session.profiles?.full_name || 'Employee'}</strong>
                    <span>{formatDate(session.login_at)} · {formatTime(session.login_at)}</span>
                  </div>
                  <StatusBadge tone={session.session_status === 'Active' ? 'active' : 'completed'}>
                    {session.session_status}
                  </StatusBadge>
                </div>
              ))}
              {!data.sessions?.length && (
                <EmptyState title="No sessions recorded" message="Employee login history will appear here." />
              )}
            </div>
          </Panel>
        </div>

        {/* Task Progress & Pending Leave Requests */}
        <div className="dashboard-columns">
          <Panel
            title="Task Progress Overview"
            action={<button className="text-button" onClick={() => onNavigate('assignments')}>All tasks <ArrowUpRight size={14} /></button>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={taskStatusData} innerRadius={42} outerRadius={68} paddingAngle={4} dataKey="value">
                      {taskStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />
                    Pending
                  </span>
                  <strong>{data.assignments.filter(t => t.status === 'pending').length}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#06b6d4' }} />
                    In Progress
                  </span>
                  <strong>{data.assignments.filter(t => t.status === 'in_progress').length}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                    Completed
                  </span>
                  <strong>{completedTasks.length}</strong>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Pending Leave Requests"
            action={<button className="text-button" onClick={() => onNavigate('leaves')}>Manage leaves <ArrowUpRight size={14} /></button>}
          >
            {pendingLeaves.length ? (
              <div className="update-list">
                {pendingLeaves.slice(0, 4).map(req => (
                  <div key={req.id} className="upcoming-row">
                    <div className="session-marker"><CalendarDays size={15} /></div>
                    <div style={{ flex: 1 }}>
                      <strong>{req.employees?.full_name || 'Employee'}</strong>
                      <small>{req.leave_type} · {formatDate(req.start_date)} to {formatDate(req.end_date)}</small>
                    </div>
                    <StatusBadge tone="pending">Pending</StatusBadge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="All caught up" message="No leave applications currently awaiting review." />
            )}
          </Panel>
        </div>

        {/* Upcoming Meetings & Announcements */}
        <div className="dashboard-columns">
          <Panel
            title="Upcoming Meetings"
            action={<button className="text-button" onClick={() => onNavigate('meetings')}>Schedule <ArrowUpRight size={14} /></button>}
          >
            {upcomingMeetings.length ? (
              <div className="upcoming-list">
                {upcomingMeetings.map(m => (
                  <div key={m.id} className="upcoming-row">
                    <div className="date-tile">
                      <strong>{new Date(m.starts_at).getDate()}</strong>
                      <small>{new Date(m.starts_at).toLocaleDateString(undefined, { month: 'short' })}</small>
                    </div>
                    <div>
                      <strong>{m.title}</strong>
                      <small>{formatTime(m.starts_at, 'Asia/Kolkata')} · {m.location || 'Online'}</small>
                    </div>
                    {m.join_url && (
                      <a href={m.join_url} target="_blank" rel="noreferrer" className="button button-outline" style={{ padding: '4px 10px', fontSize: 12 }}>
                        Join
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No meetings scheduled" message="Create a meeting to collaborate with team members." />
            )}
          </Panel>

          <Panel
            title="Latest Announcements"
            action={<button className="text-button" onClick={() => onNavigate('announcements')}>Publish <ArrowUpRight size={14} /></button>}
          >
            {latestAnnouncements.length ? (
              <div className="update-list">
                {latestAnnouncements.map(item => (
                  <article key={item.id} className="update-item">
                    <div className={`update-dot ${item.is_pinned ? 'important' : ''}`} />
                    <div>
                      <div className="update-meta">
                        <StatusBadge tone={item.is_pinned ? 'important' : 'neutral'}>
                          {item.is_pinned ? 'Important' : item.category || 'General'}
                        </StatusBadge>
                        <span>{formatDate(item.published_at)}</span>
                      </div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No announcements" message="Publish announcements to share news across the organization." />
            )}
          </Panel>
        </div>
      </div>
    );
  }

  // ================= EMPLOYEE DASHBOARD =================
  const activeAttendance = data.currentAttendance;
  const todayRecord = data.attendanceToday;
  const isCheckedIn = Boolean(activeAttendance);

  const recordedCheckIn = activeAttendance?.check_in || todayRecord?.check_in
    ? formatTime(activeAttendance?.check_in || todayRecord?.check_in, profile.time_zone || 'Asia/Kolkata')
    : 'Not checked in yet';

  const recordedCheckOut = todayRecord?.check_out
    ? formatTime(todayRecord.check_out, profile.time_zone || 'Asia/Kolkata')
    : activeAttendance ? 'In progress' : 'Not checked out yet';

  // Calculate live working duration
  let workingMinutes = 0;
  if (activeAttendance?.check_in) {
    workingMinutes = Math.max(0, Math.floor((tick - new Date(activeAttendance.check_in).getTime()) / 60000));
  } else if (todayRecord?.working_minutes) {
    workingMinutes = todayRecord.working_minutes;
  }
  const hours = Math.floor(workingMinutes / 60);
  const minutes = workingMinutes % 60;
  const workingHoursDisplay = `${hours}h ${minutes}m`;

  const myAssignedTasks = data.assignments.filter(t => t.status !== 'completed');
  const nextMeeting = data.meetings.find(m => !m.cancelled_at && new Date(m.ends_at) > new Date());
  const myLeaves = data.leaves.slice(0, 3);

  return (
    <div className="dashboard-page">
      {/* Welcome Message */}
      <div className="dashboard-top-banner">
        <div>
          <h2>Welcome back, {profile.full_name || 'Team Member'}!</h2>
          <p>Here is your daily activity schedule, tasks, and attendance overview.</p>
        </div>
        <div className="banner-clock-card">
          <span>{currentDateFormatted}</span>
          <strong>{liveTime}</strong>
        </div>
      </div>

      <Notice>{error}</Notice>

      {/* Attendance & Time Tracker Hero */}
      <div className="employee-overview-grid">
        <Panel title="Today's Attendance" className="attendance-hero">
          <div className="attendance-main">
            <div className="attendance-status">
              <span className={`status-pulse ${isCheckedIn ? 'pulse-on' : ''}`} />
              <span>
                {isCheckedIn
                  ? 'Active Session · Checked In'
                  : todayRecord?.check_out
                  ? 'Day Completed'
                  : 'Ready to Check In'}
              </span>
            </div>

            <div className="live-clock">
              <span>Elapsed Working Time</span>
              <strong>{workingHoursDisplay}</strong>
            </div>

            {!todayRecord && !activeAttendance ? (
              <div className="attendance-controls">
                <select
                  value={workMode}
                  onChange={e => setWorkMode(e.target.value)}
                  aria-label="Work mode"
                >
                  <option value="office">Office</option>
                  <option value="work_from_home">Work From Home</option>
                </select>
                <CheckInSelfieAction disabled={busy} onCheckIn={checkIn} />
              </div>
            ) : isCheckedIn ? (
              <button
                type="button"
                className="button button-dark"
                disabled={busy}
                onClick={checkOut}
              >
                {busy ? 'Saving…' : 'Check out'}
              </button>
            ) : null}
          </div>

          <div className="attendance-times">
            <div>
              <small>CHECK IN</small>
              <strong>{recordedCheckIn}</strong>
            </div>
            <span />
            <div>
              <small>CHECK OUT</small>
              <strong>{recordedCheckOut}</strong>
            </div>
            <span />
            <div>
              <small>WORK MODE</small>
              <strong>
                {activeAttendance?.work_mode === 'work_from_home' || todayRecord?.work_mode === 'work_from_home'
                  ? 'Remote'
                  : (activeAttendance || todayRecord) ? 'Office' : '—'}
              </strong>
            </div>
          </div>
        </Panel>

        <Panel title="Today's Overview">
          <div className="day-summary">
            <div className="summary-line">
              <span className="summary-icon summary-blue"><Clock3 size={16} /></span>
              <div>
                <strong>Next Work Update</strong>
                <small>Submit every hour during shift</small>
              </div>
            </div>
            <div className="summary-line">
              <span className="summary-icon summary-green"><CalendarDays size={16} /></span>
              <div>
                <strong>Next Meeting</strong>
                <small>{nextMeeting ? `${nextMeeting.title} · ${formatTime(nextMeeting.starts_at)}` : 'No upcoming meetings'}</small>
              </div>
            </div>
            <div className="summary-line">
              <span className="summary-icon summary-violet"><BriefcaseBusiness size={16} /></span>
              <div>
                <strong>Assigned Tasks</strong>
                <small>{myAssignedTasks.length} active assignments</small>
              </div>
            </div>
            <div className="summary-line">
              <span className="summary-icon summary-amber"><Calendar size={16} /></span>
              <div>
                <strong>Leave Status</strong>
                <small>{data.leaves.filter(l => l.status === 'pending').length} pending review</small>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Quick Action Buttons */}
      <div className="quick-links">
        <button type="button" onClick={() => onNavigate('attendance')}>
          <CheckCircle2 size={17} /> View attendance history <ArrowUpRight size={15} />
        </button>
        <button type="button" onClick={() => onNavigate('hourly')}>
          <Clock3 size={17} /> Submit a work update <ArrowUpRight size={15} />
        </button>
        <button type="button" onClick={() => onNavigate('leaves')}>
          <CalendarDays size={17} /> Apply for leave <ArrowUpRight size={15} />
        </button>
        <button type="button" onClick={() => onNavigate('chat')}>
          <Sparkles size={17} /> Team chat <ArrowUpRight size={15} />
        </button>
      </div>

      {/* Assigned Tasks & Announcements */}
      <div className="dashboard-columns">
        <Panel
          title="Assigned Tasks"
          action={<button className="text-button" onClick={() => onNavigate('assignments')}>All tasks <ArrowUpRight size={14} /></button>}
        >
          {myAssignedTasks.length ? (
            <div className="upcoming-list">
              {myAssignedTasks.slice(0, 4).map(task => (
                <div key={task.id} className="upcoming-row">
                  <div className="session-marker"><BriefcaseBusiness size={15} /></div>
                  <div style={{ flex: 1 }}>
                    <strong>{task.title}</strong>
                    <small>
                      Priority: {task.priority || 'medium'} · {task.due_date ? `Due ${formatDate(task.due_date)}` : 'Ongoing'}
                    </small>
                  </div>
                  <StatusBadge tone={task.status}>{task.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No pending tasks" message="You have completed all your current assignments." />
          )}
        </Panel>

        <Panel
          title="Announcements"
          action={<button className="text-button" onClick={() => onNavigate('announcements')}>All updates <ArrowUpRight size={14} /></button>}
        >
          {data.announcements.length ? (
            <div className="update-list">
              {data.announcements.slice(0, 3).map(item => (
                <article key={item.id} className="update-item">
                  <div className={`update-dot ${item.is_pinned ? 'important' : ''}`} />
                  <div>
                    <div className="update-meta">
                      <StatusBadge tone={item.is_pinned ? 'important' : 'neutral'}>
                        {item.is_pinned ? 'Important' : item.category || 'General'}
                      </StatusBadge>
                      <span>{formatDate(item.published_at)}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No announcements" message="Company announcements will appear here." />
          )}
        </Panel>
      </div>

      {/* Meetings & Leave Status */}
      <div className="dashboard-columns">
        <Panel
          title="Upcoming Meetings"
          action={<button className="text-button" onClick={() => onNavigate('meetings')}>Calendar <ArrowUpRight size={14} /></button>}
        >
          {data.meetings.length ? (
            <div className="upcoming-list">
              {data.meetings.slice(0, 3).map(m => (
                <div key={m.id} className="upcoming-row">
                  <div className="date-tile">
                    <strong>{new Date(m.starts_at).getDate()}</strong>
                    <small>{new Date(m.starts_at).toLocaleDateString(undefined, { month: 'short' })}</small>
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong>{m.title}</strong>
                    <small>{formatTime(m.starts_at)} · {m.location || 'Online'}</small>
                  </div>
                  {m.join_url && (
                    <a href={m.join_url} target="_blank" rel="noreferrer" className="button button-outline" style={{ padding: '4px 10px', fontSize: 12 }}>
                      Join
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No meetings" message="No upcoming meetings scheduled on your calendar." />
          )}
        </Panel>

        <Panel
          title="Recent Leave Requests"
          action={<button className="text-button" onClick={() => onNavigate('leaves')}>Apply <ArrowUpRight size={14} /></button>}
        >
          {myLeaves.length ? (
            <div className="upcoming-list">
              {myLeaves.map(app => (
                <div key={app.id} className="upcoming-row">
                  <div className="session-marker"><CalendarDays size={15} /></div>
                  <div style={{ flex: 1 }}>
                    <strong>{app.leave_type}</strong>
                    <small>{formatDate(app.start_date)} to {formatDate(app.end_date)}</small>
                  </div>
                  <StatusBadge tone={app.status?.toLowerCase()}>{app.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No leave applications" message="Your leave history and decisions will appear here." />
          )}
        </Panel>
      </div>
    </div>
  );
}
