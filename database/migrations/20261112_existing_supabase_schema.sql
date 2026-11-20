alter table public.profiles
  add column if not exists department text,
  add column if not exists job_title text,
  add column if not exists work_start time not null default '09:00',
  add column if not exists work_end time not null default '18:00',
  add column if not exists time_zone text not null default 'Asia/Kolkata',
  add column if not exists workdays smallint[] not null default array[1,2,3,4,5]::smallint[];

create unique index if not exists employees_auth_user_id_unique
  on public.employees(auth_user_id)
  where auth_user_id is not null;

create table if not exists public.work_assignment_updates (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.work_assignments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  status text not null check (status in ('pending', 'in_progress', 'completed')),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists work_assignment_updates_assignment_time_idx
  on public.work_assignment_updates(assignment_id, created_at desc);

alter table public.work_assignment_updates enable row level security;
grant all on public.work_assignment_updates to service_role;
