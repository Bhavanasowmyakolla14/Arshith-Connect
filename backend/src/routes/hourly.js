import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { dateInTimeZone, isoWeekday, sendDbError, wallTimeInTimeZone } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();

async function employeeForRequest(req, res) {
  const { employee, error } = await ensureEmployeeRecord(req.profile);
  if (error) {
    sendDbError(res, error, 'Could not load your employee record.');
    return null;
  }
  if (!employee) {
    res.status(409).json({ error: 'Your account is not linked to an employee record.' });
    return null;
  }
  return employee;
}

async function mapUpdates(rows) {
  const profileIds = [...new Set(rows.map(row => row.employees?.auth_user_id).filter(Boolean))];
  let profilesById = new Map();
  if (profileIds.length) {
    const { data: profiles, error } = await supabase.from('profiles')
      .select('id,full_name,email,department').in('id', profileIds);
    if (error) return { error };
    profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  }
  return {
    updates: rows.map(row => ({
      ...row,
      completed_work: row.work_completed,
      current_task: row.current_task || '',
      progress: row.progress || '',
      pending_work: row.pending_work || '',
      profiles: profilesById.get(row.employees?.auth_user_id) || row.employees || null,
      hourly_update_feedback: row.admin_feedback ? [{
        id: row.id,
        comment: row.admin_feedback,
        created_at: row.reviewed_at,
      }] : [],
    })),
  };
}

async function currentAttendance(employeeId, date) {
  return supabase.from('attendance').select('id,employee_id,attendance_date,check_in,check_out')
    .eq('employee_id', employeeId).eq('attendance_date', date).maybeSingle();
}

function updateSlots(attendance, profile, updates, now) {
  const date = attendance.attendance_date;
  const timeZone = profile.time_zone || 'Asia/Kolkata';
  const scheduleStart = wallTimeInTimeZone(date, profile.work_start || '09:00', timeZone);
  const start = new Date(attendance.check_in);
  const reminderStart = start > scheduleStart ? start : scheduleStart;
  const end = wallTimeInTimeZone(date, profile.work_end || '18:00', timeZone);
  const cutoff = attendance.check_out ? new Date(attendance.check_out) : now;
  const submitted = updates.filter(update => update.update_date === date);
  const slots = [];
  const workdays = profile.workdays || [1, 2, 3, 4, 5];
  const scheduledToday = workdays.includes(isoWeekday(date));

  for (let deadline = new Date(reminderStart.getTime() + 3600000), index = 1;
    scheduledToday && deadline <= end && deadline <= cutoff;
    deadline = new Date(deadline.getTime() + 3600000), index += 1) {
    const hasSubmission = submitted.some(update => {
      const submittedAt = new Date(update.submitted_at);
      return submittedAt >= new Date(deadline.getTime() - 3600000) && submittedAt <= deadline;
    });
    slots.push({ index, deadline: deadline.toISOString(), status: hasSubmission ? 'submitted' : 'overdue' });
  }
  const next = new Date(reminderStart.getTime() + (slots.length + 1) * 3600000);
  if (scheduledToday && !attendance.check_out && next <= end) {
    slots.push({ index: slots.length + 1, deadline: next.toISOString(), status: next <= now ? 'overdue' : 'due' });
  }
  return {
    slots,
    nextDeadline: scheduledToday && next <= end ? next.toISOString() : null,
  };
}

router.get('/admin-status', requireAdmin, async (req, res) => {
  const now = new Date();
  const { data: attendance, error: attendanceError } = await supabase.from('attendance')
    .select('id,employee_id,attendance_date,check_in,check_out,employees(id,auth_user_id,full_name,email,department)')
    .gte('check_in', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
  if (attendanceError) return sendDbError(res, attendanceError, 'Could not load today’s update schedule.');

  const profileIds = [...new Set(attendance.map(row => row.employees?.auth_user_id).filter(Boolean))];
  const { data: profiles, error: profileError } = profileIds.length
    ? await supabase.from('profiles')
      .select('id,full_name,email,department,work_start,work_end,time_zone,workdays')
      .in('id', profileIds)
    : { data: [], error: null };
  if (profileError) return sendDbError(res, profileError, 'Could not load employee work schedules.');
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  const todayAttendance = attendance.flatMap(record => {
    const profile = profilesById.get(record.employees?.auth_user_id);
    return profile && record.attendance_date === dateInTimeZone(now, profile.time_zone || 'Asia/Kolkata')
      ? [{ ...record, profile }]
      : [];
  });
  if (!todayAttendance.length) return res.json({ schedules: [] });

  const employeeIds = [...new Set(todayAttendance.map(record => record.employee_id))];
  const dates = todayAttendance.map(record => record.attendance_date).sort();
  const { data: updates, error: updateError } = await supabase.from('hourly_work_updates')
    .select('id,employee_id,update_date,submitted_at')
    .in('employee_id', employeeIds).gte('update_date', dates[0]).lte('update_date', dates.at(-1));
  if (updateError) return sendDbError(res, updateError, 'Could not load hourly submissions.');

  const schedules = todayAttendance.map(record => {
    const profile = record.profile;
    const submittedUpdates = updates.filter(update =>
      update.employee_id === record.employee_id && update.update_date === record.attendance_date);
    const schedule = updateSlots(record, profile, submittedUpdates, now);
    return {
      employee: { ...record.employees, ...profile },
      attendanceId: record.id,
      slots: schedule.slots,
      updates: submittedUpdates,
    };
  });
  res.json({ schedules });
});

router.get('/', async (req, res) => {
  let employeeId = req.query.employeeId;
  if (req.profile.role !== 'admin') {
    const employee = await employeeForRequest(req, res);
    if (!employee) return;
    employeeId = employee.id;
  }
  let query = supabase.from('hourly_work_updates')
    .select('*, employees(full_name,email,department,auth_user_id)')
    .order('submitted_at', { ascending: false }).limit(500);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (req.query.date) query = query.eq('update_date', req.query.date);
  const { data, error } = await query;
  if (error) return sendDbError(res, error, 'Could not load hourly updates.');
  const result = await mapUpdates(data);
  if (result.error) return sendDbError(res, result.error, 'Could not load hourly update profiles.');
  res.json({ updates: result.updates });
});

router.post('/', async (req, res) => {
  const { completedWork, currentTask, progress, pendingWork, blockers, assignmentId } = req.body ?? {};
  if (typeof completedWork !== 'string' || !completedWork.trim()) {
    return res.status(400).json({ error: 'Enter the work you completed.' });
  }
  for (const [label, value] of [
    ['Current task', currentTask],
    ['Progress', progress],
    ['Pending work', pendingWork],
    ['Blockers', blockers],
  ]) {
    if (value != null && typeof value !== 'string') {
      return res.status(400).json({ error: `${label} must be text.` });
    }
  }
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const timeZone = req.profile.time_zone || 'Asia/Kolkata';
  const date = dateInTimeZone(new Date(), timeZone);
  const { data: attendance, error: attendanceError } = await currentAttendance(employee.id, date);
  if (attendanceError) return sendDbError(res, attendanceError, 'Could not verify today’s attendance.');
  if (!attendance || attendance.check_out) {
    return res.status(409).json({ error: 'Hourly updates are available only during an active attendance session.' });
  }

  const reminderStart = new Date(Math.max(
    new Date(attendance.check_in).getTime(),
    wallTimeInTimeZone(date, req.profile.work_start || '09:00', timeZone).getTime(),
  ));
  const now = new Date();
  const shiftEnd = wallTimeInTimeZone(date, req.profile.work_end || '18:00', timeZone);
  if (!(req.profile.workdays || [1, 2, 3, 4, 5]).includes(isoWeekday(date)) || now < reminderStart || now > shiftEnd) {
    return res.status(409).json({ error: 'Work updates are available only during your scheduled work hours.' });
  }

  const slotStart = new Date(reminderStart.getTime()
    + Math.floor((now.getTime() - reminderStart.getTime()) / 3600000) * 3600000);
  const { data: existingUpdate, error: duplicateCheckError } = await supabase.from('hourly_work_updates')
    .select('id').eq('employee_id', employee.id).eq('update_date', date)
    .gte('submitted_at', slotStart.toISOString())
    .lt('submitted_at', new Date(slotStart.getTime() + 3600000).toISOString()).limit(1);
  if (duplicateCheckError) return sendDbError(res, duplicateCheckError, 'Could not verify this hourly update slot.');
  if (existingUpdate.length) {
    return res.status(409).json({ error: 'An update has already been submitted for this hourly slot.' });
  }

  if (assignmentId) {
    const { data: assignment, error: assignmentError } = await supabase.from('work_assignments')
      .select('id').eq('id', assignmentId).eq('employee_id', employee.id).maybeSingle();
    if (assignmentError) return sendDbError(res, assignmentError, 'Could not verify the selected assignment.');
    if (!assignment) return res.status(400).json({ error: 'Choose one of your assigned tasks.' });
  }

  const { data, error } = await supabase.from('hourly_work_updates').insert({
    employee_id: employee.id,
    assignment_id: assignmentId || null,
    update_date: date,
    work_completed: completedWork.trim(),
    current_task: currentTask?.trim() || null,
    progress: progress?.trim() || null,
    pending_work: pendingWork?.trim() || null,
    blockers: blockers?.trim() || null,
  }).select('*, employees(full_name,email,department,auth_user_id)').single();
  if (error) return sendDbError(res, error, 'Could not submit hourly update.');
  const result = await mapUpdates([data]);
  if (result.error) return sendDbError(res, result.error, 'Update was saved, but its employee profile could not be loaded.');
  res.status(201).json({ update: result.updates[0] });
});

router.post('/:id/feedback', requireAdmin, async (req, res) => {
  const { comment } = req.body ?? {};
  if (typeof comment !== 'string' || !comment.trim()) return res.status(400).json({ error: 'Feedback is required.' });
  const { data, error } = await supabase.from('hourly_work_updates').update({
    admin_feedback: comment.trim(),
    reviewed_by: req.profile.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', req.params.id)
    .select('id,admin_feedback,reviewed_by,reviewed_at').maybeSingle();
  if (error) return sendDbError(res, error, 'Could not add feedback.');
  if (!data) return res.status(404).json({ error: 'Hourly update not found.' });
  res.status(201).json({ feedback: {
    id: data.id, comment: data.admin_feedback, reviewed_by: data.reviewed_by, created_at: data.reviewed_at,
  } });
});

router.get('/status', async (req, res) => {
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const date = dateInTimeZone(new Date(), req.profile.time_zone || 'Asia/Kolkata');
  const { data: attendance, error: attendanceError } = await currentAttendance(employee.id, date);
  if (attendanceError) return sendDbError(res, attendanceError, 'Could not load today’s work schedule.');
  if (!attendance) return res.json({ active: false, slots: [], nextDeadline: null });
  const { data: updates, error: updateError } = await supabase.from('hourly_work_updates')
    .select('id,update_date,submitted_at').eq('employee_id', employee.id).eq('update_date', date)
    .order('submitted_at');
  if (updateError) return sendDbError(res, updateError, 'Could not load update deadlines.');
  const schedule = updateSlots(attendance, req.profile, updates, attendance.check_out ? new Date(attendance.check_out) : new Date());
  res.json({ active: !attendance.check_out, slots: schedule.slots, nextDeadline: schedule.nextDeadline });
});

export default router;
