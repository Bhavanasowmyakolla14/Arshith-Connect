import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, Notice } from './ui.jsx';

export default function PasswordSetupPage({ onComplete }) {
  const { profile, completePasswordSetup } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      setBusy(false);
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await completePasswordSetup(password);
      window.history.replaceState({}, '', '/');
      onComplete();
    } catch (setupError) {
      setError(setupError.message);
    } finally { setBusy(false); }
  }

  return <main className="password-setup-screen">
    <div className="password-setup-card">
      <span className="brand-mark">AC</span>
      <div className="eyebrow">ARSHITH CONNECT ACCOUNT</div>
      <h1>Set your password</h1>
      <p>Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}. Create a password to secure your account.</p>
      <form className="stack-form" onSubmit={submit}>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>
        <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} required /></label>
        <Notice>{error}</Notice>
        <AsyncButton className="button button-primary" type="submit" busy={busy}><KeyRound size={15} />Save password</AsyncButton>
      </form>
      <div className="password-setup-foot"><CheckCircle2 size={15} />Your password is securely managed by Supabase Auth.</div>
    </div>
  </main>;
}
