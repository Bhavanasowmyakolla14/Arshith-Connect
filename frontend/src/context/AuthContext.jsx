import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { supabase, supabaseConfigError } from '../lib/supabase.js';

const AuthContext = createContext(null);

async function loadProfile() {
  const { profile: currentProfile } = await api('/profile');
  if (!currentProfile) throw new Error('Your Arshith Connect profile could not be loaded.');
  return currentProfile;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trackingWarning, setTrackingWarning] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (!active) return;
      if (data.session?.user) {
        setUser(data.session.user);
        try {
          setProfile(await loadProfile());
        } catch (loadError) {
          console.error(loadError);
          setUser(null);
          setProfile(null);
          await supabase.auth.signOut();
        }
      }
      if (active) setLoading(false);
    }).catch(error => {
      console.error('Unable to restore the Supabase session.', error);
      if (active) setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        setUser(null);
        setProfile(null);
      } else {
        setUser(session.user);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email, password, expectedRole) => {
    if (!supabase) throw new Error(supabaseConfigError);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    try {
      const currentProfile = await loadProfile();
      if (currentProfile.role !== expectedRole) {
        throw new Error(`This account does not have ${expectedRole} access.`);
      }
      setUser(data.user);
      setProfile(currentProfile);
      setTrackingWarning('');
      if (currentProfile.must_change_password) return;
      try {
        const started = await api('/sessions/start', { method: 'POST', body: {} });
        localStorage.setItem(`ac-session-${data.user.id}`, started.session.id);
      } catch (sessionError) {
        setTrackingWarning(`You are signed in, but your login time could not be recorded. ${sessionError.message}`);
      }
    } catch (error) {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    if (!supabase) return;
    let trackingError;
    const sessionId = user && localStorage.getItem(`ac-session-${user.id}`);
    if (sessionId) {
      try {
        await api(`/sessions/${sessionId}/end`, { method: 'PATCH' });
        localStorage.removeItem(`ac-session-${user.id}`);
      } catch (error) {
        trackingError = error;
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    if (trackingError) throw new Error(`Signed out, but logout time could not be saved: ${trackingError.message}`);
    setUser(null);
    setProfile(null);
    setTrackingWarning('');
  }, [user]);

  const requestPasswordReset = useCallback(async email => {
    if (!supabase) throw new Error(supabaseConfigError);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` });
    if (error) throw new Error(error.message);
  }, []);

  const updateProfile = useCallback(async updates => {
    const result = await api('/profile', { method: 'PATCH', body: updates });
    setProfile(result.profile);
    return result.profile;
  }, []);

  const completePasswordSetup = useCallback(async password => {
    if (!supabase) throw new Error(supabaseConfigError);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    const setup = await api('/profile/password-setup', { method: 'POST', body: {} });
    setProfile(setup.profile);
    setTrackingWarning('');
    try {
      const result = await api('/sessions/start', { method: 'POST', body: {} });
      localStorage.setItem(`ac-session-${user.id}`, result.session.id);
    } catch (sessionError) {
      setTrackingWarning(`Your password was saved, but your login time could not be recorded. ${sessionError.message}`);
    }
  }, [user]);

  const value = useMemo(() => ({
    user, profile, loading, trackingWarning, login, logout, requestPasswordReset,
    completePasswordSetup, updateProfile,
  }), [user, profile, loading, trackingWarning, login, logout, requestPasswordReset, completePasswordSetup, updateProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
