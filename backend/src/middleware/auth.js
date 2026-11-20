import { authClient, supabase } from '../config/supabase.js';

export async function authenticate(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Your session is invalid or expired.' });

  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Unable to load your employee profile.' });
  if (!profile) return res.status(403).json({ error: 'No Arshith Connect profile is associated with this account.' });
  if (profile.is_active === false) return res.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
  const isProfileRequest = req.originalUrl.split('?')[0] === '/api/profile';
  const isPasswordSetup = req.originalUrl.split('?')[0] === '/api/profile/password-setup'
    && req.method === 'POST';
  if (profile.must_change_password && !isProfileRequest && !isPasswordSetup) {
    return res.status(403).json({ error: 'Set a new password before accessing your employee workspace.' });
  }
  req.user = user;
  req.profile = profile;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.profile?.role !== 'admin') return res.status(403).json({ error: 'Admin access is required.' });
  next();
}
