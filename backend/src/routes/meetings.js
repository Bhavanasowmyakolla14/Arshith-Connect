import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { isHttpUrl, sendDbError } from '../utils/http.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();
const meetingSelect = '*, meeting_participants(employee_id,join_status,joined_at,employees(full_name,email,department,auth_user_id))';

function mapMeeting(meeting) {
  const participants = (meeting.meeting_participants || []).map(participant => ({
    ...participant,
    profile_id: participant.employees?.auth_user_id || null,
    profiles: participant.employees || null,
  }));
  return {
    ...meeting,
    starts_at: `${meeting.meeting_date}T${meeting.start_time}`,
    ends_at: meeting.end_time ? `${meeting.meeting_date}T${meeting.end_time}` : null,
    join_url: meeting.meeting_link,
    cancelled_at: meeting.status === 'Cancelled' ? meeting.updated_at || meeting.created_at : null,
    meeting_participants: participants,
  };
}

function validDateAndTime(date, time) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)
    && !Number.isNaN(Date.parse(`${date}T${time}`));
}

router.get('/', async (req, res) => {
  let employee;
  if (req.profile.role !== 'admin') {
    const result = await ensureEmployeeRecord(req.profile);
    if (result.error) return sendDbError(res, result.error, 'Could not load your employee record.');
    employee = result.employee;
    if (!employee) return res.status(409).json({ error: 'Your account is not linked to an employee record.' });

    const { data: participantRows, error: participantError } = await supabase.from('meeting_participants')
      .select('meeting_id').eq('employee_id', employee.id);
    if (participantError) return sendDbError(res, participantError, 'Could not load meetings.');
    if (!participantRows.length) return res.json({ meetings: [] });
    const { data, error } = await supabase.from('meetings').select(meetingSelect)
      .in('id', participantRows.map(row => row.meeting_id)).order('meeting_date').order('start_time').limit(200);
    if (error) return sendDbError(res, error, 'Could not load meetings.');
    return res.json({ meetings: data.map(mapMeeting) });
  }

  const { data, error } = await supabase.from('meetings').select(meetingSelect)
    .order('meeting_date').order('start_time').limit(200);
  if (error) return sendDbError(res, error, 'Could not load meetings.');
  res.json({ meetings: data.map(mapMeeting) });
});

router.post('/', requireAdmin, async (req, res) => {
  const { title, agenda, description, meetingDate, startsAt, endsAt, joinUrl, location, employeeIds } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || !validDateAndTime(meetingDate, startsAt)
    || !validDateAndTime(meetingDate, endsAt) || endsAt <= startsAt) {
    return res.status(400).json({ error: 'Provide a title, date, and valid start/end times.' });
  }
  if (joinUrl && !isHttpUrl(joinUrl)) return res.status(400).json({ error: 'Meeting link must use http or https.' });

  let recipients = employeeIds;
  let employeeQuery = supabase.from('employees').select('id').eq('status', 'Active');
  if (Array.isArray(recipients) && recipients.length) employeeQuery = employeeQuery.in('id', [...new Set(recipients)]);
  const { data: activeEmployees, error: employeeError } = await employeeQuery;
  if (employeeError) return sendDbError(res, employeeError, 'Could not load meeting participants.');
  if (Array.isArray(recipients) && recipients.length && activeEmployees.length !== new Set(recipients).size) {
    return res.status(400).json({ error: 'Meeting participants must be active employees.' });
  }
  recipients = activeEmployees.map(employee => employee.id);

  const { data: meeting, error } = await supabase.from('meetings').insert({
    created_by: req.profile.id,
    title: title.trim(),
    agenda: agenda?.trim() || null,
    description: description?.trim() || null,
    meeting_date: meetingDate,
    start_time: startsAt,
    end_time: endsAt,
    meeting_link: joinUrl || null,
    location: location?.trim() || null,
    status: 'Upcoming',
  }).select('*').single();
  if (error) return sendDbError(res, error, 'Could not schedule meeting.');
  if (recipients.length) {
    const { error: participantError } = await supabase.from('meeting_participants').insert(
      recipients.map(employee_id => ({ meeting_id: meeting.id, employee_id, join_status: 'Yet to Join' })),
    );
    if (participantError) return sendDbError(res, participantError, 'Meeting saved but participant assignment failed.');
  }
  res.status(201).json({ meeting: mapMeeting({ ...meeting, meeting_participants: [] }) });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const updates = {};
  for (const key of ['title', 'agenda', 'description', 'location']) {
    if (key in body) updates[key] = typeof body[key] === 'string' ? body[key].trim() || null : body[key];
  }
  if ('joinUrl' in body) updates.meeting_link = body.joinUrl || null;
  if ('meetingDate' in body) updates.meeting_date = body.meetingDate;
  if ('startsAt' in body) updates.start_time = body.startsAt;
  if ('endsAt' in body) updates.end_time = body.endsAt;
  if ('cancelled' in body) updates.status = body.cancelled ? 'Cancelled' : 'Upcoming';

  const meetingDate = updates.meeting_date;
  const startTime = updates.start_time;
  const endTime = updates.end_time;
  if ((meetingDate && !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate))
    || (startTime && !validDateAndTime(meetingDate || '2000-01-01', startTime))
    || (endTime && !validDateAndTime(meetingDate || '2000-01-01', endTime))) {
    return res.status(400).json({ error: 'Provide a valid meeting date and time.' });
  }
  if (startTime && endTime && endTime <= startTime) {
    return res.status(400).json({ error: 'Meeting end time must be after its start time.' });
  }
  if ('joinUrl' in body && body.joinUrl && !isHttpUrl(body.joinUrl)) {
    return res.status(400).json({ error: 'Meeting link must use http or https.' });
  }
  const { data, error } = await supabase.from('meetings').update(updates)
    .eq('id', req.params.id).select('*').single();
  if (error) return sendDbError(res, error, 'Could not update meeting.');
  res.json({ meeting: mapMeeting({ ...data, meeting_participants: [] }) });
});

router.post('/:id/join', async (req, res) => {
  if (req.profile.role !== 'employee') {
    return res.status(403).json({ error: 'Only meeting participants can join from the employee portal.' });
  }
  const result = await ensureEmployeeRecord(req.profile);
  if (result.error) return sendDbError(res, result.error, 'Could not load your employee record.');
  if (!result.employee) return res.status(409).json({ error: 'Your account is not linked to an employee record.' });
  const { data: participant, error: participantError } = await supabase.from('meeting_participants')
    .select('meeting_id,employee_id,joined_at,join_status').eq('meeting_id', req.params.id)
    .eq('employee_id', result.employee.id).maybeSingle();
  if (participantError) return sendDbError(res, participantError, 'Could not verify meeting participation.');
  if (!participant) return res.status(404).json({ error: 'Meeting not found for this employee.' });

  const { data: meeting, error: meetingError } = await supabase.from('meetings')
    .select('id,status').eq('id', req.params.id).maybeSingle();
  if (meetingError) return sendDbError(res, meetingError, 'Could not load the meeting.');
  if (!meeting || meeting.status === 'Cancelled') return res.status(409).json({ error: 'This meeting is no longer available.' });
  if (participant.joined_at) return res.json({ participant });

  const { data, error } = await supabase.from('meeting_participants')
    .update({ joined_at: new Date().toISOString(), join_status: 'Joined' })
    .eq('meeting_id', req.params.id).eq('employee_id', result.employee.id).is('joined_at', null)
    .select('meeting_id,employee_id,joined_at,join_status').single();
  if (error) return sendDbError(res, error, 'Could not record meeting participation.');
  res.json({ participant: data });
});

router.post('/:id/participants/:employeeId/verified-join', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('meeting_participants')
    .update({ joined_at: new Date().toISOString(), join_status: 'Joined' })
    .eq('meeting_id', req.params.id).eq('employee_id', req.params.employeeId)
    .select('meeting_id,employee_id,joined_at,join_status').single();
  if (error) return sendDbError(res, error, 'Could not record verified meeting attendance.');
  res.json({ participant: data });
});

export default router;
