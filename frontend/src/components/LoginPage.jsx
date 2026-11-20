import { useState } from 'react';
import { ArrowRight, BriefcaseBusiness, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabaseConfigError } from '../lib/supabase.js';
import { AsyncButton, Notice } from './ui.jsx';

export default function LoginPage() {
  const { login, requestPasswordReset } = useAuth();
  const [role, setRole] = useState('admin');
  const [email, setEmail] = useState('admin@arshithconnect.com');
  const [password, setPassword] = useState('12345678');
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password, role);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSelectRole(newRole) {
    setRole(newRole);
    setError('');
    if (newRole === 'admin') {
      setEmail('admin@arshithconnect.com');
      setPassword('12345678');
    } else {
      setEmail('bhanu@arshithconnect.com');
      setPassword('12345678');
    }
  }

  async function sendResetLink() {
    setError('');
    setResetMessage('');
    if (!email.trim()) {
      setError('Enter your company email first.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setResetMessage('If this email has an account, a secure password reset link has been sent.');
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-form-side">
        <div className="login-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span className="brand-mark" style={{ width: 44, height: 44, fontSize: 16 }}>AC</span>
            <div>
              <strong style={{ fontSize: 18, color: '#0f172a', letterSpacing: '-0.3px', display: 'block' }}>
                ARSHITH CONNECT
              </strong>
              <small style={{ color: '#0284c7', fontWeight: 600, fontSize: 12 }}>
                One Platform. Every Connection.
              </small>
            </div>
          </div>

          <div className="eyebrow">ENTERPRISE PORTAL</div>
          <h2>Sign in to your account</h2>
          <p className="login-subtitle">Access your organization workspace and connectivity suite.</p>

          <Notice>{supabaseConfigError}</Notice>

          <div className="role-tabs" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={role === 'admin' ? 'selected' : ''}
              onClick={() => handleSelectRole('admin')}
            >
              <ShieldCheck size={16} /> Administrator
            </button>
            <button
              type="button"
              className={role === 'employee' ? 'selected' : ''}
              onClick={() => handleSelectRole('employee')}
            >
              <BriefcaseBusiness size={16} /> Employee
            </button>
          </div>

          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Work Email</span>
              <input
                type="email"
                autoComplete="username"
                placeholder="you@arshithconnect.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </label>

            <Notice>{error}</Notice>
            <Notice tone="success">{resetMessage}</Notice>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="forgot-button"
                disabled={busy || Boolean(supabaseConfigError)}
                onClick={sendResetLink}
              >
                Forgot password?
              </button>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Default: <code>12345678</code>
              </span>
            </div>

            <AsyncButton
              className="button button-primary login-submit"
              type="submit"
              busy={busy}
              disabled={Boolean(supabaseConfigError)}
            >
              Sign in <ArrowRight size={17} />
            </AsyncButton>
          </form>

          <div className="login-help">
            Need an account? Ask your platform administrator to invite your employee profile.
          </div>
        </div>

        <div className="login-footer-note">
          <span className="tiny-lock" />
          Protected with Supabase Authentication &amp; Role-based Security
        </div>
      </section>
    </main>
  );
}
