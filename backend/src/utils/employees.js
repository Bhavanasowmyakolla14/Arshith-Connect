import { supabase } from '../config/supabase.js';

const employeeFields = 'id,auth_user_id,employee_code,full_name,email,phone,department,designation,joining_date,work_mode,status,created_at,updated_at';

export async function findEmployeeRecord(profile) {
  const { data, error } = await supabase.from('employees')
    .select(employeeFields).eq('auth_user_id', profile.id).maybeSingle();
  if (error || data || !profile.email) return { employee: data, error };

  const { data: emailMatch, error: emailError } = await supabase.from('employees')
    .select(employeeFields).eq('email', profile.email).maybeSingle();
  if (emailError || !emailMatch) return { employee: emailMatch, error: emailError };
  if (emailMatch.auth_user_id) {
    return { employee: null, error: new Error('This employee email is already linked to a different account.') };
  }
  const { data: linked, error: linkError } = await supabase.from('employees')
    .update({ auth_user_id: profile.id, updated_at: new Date().toISOString() })
    .eq('id', emailMatch.id).is('auth_user_id', null).select(employeeFields).maybeSingle();
  if (linkError) return { employee: null, error: linkError };
  if (linked) return { employee: linked, error: null };
  const { data: concurrentLink, error: concurrentError } = await supabase.from('employees')
    .select(employeeFields).eq('auth_user_id', profile.id).maybeSingle();
  return concurrentError || !concurrentLink
    ? { employee: null, error: concurrentError || new Error('Could not link the employee record to this account.') }
    : { employee: concurrentLink, error: null };
}

export async function ensureEmployeeRecord(profile) {
  const existing = await findEmployeeRecord(profile);
  if (existing.error || existing.employee) return existing;

  const { data, error } = await supabase.from('employees').insert({
    auth_user_id: profile.id,
    full_name: profile.full_name,
    email: profile.email,
    department: profile.department || null,
    designation: profile.job_title || profile.designation || null,
    status: profile.is_active === false ? 'Inactive' : 'Active',
    updated_at: new Date().toISOString(),
  }).select(employeeFields).single();
  if (error?.code === '23505') return findEmployeeRecord(profile);
  return { employee: data, error };
}
