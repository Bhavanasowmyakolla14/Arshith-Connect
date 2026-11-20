import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { sendDbError } from '../utils/http.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ profile: req.profile });
});

router.patch('/', async (req, res) => {
  const updates = {};
  for (const field of ['full_name', 'department', 'job_title']) {
    if (field in (req.body ?? {})) {
      const value = req.body[field];
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: `${field} must be text.` });
      }
      if (field === 'full_name' && !value?.trim()) {
        return res.status(400).json({ error: 'Your name cannot be empty.' });
      }
      updates[field] = typeof value === 'string' ? value.trim() || null : null;
    }
  }
  if ('avatar_path' in (req.body ?? {})) {
    const path = req.body.avatar_path;
    if (path !== null && (typeof path !== 'string'
      || !new RegExp(`^avatars/${req.profile.id}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, 'i').test(path))) {
      return res.status(400).json({ error: 'Choose a valid profile picture.' });
    }
    if (path) {
      const directory = path.slice(0, path.lastIndexOf('/'));
      const fileName = path.slice(path.lastIndexOf('/') + 1);
      const { data: files, error } = await supabase.storage.from('chat-media')
        .list(directory, { search: fileName, limit: 10 });
      if (error) return sendDbError(res, error, 'Could not verify the profile picture.');
      const avatar = files?.find(file => file.name === fileName);
      if (!avatar || !['image/jpeg', 'image/png', 'image/webp'].includes(avatar.metadata?.mimetype)
        || Number(avatar.metadata?.size) <= 0 || Number(avatar.metadata?.size) > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'The profile picture could not be verified. Upload it again and retry.' });
      }
    }
    updates.avatar_path = path;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Provide at least one profile field to update.' });
  }
  const { data, error } = await supabase.from('profiles').update(updates)
    .eq('id', req.profile.id).select('*').single();
  if (error) return sendDbError(res, error, 'Could not update your profile.');
  res.json({ profile: data });
});

router.post('/password-setup', async (req, res) => {
  if (req.profile.role !== 'employee') {
    return res.status(403).json({ error: 'This password setup flow is only for employee accounts.' });
  }
  const { data, error } = await supabase.from('profiles').update({ must_change_password: false })
    .eq('id', req.profile.id).select('*').single();
  if (error) return sendDbError(res, error, 'Password was changed, but account setup could not be completed.');
  res.json({ profile: data });
});

export default router;
