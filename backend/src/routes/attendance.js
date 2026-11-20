import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { dateInTimeZone, sendDbError } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';
import { selfieStore } from '../utils/selfieStore.js';

const router = Router();

function mapAttendance(row, profile) {
  return {
    ...row,
    check_in: row.check_in || row.created_at || null,
    work_date: row.attendance_date,
    status: (row.attendance_status || 'Present').toLowerCase(),
    work_mode: (row.work_mode || 'Office').toLowerCase().replaceAll(' ', '_'),
    duration_seconds: row.check_out ? (row.working_minutes || 0) * 60 : null,
    profiles: profile || row.employees || null,
    selfie_path: row.selfie_path || selfieStore.get(row.id) || null,
  };
}

function attendanceStatus(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

async function mapAttendanceRows(rows) {
  const profileIds = [...new Set(rows.map(row => row.employees?.auth_user_id).filter(Boolean))];
  if (!profileIds.length) return rows.map(row => mapAttendance(row, null));
  const { data: profiles, error } = await supabase.from('profiles')
    .select('id,full_name,email,department,time_zone').in('id', profileIds);
  if (error) return { error };
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  return rows.map(row => mapAttendance(row, profileById.get(row.employees?.auth_user_id)));
}

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

router.get('/current', async (req, res) => {
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const { data, error } = await supabase.from('attendance').select('*')
    .eq('employee_id', employee.id).is('check_out', null)
    .order('check_in', { ascending: false }).limit(1).maybeSingle();
  if (error) return sendDbError(res, error, 'Could not load your active attendance session.');
  res.json({ attendance: data ? mapAttendance(data, req.profile) : null });
});

router.get('/', async (req, res) => {
  let employeeId = req.query.employeeId;
  if (req.profile.role !== 'admin') {
    const employee = await employeeForRequest(req, res);
    if (!employee) return;
    employeeId = employee.id;
  }
  let query = supabase.from('attendance')
    .select('*, employees(full_name,email,department,auth_user_id)')
    .order('attendance_date', { ascending: false }).limit(250);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (req.query.date) query = query.eq('attendance_date', req.query.date);
  if (req.query.from) query = query.gte('attendance_date', req.query.from);
  if (req.query.to) query = query.lte('attendance_date', req.query.to);
  if (req.query.status) query = query.eq('attendance_status', attendanceStatus(req.query.status));
  const { data, error } = await query;
  if (error) return sendDbError(res, error, 'Could not load attendance.');
  const attendance = await mapAttendanceRows(data);
  if (attendance.error) return sendDbError(res, attendance.error, 'Could not load attendance profiles.');
  res.json({ attendance });
});

router.get('/company-today', requireAdmin, async (_req, res) => {
  const now = new Date();
  const { data, error } = await supabase.from('attendance')
    .select('*, employees(full_name,email,department,auth_user_id)')
    .gte('check_in', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
    .order('check_in', { ascending: false }).limit(2000);
  if (error) return sendDbError(res, error, 'Could not load today’s company attendance.');
  const rows = await mapAttendanceRows(data);
  if (rows.error) return sendDbError(res, rows.error, 'Could not load attendance profiles.');
  const attendance = rows.filter(row =>
    row.attendance_date === dateInTimeZone(now, row.profiles?.time_zone || 'Asia/Kolkata'));
  res.json({ attendance });
});

router.get('/selfie-url', async (req, res) => {
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Path is required.' });
  try {
    const { data, error } = await supabase.storage.from('attendance-selfies').createSignedUrl(path, 60 * 60);
    if (error) {
      return res.status(404).json({ error: error.message || 'Selfie not found in storage.' });
    }
    res.json({ signedUrl: data.signedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not generate selfie URL.' });
  }
});

router.post('/selfie-upload', async (req, res) => {
  const { imageBase64 } = req.body ?? {};
  if (!imageBase64) return res.status(400).json({ error: 'No selfie image provided.' });
  try {
    const today = dateInTimeZone(new Date(), req.profile.time_zone || 'Asia/Kolkata');
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const selfiePath = `${req.user.id}/${today}/${randomUUID()}.jpg`;
    const { data, error } = await supabase.storage
      .from('attendance-selfies')
      .upload(selfiePath, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.warn('Storage upload error, using path reference:', error.message);
    }
    res.status(201).json({ selfiePath });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not upload selfie.' });
  }
});

router.post('/check-in', async (req, res) => {
  const { workMode, selfiePath, selfieBase64 } = req.body ?? {};
  if (!['office', 'work_from_home'].includes(workMode)) {
    return res.status(400).json({ error: 'Choose Office or Work From Home.' });
  }
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const today = dateInTimeZone(new Date(), req.profile.time_zone);

  let finalSelfiePath = selfiePath;
  if (selfieBase64) {
    try {
      const base64Data = selfieBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      finalSelfiePath = `${req.user.id}/${today}/${randomUUID()}.jpg`;
      await supabase.storage
        .from('attendance-selfies')
        .upload(finalSelfiePath, buffer, { contentType: 'image/jpeg', upsert: true });
    } catch (e) {
      console.warn('Could not save selfie buffer:', e.message);
    }
  }

  const { data: active, error: activeError } = await supabase.from('attendance')
    .select('id,attendance_date').eq('employee_id', employee.id).is('check_out', null)
    .order('check_in', { ascending: false }).limit(1).maybeSingle();
  if (activeError) return sendDbError(res, activeError, 'Could not verify your active attendance session.');
  if (active) return res.status(409).json({
    error: active.attendance_date === today
      ? 'You are already checked in today.'
      : `You still have an open attendance session from ${active.attendance_date}. Check out before starting another.`,
    attendance: { ...active, work_date: active.attendance_date },
  });
  const { data: existing, error: findError } = await supabase.from('attendance')
    .select('id,check_in,check_out').eq('employee_id', employee.id).eq('attendance_date', today).maybeSingle();
  if (findError) return sendDbError(res, findError, 'Could not check the current attendance record.');
  if (existing) return res.status(409).json({ error: existing.check_out
    ? 'Attendance has already been completed today.'
    : 'You are already checked in today.', attendance: existing });
  const workModeValue = workMode === 'work_from_home' ? 'Work From Home' : 'Office';
  const checkIn = new Date().toISOString();
  const insertPayload = {
    employee_id: employee.id, attendance_date: today, work_mode: workModeValue,
    attendance_status: 'Present', check_in: checkIn,
  };
  let { data, error } = await supabase.from('attendance')
    .insert({ ...insertPayload, selfie_path: finalSelfiePath || null })
    .select('*').single();

  if (error && (error.code === 'PGRST204' || error.message?.includes('selfie_path'))) {
    ({ data, error } = await supabase.from('attendance').insert(insertPayload).select('*').single());
    if (!error && data && finalSelfiePath) {
      selfieStore.set(data.id, finalSelfiePath);
    }
  } else if (!error && data && finalSelfiePath) {
    selfieStore.set(data.id, finalSelfiePath);
  }
  if (error?.code === '23505') {
    return res.status(409).json({ error: 'An attendance record already exists for today.' });
  }
  if (error) return sendDbError(res, error, 'Could not record your check-in.');
  res.status(201).json({ attendance: mapAttendance(data, req.profile) });
});

router.post('/check-out', async (req, res) => {
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const { data: current, error: findError } = await supabase.from('attendance')
    .select('id,check_in,check_out,created_at').eq('employee_id', employee.id).is('check_out', null)
    .order('check_in', { ascending: false }).limit(1).maybeSingle();
  if (findError) return sendDbError(res, findError, 'Could not load your attendance record.');
  if (!current) return res.status(409).json({ error: 'Check in before checking out.' });
  const checkIn = current.check_in || current.created_at;
  if (!checkIn || Number.isNaN(new Date(checkIn).getTime())) {
    return res.status(409).json({ error: 'This attendance record has no valid check-in time. Contact an administrator before checking out.' });
  }
  const checkOut = new Date();
  const workingMinutes = Math.max(0, Math.floor((checkOut.getTime() - new Date(checkIn).getTime()) / 60000));
  const { data, error } = await supabase.from('attendance').update({
    check_in: checkIn, check_out: checkOut.toISOString(), working_minutes: workingMinutes,
  }).eq('id', current.id).is('check_out', null).select('*').maybeSingle();
  if (error) return sendDbError(res, error, 'Could not record your check-out.');
  if (!data) return res.status(409).json({ error: 'You have already checked out.' });
  res.json({ attendance: mapAttendance(data, req.profile) });
});

router.get('/employees', requireAdmin, async (req, res) => {
  let query = supabase.from('attendance')
    .select('*, employees(full_name,email,department,auth_user_id)')
    .order('attendance_date', { ascending: false }).limit(1000);
  if (req.query.employeeId) query = query.eq('employee_id', req.query.employeeId);
  if (req.query.date) query = query.eq('attendance_date', req.query.date);
  if (req.query.from) query = query.gte('attendance_date', req.query.from);
  if (req.query.to) query = query.lte('attendance_date', req.query.to);
  if (req.query.status) query = query.eq('attendance_status', attendanceStatus(req.query.status));
  const { data, error } = await query;
  if (error) return sendDbError(res, error, 'Could not load company attendance.');
  const attendance = await mapAttendanceRows(data);
  if (attendance.error) return sendDbError(res, attendance.error, 'Could not load attendance profiles.');
  res.json({ attendance });
});

export default router;
