import { supabase, supabaseConfigError } from './supabase.js';

const baseUrl = import.meta.env.VITE_API_URL || '/api';

export async function api(path, options = {}) {
  if (!supabase) throw new Error(supabaseConfigError);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach the Arshith Connect API at ${baseUrl}. Start the backend and check VITE_API_URL.`);
    }
    throw error;
  }
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

export function formatTime(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

export function formatDuration(seconds) {
  if (seconds == null) return 'In progress';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function todayLocal(timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
