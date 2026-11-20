import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function getConfigError() {
  const missing = [];
  if (!url) missing.push('VITE_SUPABASE_URL');
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) {
    return `Supabase is not configured: add ${missing.join(' and ')} to frontend/.env, then restart Vite.`;
  }
  if (anonKey.startsWith('sb_secret_')) {
    return 'Invalid Supabase frontend key: use the anon/publishable key, never the service-role secret.';
  }
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return 'Invalid VITE_SUPABASE_URL: enter the Project URL from your Supabase project settings.';
  }
  if (/^(your[-_<]|<)/i.test(anonKey)) {
    return 'VITE_SUPABASE_ANON_KEY is still a placeholder. Enter the anon/publishable key from Supabase.';
  }
  return '';
}

export const supabaseConfigError = getConfigError();
export const supabase = supabaseConfigError ? null : createClient(url, anonKey);
