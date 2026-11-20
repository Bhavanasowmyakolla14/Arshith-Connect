import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';

const router = Router();

function withEmployeeProfile(row) {
  return {
    ...row,
    profiles: row.employees || null,
  };
}

router.get('/', requireAdmin, async (req, res) => {
  const { employeeId, from, to } = req.query;
  const [attendanceResult, leaveResult, assignmentResult, updateResult, meetingResult] = await Promise.all([
    (() => {
      let query = supabase.from('attendance').select('*, employees(full_name,email,department)')
        .order('attendance_date', { ascending: false }).limit(5000);
      if (employeeId) query = query.eq('employee_id', employeeId);
      if (from) query = query.gte('attendance_date', from);
      if (to) query = query.lte('attendance_date', to);
      return query;
    })(),
    (() => {
      let query = supabase.from('leave_applications').select('*, employees(full_name,email,department)')
        .order('start_date', { ascending: false }).limit(5000);
      if (employeeId) query = query.eq('employee_id', employeeId);
      if (from) query = query.lte('start_date', to || '9999-12-31');
      if (to) query = query.gte('end_date', from || '0001-01-01');
      return query;
    })(),
    (() => {
      let query = supabase.from('work_assignments').select('*, employees(full_name,email,department)')
        .order('created_at', { ascending: false }).limit(5000);
      if (employeeId) query = query.eq('employee_id', employeeId);
      if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
      if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
      return query;
    })(),
    (() => {
      let query = supabase.from('hourly_work_updates').select('*, employees(full_name,email,department)')
        .order('submitted_at', { ascending: false }).limit(5000);
      if (employeeId) query = query.eq('employee_id', employeeId);
      if (from) query = query.gte('update_date', from);
      if (to) query = query.lte('update_date', to);
      return query;
    })(),
    (() => {
      let query = supabase.from('meetings')
        .select('*, meeting_participants(employee_id,joined_at,join_status,employees(full_name,email))')
        .order('meeting_date', { ascending: false }).limit(5000);
      if (from) query = query.gte('meeting_date', from);
      if (to) query = query.lte('meeting_date', to);
      return query;
    })(),
  ]);
  const results = [
    [attendanceResult, 'Could not load attendance report.'],
    [leaveResult, 'Could not load leave report.'],
    [assignmentResult, 'Could not load assignment report.'],
    [updateResult, 'Could not load hourly update report.'],
    [meetingResult, 'Could not load meeting report.'],
  ];
  for (const [result, message] of results) {
    if (result.error) return sendDbError(res, result.error, message);
  }
  const meetingRows = employeeId
    ? meetingResult.data.filter(meeting =>
      meeting.meeting_participants.some(participant => participant.employee_id === employeeId))
    : meetingResult.data;
  const meetings = meetingRows.map(meeting => ({
    ...meeting,
    starts_at: `${meeting.meeting_date}T${meeting.start_time}`,
    ends_at: meeting.end_time ? `${meeting.meeting_date}T${meeting.end_time}` : null,
    cancelled_at: meeting.status === 'Cancelled' ? meeting.created_at : null,
    meeting_participants: meeting.meeting_participants.map(participant => ({
      ...participant,
      verified_joined_at: null,
      profiles: participant.employees,
    })),
  }));
  res.json({
    attendance: attendanceResult.data.map(row => withEmployeeProfile({
      ...row,
      work_date: row.attendance_date,
      duration_seconds: row.working_minutes == null ? null : row.working_minutes * 60,
    })),
    leaves: leaveResult.data.map(row => withEmployeeProfile({
      ...row,
      starts_on: row.start_date,
      ends_on: row.end_date,
      review_note: row.admin_comment,
    })),
    assignments: assignmentResult.data.map(row => withEmployeeProfile({
      ...row,
      starts_on: row.start_date,
      due_on: row.due_date,
    })),
    updates: updateResult.data.map(row => withEmployeeProfile({
      ...row,
      completed_work: row.work_completed,
    })),
    meetings,
  });
});

export default router;
