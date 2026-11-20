import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();
const states = ['pending', 'in_progress', 'completed'];

function normalizeState(value) {
  const normalized = value?.toLowerCase().replaceAll(' ', '_');
  return states.includes(normalized) ? normalized : 'pending';
}

function mapAssignment(row) {
  return {
    ...row,
    employee_id: row.employee_id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    priority: row.priority?.toLowerCase() || 'medium',
    status: normalizeState(row.status),
    starts_on: row.start_date,
    due_on: row.due_date,
    profiles: row.employees ? {
      full_name: row.employees.full_name,
      email: row.employees.email,
      department: row.employees.department,
    } : null,
    assignment_updates: (row.work_assignment_updates || []).map(update => ({
      id: update.id,
      status: normalizeState(update.status),
      comment: update.comment,
      created_at: update.created_at,
    })),
  };
}

router.get('/', async (req, res) => {
  let employeeId;
  if (req.profile.role !== 'admin') {
    const { employee, error: employeeError } = await ensureEmployeeRecord(req.profile);
    if (employeeError) return sendDbError(res, employeeError, 'Could not load your employee record.');
    if (!employee) return res.json({ assignments: [] });
    employeeId = employee.id;
  }
  let query = supabase.from('work_assignments')
    .select('*, employees(full_name,email,department), work_assignment_updates(*)')
    .order('created_at', { ascending: false }).limit(300);
  if (employeeId) query = query.eq('employee_id', employeeId);
  else if (req.query.employeeId) query = query.eq('employee_id', req.query.employeeId);
  const { data, error } = await query;
  if (error) return sendDbError(res, error, 'Could not load assignments.');
  res.json({ assignments: data.map(mapAssignment) });
});

router.post('/', requireAdmin, async (req, res) => {
  const { employeeId, title, description, instructions, priority, startsOn, dueOn } = req.body ?? {};
  if (!employeeId || !title?.trim() || !['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Choose an employee, title, and valid priority.' });
  }
  const { data: assignee, error: assigneeError } = await supabase.from('employees')
    .select('id').eq('id', employeeId).eq('status', 'Active').maybeSingle();
  if (assigneeError) return sendDbError(res, assigneeError, 'Could not verify the selected employee.');
  if (!assignee) return res.status(400).json({ error: 'Choose an active employee for this assignment.' });
  const { data, error } = await supabase.from('work_assignments').insert({
    assigned_by: req.profile.id, employee_id: employeeId, title: title.trim(),
    description: description || null, instructions: instructions || null,
    priority: priority[0].toUpperCase() + priority.slice(1), status: 'Pending',
    start_date: startsOn || null, due_date: dueOn || null,
  }).select('*, employees(full_name,email,department), work_assignment_updates(*)').single();
  if (error) return sendDbError(res, error, 'Could not create assignment.');
  res.status(201).json({ assignment: mapAssignment(data) });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const fields = { employeeId: 'employee_id', title: 'title', description: 'description',
    instructions: 'instructions', priority: 'priority', startsOn: 'start_date', dueOn: 'due_date', status: 'status' };
  const updates = Object.fromEntries(Object.entries(fields)
    .filter(([key]) => key in (req.body ?? {})).map(([key, column]) => [column, req.body[key]]));
  if (updates.employee_id) {
    const { data: assignee, error: assigneeError } = await supabase.from('employees')
      .select('id').eq('id', updates.employee_id).eq('status', 'Active').maybeSingle();
    if (assigneeError) return sendDbError(res, assigneeError, 'Could not verify the selected employee.');
    if (!assignee) return res.status(400).json({ error: 'Choose an active employee for this assignment.' });
  }
  if (updates.priority) updates.priority = updates.priority[0].toUpperCase() + updates.priority.slice(1);
  if (updates.status) {
    const normalizedStatus = updates.status.toLowerCase().replaceAll(' ', '_');
    if (!states.includes(normalizedStatus)) return res.status(400).json({ error: 'Choose a valid task status.' });
    updates.status = normalizedStatus.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  }
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('work_assignments').update(updates)
    .eq('id', req.params.id).select('*, employees(full_name,email,department), work_assignment_updates(*)').single();
  if (error) return sendDbError(res, error, 'Could not update assignment.');
  res.json({ assignment: mapAssignment(data) });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('work_assignments').delete().eq('id', req.params.id);
  if (error) return sendDbError(res, error, 'Could not delete assignment.');
  res.status(204).end();
});

router.post('/:id/updates', async (req, res) => {
  const { status, comment } = req.body ?? {};
  if (!states.includes(status) || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'Choose a task status and enter an update.' });
  }
  let employee;
  if (req.profile.role !== 'admin') {
    const result = await ensureEmployeeRecord(req.profile);
    if (result.error) return sendDbError(res, result.error, 'Could not load your employee record.');
    employee = result.employee;
    if (!employee) return res.status(404).json({ error: 'Assignment not found.' });
  }
  let query = supabase.from('work_assignments').select('id,employee_id').eq('id', req.params.id);
  if (employee) query = query.eq('employee_id', employee.id);
  const { data: assignment, error: assignmentError } = await query.maybeSingle();
  if (assignmentError) return sendDbError(res, assignmentError, 'Could not verify assignment.');
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  const capitalizedStatus = status.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const { data, error } = await supabase.from('work_assignment_updates').insert({
    assignment_id: assignment.id, employee_id: assignment.employee_id,
    status, comment: comment.trim(),
  }).select('*').single();
  if (error) return sendDbError(res, error, 'Could not submit task update.');
  const { error: updateError } = await supabase.from('work_assignments')
    .update({ status: capitalizedStatus, updated_at: new Date().toISOString() }).eq('id', assignment.id);
  if (updateError) return sendDbError(res, updateError, 'Update was saved, but assignment status could not be changed.');
  res.status(201).json({ update: data });
});

export default router;
