create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'employee');
create type public.attendance_mode as enum ('office', 'work_from_home');
create type public.attendance_state as enum ('present', 'absent', 'on_leave');
create type public.task_priority as enum ('low', 'medium', 'high');
create type public.task_state as enum ('pending', 'in_progress', 'completed');
create type public.leave_state as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null default 'employee',
  department text,
  job_title text,
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  time_zone text not null default 'Asia/Kolkata',
  workdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.login_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'incomplete')),
  duration_seconds integer,
  created_at timestamptz not null default now()
);
create index login_sessions_employee_login_idx on public.login_sessions(employee_id, login_at desc);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default current_date,
  check_in timestamptz not null default now(),
  check_out timestamptz,
  work_mode public.attendance_mode not null,
  status public.attendance_state not null default 'present',
  duration_seconds integer,
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);
create index attendance_date_idx on public.attendance(work_date desc);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id),
  title text not null,
  description text not null,
  category text not null default 'General',
  important boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  primary key (announcement_id, employee_id)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  title text not null,
  agenda text,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  join_url text,
  location text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz,
  verified_joined_at timestamptz,
  primary key (meeting_id, employee_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  instructions text,
  priority public.task_priority not null default 'medium',
  starts_on date,
  due_on date,
  status public.task_state not null default 'pending',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.assignment_updates (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  status public.task_state not null,
  comment text not null,
  created_at timestamptz not null default now()
);

create table public.hourly_updates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  update_slot integer check (update_slot >= 0),
  completed_work text not null,
  current_task text not null,
  progress text not null,
  pending_work text not null,
  blockers text,
  attachment_url text,
  submitted_at timestamptz not null default now()
);
create unique index hourly_updates_attendance_slot_unique
  on public.hourly_updates(attendance_id, update_slot) where update_slot is not null;
create index hourly_updates_employee_time_idx on public.hourly_updates(employee_id, submitted_at desc);
create table public.hourly_update_feedback (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.hourly_updates(id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create table public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check (leave_type in ('Casual Leave', 'Sick Leave', 'Earned Leave', 'Other')),
  starts_on date not null,
  ends_on date not null,
  reason text not null,
  status public.leave_state not null default 'pending',
  reviewer_id uuid references public.profiles(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create or replace function public.close_login_session(p_session_id uuid)
returns public.login_sessions language plpgsql security definer set search_path = public
as $$
declare saved public.login_sessions;
begin
  update public.login_sessions
  set logout_at = now(),
      duration_seconds = greatest(0, floor(extract(epoch from (now() - login_at)))::integer),
      status = 'completed'
  where id = p_session_id and logout_at is null
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.close_attendance(p_attendance_id uuid)
returns public.attendance language plpgsql security definer set search_path = public
as $$
declare saved public.attendance;
begin
  update public.attendance
  set check_out = now(),
      duration_seconds = greatest(0, floor(extract(epoch from (now() - check_in)))::integer)
  where id = p_attendance_id and check_out is null
  returning * into saved;
  return saved;
end;
$$;
revoke execute on function public.close_login_session(uuid) from public, anon, authenticated;
revoke execute on function public.close_attendance(uuid) from public, anon, authenticated;
grant execute on function public.close_login_session(uuid) to service_role;
grant execute on function public.close_attendance(uuid) to service_role;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

alter table public.profiles enable row level security;
alter table public.login_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_updates enable row level security;
alter table public.hourly_updates enable row level security;
alter table public.hourly_update_feedback enable row level security;
alter table public.leave_applications enable row level security;

create policy "Profiles are visible to self and admins" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());
create policy "Sessions are visible to owner and admins" on public.login_sessions for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Attendance is visible to owner and admins" on public.attendance for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Recipients can view announcements" on public.announcements for select to authenticated
using (public.is_admin() or exists (
  select 1 from public.announcement_recipients r
  where r.announcement_id = id and r.employee_id = auth.uid()
));
create policy "Recipients can view own announcement receipts" on public.announcement_recipients for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Meeting participants can view meetings" on public.meetings for select to authenticated
using (public.is_admin() or exists (
  select 1 from public.meeting_participants p
  where p.meeting_id = id and p.employee_id = auth.uid()
));
create policy "Meeting participants can view participation" on public.meeting_participants for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Assignments visible to assignee and admins" on public.assignments for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Assignment updates visible to owner and admins" on public.assignment_updates for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Hourly updates visible to owner and admins" on public.hourly_updates for select to authenticated
using (employee_id = auth.uid() or public.is_admin());
create policy "Feedback visible to employee and admins" on public.hourly_update_feedback for select to authenticated
using (public.is_admin() or exists (
  select 1 from public.hourly_updates u
  where u.id = update_id and u.employee_id = auth.uid()
));
create policy "Leave visible to applicant and admins" on public.leave_applications for select to authenticated
using (employee_id = auth.uid() or public.is_admin());

grant usage on schema public to authenticated, service_role;
grant select on public.profiles, public.login_sessions, public.attendance, public.announcements,
  public.announcement_recipients, public.meetings, public.meeting_participants, public.assignments,
  public.assignment_updates, public.hourly_updates, public.hourly_update_feedback,
  public.leave_applications to authenticated;
grant all on public.profiles, public.login_sessions, public.attendance, public.announcements,
  public.announcement_recipients, public.meetings, public.meeting_participants, public.assignments,
  public.assignment_updates, public.hourly_updates, public.hourly_update_feedback,
  public.leave_applications to service_role;
