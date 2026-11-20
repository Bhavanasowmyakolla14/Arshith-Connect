import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();
const types = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Other'];
const leaveStatuses = ['pending', 'approved', 'rejected'];

function mapApplication(application, profile = application.employees) {
  return {
    ...application,
    starts_on: application.start_date,
    ends_on: application.end_date,
    status: application.status.toLowerCase(),
    review_note: application.admin_comment,
    reviewer_id: application.reviewed_by,
    profiles: profile,
  };
}

async function mapApplications(rows) {
  const profileIds = [...new Set(rows.map(row => row.employees?.auth_user_id).filter(Boolean))];
  if (!profileIds.length) return { applications: rows.map(row => mapApplication(row)) };
  const { data: profiles, error } = await supabase.from('profiles')
    .select('id,full_name,email,department').in('id', profileIds);
  if (error) return { error };
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  return {
    applications: rows.map(row => mapApplication(
      row, profileById.get(row.employees?.auth_user_id) || row.employees,
    )),
  };
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

router.get('/', async (req, res) => {
  let employeeId = req.query.employeeId;
  if (req.profile.role !== 'admin') {
    const employee = await employeeForRequest(req, res);
    if (!employee) return;
    employeeId = employee.id;
  }
  let query = supabase.from('leave_applications')
    .select('*, employees(full_name,email,department,auth_user_id)')
    .order('created_at', { ascending: false }).limit(300);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (req.query.status) {
    const requestedStatus = String(req.query.status).toLowerCase();
    if (!leaveStatuses.includes(requestedStatus)) return res.status(400).json({ error: 'Choose a valid leave status.' });
    query = query.eq('status', requestedStatus[0].toUpperCase() + requestedStatus.slice(1));
  }
  const { data, error } = await query;
  if (error) return sendDbError(res, error, 'Could not load leave applications.');
  const result = await mapApplications(data);
  if (result.error) return sendDbError(res, result.error, 'Could not load leave applicant profiles.');
  res.json({ applications: result.applications });
});

router.post('/', async (req, res) => {
  const { leaveType, startsOn, endsOn, reason } = req.body ?? {};
  if (!types.includes(leaveType) || !startsOn || !endsOn || endsOn < startsOn || !reason?.trim()) {
    return res.status(400).json({ error: 'Provide a leave type, valid date range, and reason.' });
  }
  const employee = await employeeForRequest(req, res);
  if (!employee) return;
  const { data, error } = await supabase.from('leave_applications').insert({
    employee_id: employee.id,
    leave_type: leaveType,
    start_date: startsOn,
    end_date: endsOn,
    reason: reason.trim(),
    status: 'Pending',
  }).select('*, employees(full_name,email,department,auth_user_id)').single();
  if (error) return sendDbError(res, error, 'Could not submit leave application.');
  const result = await mapApplications([data]);
  if (result.error) return sendDbError(res, result.error, 'Application was saved, but its employee profile could not be loaded.');
  res.status(201).json({ application: result.applications[0] });
});

router.patch('/:id/review', requireAdmin, async (req, res) => {
  const { status, reviewNote } = req.body ?? {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Choose approved or rejected.' });
  }
  const decision = status[0].toUpperCase() + status.slice(1);
  const { data, error } = await supabase.from('leave_applications').update({
    status: decision,
    reviewed_by: req.profile.id,
    admin_comment: reviewNote?.trim() || null,
    reviewed_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('status', 'Pending')
    .select('*, employees(full_name,email,department,auth_user_id)').maybeSingle();
  if (error) return sendDbError(res, error, 'Could not review leave application.');
  if (!data) return res.status(409).json({ error: 'This leave application is no longer pending.' });
  const result = await mapApplications([data]);
  if (result.error) return sendDbError(res, result.error, 'Leave was reviewed, but the employee profile could not be loaded.');
  res.json({ application: result.applications[0] });
});

export default router;
