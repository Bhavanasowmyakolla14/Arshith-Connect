import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const requiredVariables = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missingVariables = requiredVariables.filter(name => !process.env[name]?.trim());
if (missingVariables.length) {
  throw new Error(
    `Missing required backend environment variable(s): ${missingVariables.join(', ')}. `
    + 'Set them in backend/.env. Never expose SUPABASE_SERVICE_ROLE_KEY to the frontend.',
  );
}

const supabaseUrl = process.env.SUPABASE_URL.trim();
const anonKey = process.env.SUPABASE_ANON_KEY.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  throw new Error('Invalid SUPABASE_URL: use the HTTPS Project URL from your Supabase project settings.');
}

if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
  throw new Error('Invalid SUPABASE_URL: use an HTTPS Supabase Project URL.');
}
if (/^(your[-_<]|<)/i.test(anonKey) || /^(your[-_<]|<)/i.test(serviceRoleKey)) {
  throw new Error('Supabase backend keys are still placeholders. Set the real project keys in backend/.env.');
}
if (anonKey.startsWith('sb_secret_')) {
  throw new Error('SUPABASE_ANON_KEY must be the anon/publishable key, not a Supabase secret key.');
}
if (serviceRoleKey.startsWith('sb_publishable_')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must be a server-only secret/service-role key, not a publishable key.');
}
if (anonKey === serviceRoleKey) {
  throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be different keys.');
}

const authOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

// Server-only service-role client: backend routes need admin auth and privileged RPC access.
export const supabase = createClient(supabaseUrl, serviceRoleKey, authOptions);

// Used only to verify user access tokens; the service-role key never handles user JWT verification.
export const authClient = createClient(supabaseUrl, anonKey, authOptions);
