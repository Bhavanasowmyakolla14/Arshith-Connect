import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';
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

router.get('/', async (req, res) => {
  const employee = req.profile.role === 'employee' ? await employeeForRequest(req, res) : null;
  if (req.profile.role === 'employee' && !employee) return;

  const { data, error } = await supabase.from('announcements').select('*')
    .order('published_at', { ascending: false }).limit(100);
  if (error) return sendDbError(res, error, 'Could not load announcements.');

  const now = Date.now();
  const announcements = data.filter(item => !item.expires_at || new Date(item.expires_at).getTime() > now);
  if (!employee || announcements.length === 0) {
    return res.json({
      announcements: announcements.map(item => ({
        ...item,
        important: item.is_pinned,
        announcement_recipients: [],
      })),
    });
  }

  const { data: reads, error: readsError } = await supabase.from('announcement_reads')
    .select('announcement_id,read_at').eq('employee_id', employee.id)
    .in('announcement_id', announcements.map(item => item.id));
  if (readsError) return sendDbError(res, readsError, 'Could not load announcement read status.');
  const readById = new Map(reads.map(read => [read.announcement_id, read.read_at]));
  res.json({
    announcements: announcements.map(item => ({
      ...item,
      important: item.is_pinned,
      announcement_recipients: readById.has(item.id)
        ? [{ employee_id: req.profile.id, read_at: readById.get(item.id) }]
        : [],
    })),
  });
});

router.post('/', requireAdmin, async (req, res) => {
  const { title, description, category, important, expiresAt } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Announcement title and description are required.' });
  }
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    return res.status(400).json({ error: 'Choose a valid announcement expiry date.' });
  }
  const { data, error } = await supabase.from('announcements').insert({
    created_by: req.profile.id,
    title: title.trim(),
    description: description.trim(),
    category: category || 'General',
    is_pinned: Boolean(important),
    expires_at: expiresAt || null,
  }).select('*').single();
  if (error) return sendDbError(res, error, 'Could not publish announcement.');
  res.status(201).json({
    announcement: { ...data, important: data.is_pinned, announcement_recipients: [] },
  });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const allowedFields = {
    title: 'title',
    description: 'description',
    category: 'category',
    important: 'is_pinned',
    expiresAt: 'expires_at',
  };
  const updates = Object.fromEntries(Object.entries(allowedFields)
    .filter(([key]) => key in (req.body ?? {}))
    .map(([key, column]) => [column, key === 'important' ? Boolean(req.body[key]) : req.body[key]]));
  if ('title' in updates && (typeof updates.title !== 'string' || !updates.title.trim())) {
    return res.status(400).json({ error: 'Title cannot be empty.' });
  }
  if ('description' in updates && (typeof updates.description !== 'string' || !updates.description.trim())) {
    return res.status(400).json({ error: 'Description cannot be empty.' });
  }
  if (updates.expires_at && Number.isNaN(Date.parse(updates.expires_at))) {
    return res.status(400).json({ error: 'Choose a valid announcement expiry date.' });
  }
  const { data, error } = await supabase.from('announcements').update(updates)
    .eq('id', req.params.id).select('*').single();
  if (error) return sendDbError(res, error, 'Could not update announcement.');
  res.json({ announcement: { ...data, important: data.is_pinned } });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('announcements').delete().eq('id', req.params.id);
  if (error) return sendDbError(res, error, 'Could not delete announcement.');
  res.status(204).end();
});

router.post('/:id/read', async (req, res) => {
  if (req.profile.role !== 'employee') {
    return res.status(403).json({ error: 'Only employees can mark announcements as read.' });
  }
  const employee = await employeeForRequest(req, res);
  if (!employee) return;

  const { data: existing, error: lookupError } = await supabase.from('announcement_reads')
    .select('id,announcement_id,employee_id,read_at')
    .eq('announcement_id', req.params.id).eq('employee_id', employee.id).limit(1).maybeSingle();
  if (lookupError) return sendDbError(res, lookupError, 'Could not load announcement read status.');
  if (existing) return res.json({ receipt: { ...existing, employee_id: req.profile.id } });

  const { data, error } = await supabase.from('announcement_reads').insert({
    announcement_id: req.params.id,
    employee_id: employee.id,
  }).select('id,announcement_id,employee_id,read_at').single();
  if (error) return sendDbError(res, error, 'Could not mark announcement as read.');
  res.json({ receipt: { ...data, employee_id: req.profile.id } });
});

export default router;
