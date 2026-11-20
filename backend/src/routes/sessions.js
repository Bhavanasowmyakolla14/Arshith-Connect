import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();

async function findProfileByEmployeeId(employeeId) {
  const { data: employee, error: employeeError } = await supabase.from('employees')
    .select('id,auth_user_id,employee_code,full_name,email,phone,department,designation,joining_date,work_mode,status')
    .eq('id', employeeId).maybeSingle();
  if (employeeError || !employee?.auth_user_id) return { profile: null, employee, error: employeeError };
  const { data: profile, error } = await supabase.from('profiles')
    .select('id,full_name,email,role,is_active').eq('id', employee.auth_user_id).maybeSingle();
  return { profile, employee, error };
}

router.post('/start', async (req, res) => {
  const { employee, error: employeeError } = await ensureEmployeeRecord(req.profile);
  if (employeeError) return sendDbError(res, employeeError, 'Could not load your employee record.');
  if (!employee) return res.status(409).json({ error: 'Your account is not linked to an employee record.' });
  const { data: stale, error: staleError } = await supabase
    .from('employee_sessions')
    .update({ session_status: 'Incomplete' })
    .eq('employee_id', employee.id)
    .eq('session_status', 'Active')
    .is('logout_at', null)
    .select('id');
  if (staleError) return sendDbError(res, staleError, 'Could not reconcile previous sessions.');

  const { data, error } = await supabase
    .from('employee_sessions')
    .insert({ employee_id: employee.id, session_status: 'Active' })
    .select('id, login_at, logout_at, session_status')
    .single();
  if (error) return sendDbError(res, error, 'Could not record this login.');
  res.status(201).json({ session: { ...data, status: 'active' }, reconciledIncompleteSessions: stale?.length ?? 0 });
});

router.patch('/:id/end', async (req, res) => {
  const { employee, error: employeeError } = await ensureEmployeeRecord(req.profile);
  if (employeeError) return sendDbError(res, employeeError, 'Could not load your employee record.');
  const { data: current, error: readError } = await supabase.from('employee_sessions')
    .select('id, employee_id, login_at, logout_at, session_status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (readError) return sendDbError(res, readError, 'Could not find the login session.');
  if (!current || current.employee_id !== employee?.id) {
    return res.status(404).json({ error: 'Login session not found.' });
  }
  if (current.logout_at) return res.json({ session: {
    ...current,
    status: current.session_status.toLowerCase(),
    duration_seconds: Math.max(0, Math.floor((new Date(current.logout_at) - new Date(current.login_at)) / 1000)),
  } });

  const logoutAt = new Date().toISOString();
  const { data, error } = await supabase.from('employee_sessions')
    .update({ logout_at: logoutAt, session_status: 'Completed' })
    .eq('id', current.id).is('logout_at', null)
    .select('id,employee_id,login_at,logout_at,session_status').maybeSingle();
  if (error) return sendDbError(res, error, 'Could not record this logout.');
  if (!data) return res.status(409).json({ error: 'This login session has already ended.' });
  res.json({ session: {
    ...data,
    status: data.session_status.toLowerCase(),
    duration_seconds: Math.max(0, Math.floor((new Date(data.logout_at) - new Date(data.login_at)) / 1000)),
  } });
});

router.get('/', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  let employeeId = req.query.employeeId;
  if (req.profile.role !== 'admin') {
    const { employee, error: employeeError } = await ensureEmployeeRecord(req.profile);
    if (employeeError) return sendDbError(res, employeeError, 'Could not load your employee record.');
    if (!employee) return res.json({ sessions: [], total: 0, offset, limit });
    employeeId = employee.id;
  }
  let query = supabase.from('employee_sessions')
    .select('id, employee_id, login_at, logout_at, session_status, created_at, employees(full_name,email,department)', { count: 'exact' })
    .order('login_at', { ascending: false }).range(offset, offset + limit - 1);
  if (employeeId) query = query.eq('employee_id', employeeId);
  const { data, error, count } = await query;
  if (error) return sendDbError(res, error, 'Could not load login history.');
  const sessions = data.map(session => ({
    ...session,
    status: session.session_status.toLowerCase(),
    duration_seconds: session.logout_at
      ? Math.max(0, Math.floor((new Date(session.logout_at) - new Date(session.login_at)) / 1000))
      : null,
    profiles: session.employees,
  }));
  res.json({ sessions, total: count ?? sessions.length, offset, limit });
});

router.get('/employees', requireAdmin, async (req, res) => {
  const { data: profiles, error: profileError } = await supabase.from('profiles')
    .select('*').eq('role', 'employee').order('full_name');
  if (profileError) return sendDbError(res, profileError, 'Could not load employee profiles.');
  const employeeRecords = await Promise.all(profiles.map(profile => ensureEmployeeRecord(profile)));
  const employeeError = employeeRecords.find(result => result.error)?.error;
  if (employeeError) return sendDbError(res, employeeError, 'Could not synchronize employee records.');
  const employees = profiles.flatMap((profile, index) => {
    const employee = employeeRecords[index].employee;
    return employee ? [{
      ...employee,
      profile_id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      department: profile.department || employee.department,
      job_title: profile.job_title || employee.designation,
      is_active: profile.is_active !== false,
      work_start: profile.work_start || '09:00',
      work_end: profile.work_end || '18:00',
      workdays: profile.workdays || [1, 2, 3, 4, 5],
      time_zone: profile.time_zone || 'Asia/Kolkata',
      created_at: profile.created_at,
    }] : [];
  });
  res.json({ employees });
});

router.post('/employees/invite', requireAdmin, async (req, res) => {
  const {
    fullName, employeeCode, email, phone, department, designation, joiningDate, workMode, status,
  } = req.body ?? {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedCode = typeof employeeCode === 'string' ? employeeCode.trim().toUpperCase() : '';
  const name = typeof fullName === 'string' ? fullName.trim() : '';
  const allowedWorkModes = ['Office', 'Remote', 'Hybrid'];
  const allowedStatuses = ['Active', 'Inactive'];
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || !/^[A-Z0-9_-]{1,50}$/.test(normalizedCode)
    || (phone != null && typeof phone !== 'string')
    || (department != null && typeof department !== 'string')
    || (designation != null && typeof designation !== 'string')
    || (joiningDate && (typeof joiningDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)))
    || !allowedWorkModes.includes(workMode) || !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Provide valid employee details, employee code, email, work mode, and account status.' });
  }

  const [{ data: emailMatch, error: emailError }, { data: codeMatch, error: codeError }] = await Promise.all([
    supabase.from('employees').select('id').eq('email', normalizedEmail).limit(1).maybeSingle(),
    supabase.from('employees').select('id').ilike('employee_code', normalizedCode).limit(1).maybeSingle(),
  ]);
  if (emailError) return sendDbError(res, emailError, 'Could not verify the employee email address.');
  if (codeError) return sendDbError(res, codeError, 'Could not verify the employee code.');
  if (emailMatch) return res.status(409).json({ error: 'An employee with this email address already exists.' });
  if (codeMatch) return res.status(409).json({ error: 'This employee code is already in use.' });

  let temporaryPassword = null;
  let authUser;
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
    data: { full_name: name },
    redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/`,
  });
  if (inviteError) {
    const duplicate = /already|registered|exists/i.test(inviteError.message);
    if (duplicate) return res.status(409).json({ error: 'An account with this email already exists.' });
    const emailDeliveryFailure = /email|smtp|mail|send|provider|not configured|disabled/i.test(inviteError.message);
    if (!emailDeliveryFailure) return sendDbError(res, inviteError, 'Could not create the employee auth account.');
    temporaryPassword = `${randomBytes(32).toString('base64url')}Aa1!`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (createError) {
      const createDuplicate = /already|registered|exists/i.test(createError.message);
      if (createDuplicate) return res.status(409).json({ error: 'An account with this email already exists.' });
      return sendDbError(res, createError, 'Could not create an employee account after email invitation delivery failed.');
    }
    authUser = created.user;
  } else {
    authUser = invited.user;
  }

  const profileId = authUser.id;
  const rollbackAccount = async () => {
    const { error: employeeDeleteError } = await supabase.from('employees').delete().eq('auth_user_id', profileId);
    if (employeeDeleteError) console.error('Could not roll back employee record after invitation setup failed.', employeeDeleteError);
    const { error: profileDeleteError } = await supabase.from('profiles').delete().eq('id', profileId);
    if (profileDeleteError) console.error('Could not roll back employee profile after invitation setup failed.', profileDeleteError);
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(profileId);
    if (authDeleteError) console.error('Could not roll back invited auth user after setup failed.', authDeleteError);
  };

  const { error: profileInsertError } = await supabase.from('profiles').insert({
    id: profileId,
    email: normalizedEmail,
    full_name: name,
    role: 'employee',
    department: department?.trim() || null,
    job_title: designation?.trim() || null,
    is_active: status === 'Active',
    must_change_password: Boolean(temporaryPassword),
  });
  if (profileInsertError) {
    await rollbackAccount();
    if (profileInsertError.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    return sendDbError(res, profileInsertError, 'Could not create the employee profile. The invitation was rolled back.');
  }

  const { data: employee, error: employeeInsertError } = await supabase.from('employees').insert({
    auth_user_id: profileId,
    employee_code: normalizedCode,
    full_name: name,
    email: normalizedEmail,
    phone: phone?.trim() || null,
    department: department?.trim() || null,
    designation: designation?.trim() || null,
    joining_date: joiningDate || null,
    work_mode: workMode,
    status,
  }).select('*').single();
  if (employeeInsertError) {
    await rollbackAccount();
    if (employeeInsertError.code === '23505') {
      return res.status(409).json({ error: 'The email or employee code is already in use.' });
    }
    return sendDbError(res, employeeInsertError, 'Could not create the employee record. The invitation was rolled back.');
  }
  res.status(201).json({
    employee: {
      ...employee,
      profile_id: profileId,
      job_title: employee.designation,
      is_active: status === 'Active',
    },
    invitationSent: !temporaryPassword,
    ...(temporaryPassword ? { temporaryPassword } : {}),
  });
});

router.patch('/employees/:id/schedule', requireAdmin, async (req, res) => {
  const { workStart, workEnd, workdays, timeZone } = req.body ?? {};
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  let validTimeZone = true;
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { validTimeZone = false; }
  if (!validTime(workStart) || !validTime(workEnd) || !validTimeZone || !Array.isArray(workdays)
    || workdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
    return res.status(400).json({ error: 'Provide valid working times and weekdays (1=Monday through 7=Sunday).' });
  }
  const { profile, error: profileError } = await findProfileByEmployeeId(req.params.id);
  if (profileError) return sendDbError(res, profileError, 'Could not load the employee profile.');
  if (!profile || profile.role !== 'employee') return res.status(404).json({ error: 'Employee not found.' });
  const { data, error } = await supabase.from('profiles').update({
    work_start: workStart, work_end: workEnd, workdays, time_zone: timeZone,
  }).eq('id', profile.id).eq('role', 'employee')
    .select('id,full_name,work_start,work_end,workdays,time_zone').single();
  if (error) return sendDbError(res, error, 'Could not update the employee schedule.');
  res.json({ employee: data });
});

router.patch('/employees/:id', requireAdmin, async (req, res) => {
  const allowedFields = [
    'full_name', 'department', 'job_title', 'is_active',
    'employee_code', 'phone', 'joining_date', 'work_mode',
  ];
  const updates = {};
  for (const field of allowedFields) {
    if (!(field in (req.body ?? {}))) continue;
    const value = req.body[field];
    if (field === 'is_active') {
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false.' });
      updates.is_active = value;
    } else {
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: `${field} must be text.` });
      }
      if (field === 'full_name' && !value?.trim()) {
        return res.status(400).json({ error: 'Employee name cannot be empty.' });
      }
      updates[field] = typeof value === 'string' ? value.trim() || null : null;
    }
  }
  if ('employee_code' in updates) {
    if (!/^[A-Z0-9_-]{1,50}$/.test(updates.employee_code || '')) {
      return res.status(400).json({ error: 'Employee code may contain only letters, numbers, hyphens, and underscores.' });
    }
    const { data: duplicate, error: duplicateError } = await supabase.from('employees')
      .select('id').ilike('employee_code', updates.employee_code).neq('id', req.params.id).limit(1).maybeSingle();
    if (duplicateError) return sendDbError(res, duplicateError, 'Could not verify the employee code.');
    if (duplicate) return res.status(409).json({ error: 'This employee code is already in use.' });
    updates.employee_code = updates.employee_code.toUpperCase();
  }
  if ('joining_date' in updates && updates.joining_date
    && !/^\d{4}-\d{2}-\d{2}$/.test(updates.joining_date)) {
    return res.status(400).json({ error: 'Joining date must be a valid calendar date.' });
  }
  if ('work_mode' in updates && !['Office', 'Remote', 'Hybrid'].includes(updates.work_mode)) {
    return res.status(400).json({ error: 'Work mode must be Office, Remote, or Hybrid.' });
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide employee fields to update.' });

  const { profile, employee, error: lookupError } = await findProfileByEmployeeId(req.params.id);
  if (lookupError) return sendDbError(res, lookupError, 'Could not load the employee profile.');
  if (!profile || profile.role !== 'employee') return res.status(404).json({ error: 'Employee not found.' });
  const profileUpdates = {};
  const employeeUpdates = { updated_at: new Date().toISOString() };
  if ('full_name' in updates) {
    profileUpdates.full_name = updates.full_name;
    employeeUpdates.full_name = updates.full_name;
  }
  if ('department' in updates) {
    profileUpdates.department = updates.department;
    employeeUpdates.department = updates.department;
  }
  if ('job_title' in updates) {
    profileUpdates.job_title = updates.job_title;
    employeeUpdates.designation = updates.job_title;
  }
  for (const field of ['employee_code', 'phone', 'joining_date', 'work_mode']) {
    if (field in updates) employeeUpdates[field] = updates[field];
  }
  if ('is_active' in updates) {
    profileUpdates.is_active = updates.is_active;
    employeeUpdates.status = updates.is_active ? 'Active' : 'Inactive';
  }
  if (Object.keys(profileUpdates).length) {
    const { error } = await supabase.from('profiles').update(profileUpdates).eq('id', profile.id);
    if (error) return sendDbError(res, error, 'Could not update employee profile details.');
  }
  const { error: employeeUpdateError } = await supabase.from('employees')
    .update(employeeUpdates).eq('id', employee.id);
  if (employeeUpdateError) return sendDbError(res, employeeUpdateError, 'Could not synchronize employee details.');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
  if (error) return sendDbError(res, error, 'Employee was updated, but refreshed details could not be loaded.');
  res.json({ employee: {
    ...employee, ...data, id: employee.id,
    employee_code: 'employee_code' in employeeUpdates ? employeeUpdates.employee_code : employee.employee_code,
    phone: 'phone' in employeeUpdates ? employeeUpdates.phone : employee.phone,
    joining_date: 'joining_date' in employeeUpdates ? employeeUpdates.joining_date : employee.joining_date,
    work_mode: 'work_mode' in employeeUpdates ? employeeUpdates.work_mode : employee.work_mode,
    job_title: 'designation' in employeeUpdates ? employeeUpdates.designation : data.job_title || employee.designation,
    is_active: data.is_active !== false,
  } });
});

export default router;
