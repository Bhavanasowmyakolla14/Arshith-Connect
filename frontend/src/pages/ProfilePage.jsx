import { useEffect, useState } from 'react';
import { Camera, KeyRound, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { AsyncButton, Field, Notice, PageHeader, Panel } from '../components/ui.jsx';

export default function ProfilePage() {
  const { profile, updateProfile } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState('');
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    department: profile.department || '',
    job_title: profile.job_title || '',
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    if (!profile.avatar_path) {
      setAvatarUrl('');
      return () => { active = false; };
    }
    supabase.storage.from('chat-media').createSignedUrl(profile.avatar_path, 600).then(({ data, error: signedError }) => {
      if (!active) return;
      if (signedError) setError(`Could not load your profile picture: ${signedError.message}`);
      else setAvatarUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [profile.avatar_path]);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true); setError(''); setSuccess('');
    try {
      await updateProfile(form);
      setSuccess('Your profile has been updated.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError(''); setSuccess('');
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      setPassword(''); setConfirmPassword('');
      setSuccess('Your password has been changed.');
    } catch (changeError) {
      setError(changeError.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setSuccess('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      setError('Choose a JPEG, PNG, or WebP image no larger than 10 MB.');
      return;
    }
    setBusy(true);
    let uploadedPath = '';
    try {
      const prepared = await api('/chat/avatar-upload', {
        method: 'POST',
        body: { file_name: file.name, mime_type: file.type, file_size: file.size },
      });
      uploadedPath = prepared.storage_path;
      const { error: uploadError } = await supabase.storage.from('chat-media')
        .uploadToSignedUrl(prepared.storage_path, prepared.token, file, { contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);
      await updateProfile({ avatar_path: prepared.storage_path });
      setSuccess('Your profile picture has been updated.');
    } catch (uploadError) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('chat-media').remove([uploadedPath]);
        if (cleanupError) setError(`${uploadError.message} The uploaded picture could not be removed: ${cleanupError.message}`);
        else setError(uploadError.message);
      } else setError(uploadError.message);
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <PageHeader eyebrow="YOUR ACCOUNT" title="My profile" description="Keep your personal details current and manage your sign-in password." />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    <div className="employee-page-grid">
      <Panel title="Profile details">
        <div className="profile-picture-control">
          <span className="profile-picture-preview">{avatarUrl
            ? <img src={avatarUrl} alt="Your profile" />
            : profile.full_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
          <label className="button button-outline profile-picture-button">
            <Camera size={14} />Update picture
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={uploadAvatar} />
          </label>
          <small>JPEG, PNG, or WebP · up to 10 MB</small>
        </div>
        <form className="stack-form" onSubmit={saveProfile}>
          <Field label="Full name" value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} required />
          <Field label="Company email" value={profile.email || ''} disabled />
          <div className="form-two">
            <Field label="Department" value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} />
            <Field label="Job title" value={form.job_title} onChange={event => setForm({ ...form, job_title: event.target.value })} />
          </div>
          <AsyncButton className="button button-primary" type="submit" busy={busy}><Save size={15} />Save profile</AsyncButton>
        </form>
      </Panel>
      <Panel title="Change password">
        <form className="stack-form" onSubmit={changePassword}>
          <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required />
          <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required />
          <span className="form-hint">Use at least 8 characters. Your password is managed securely by Supabase Auth.</span>
          <AsyncButton className="button button-outline" type="submit" busy={busy}><KeyRound size={15} />Update password</AsyncButton>
        </form>
      </Panel>
    </div>
  </div>;
}
