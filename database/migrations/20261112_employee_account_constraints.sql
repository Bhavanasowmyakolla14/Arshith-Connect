alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create unique index if not exists employees_email_ci_unique
  on public.employees (lower(email))
  where email is not null;

create unique index if not exists employees_employee_code_ci_unique
  on public.employees (upper(employee_code))
  where employee_code is not null and btrim(employee_code) <> '';
