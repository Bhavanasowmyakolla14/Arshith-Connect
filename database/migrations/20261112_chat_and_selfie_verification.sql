alter table public.profiles
  add column if not exists avatar_path text;

alter table public.attendance
  add column if not exists selfie_path text;

revoke all privileges on table public.attendance from anon;

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  direct_user_low uuid references public.profiles(id) on delete cascade,
  direct_user_high uuid references public.profiles(id) on delete cascade,
  name text,
  description text,
  image_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (kind = 'direct' and direct_user_low is not null and direct_user_high is not null
      and direct_user_low < direct_user_high and name is null)
    or (kind = 'group' and direct_user_low is null and direct_user_high is null
      and nullif(btrim(name), '') is not null)
  )
);

create unique index if not exists chat_conversations_direct_pair_unique
  on public.chat_conversations(direct_user_low, direct_user_high);

create index if not exists chat_conversations_latest_idx
  on public.chat_conversations(last_message_at desc)
  where deleted_at is null;

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null references public.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_members_user_idx
  on public.chat_members(user_id, joined_at desc);
alter table public.chat_members replica identity full;
alter table public.chat_conversations replica identity full;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null default '',
  created_at timestamptz not null default now(),
  check (char_length(content) <= 5000)
);

create index if not exists chat_messages_conversation_time_idx
  on public.chat_messages(conversation_id, created_at desc);

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default now()
);

create index if not exists chat_message_attachments_message_idx
  on public.chat_message_attachments(message_id);

create table if not exists public.chat_message_reads (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists chat_message_reads_user_idx
  on public.chat_message_reads(user_id, read_at desc);

create or replace function public.chat_is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active is distinct from false
  )
$$;

create or replace function public.chat_is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'employee') and is_active is distinct from false
  )
$$;

create or replace function public.chat_is_member(p_conversation_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_members member
    join public.chat_conversations conversation on conversation.id = member.conversation_id
    where member.conversation_id = p_conversation_id
      and member.user_id = auth.uid()
      and conversation.deleted_at is null
      and exists (
        select 1 from public.profiles profile
        where profile.id = auth.uid()
          and profile.is_active is distinct from false
          and profile.role in ('admin', 'employee')
      )
  )
$$;

create or replace function public.chat_can_read_avatar(p_user_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.chat_is_admin()
    or (p_user_id = auth.uid()::text and public.chat_is_active_user())
    or (
      public.chat_is_active_user()
      and exists (
        select 1 from public.profiles profile
        where profile.id::text = p_user_id
          and profile.is_active is distinct from false
      )
      and exists (
        select 1
        from public.chat_members avatar_member
        join public.chat_conversations conversation
          on conversation.id = avatar_member.conversation_id
        where avatar_member.user_id::text = p_user_id
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      )
    )
$$;

create or replace function public.chat_unread_counts(p_user_id uuid)
returns table (conversation_id uuid, unread_count bigint)
language sql stable security definer
set search_path = ''
as $$
  select message.conversation_id, count(*)::bigint
  from public.chat_messages message
  join public.chat_members member on member.conversation_id = message.conversation_id
    and member.user_id = p_user_id
  join public.chat_conversations conversation on conversation.id = message.conversation_id
    and conversation.deleted_at is null
  left join public.chat_message_reads read_status on read_status.message_id = message.id
    and read_status.user_id = p_user_id
  where message.sender_id <> p_user_id
    and read_status.message_id is null
    and (auth.uid() = p_user_id or public.chat_is_admin() or auth.role() = 'service_role')
  group by message.conversation_id
$$;

revoke all on function public.chat_is_admin() from public;
revoke all on function public.chat_is_active_user() from public;
revoke all on function public.chat_is_member(uuid) from public;
revoke all on function public.chat_can_read_avatar(text) from public;
revoke all on function public.chat_unread_counts(uuid) from public;
grant execute on function public.chat_is_admin() to authenticated, service_role;
grant execute on function public.chat_is_active_user() to authenticated, service_role;
grant execute on function public.chat_is_member(uuid) to authenticated, service_role;
grant execute on function public.chat_can_read_avatar(text) to authenticated, service_role;
grant execute on function public.chat_unread_counts(uuid) to authenticated, service_role;

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_attachments enable row level security;
alter table public.chat_message_reads enable row level security;

revoke all privileges on table public.chat_conversations, public.chat_members,
  public.chat_messages, public.chat_message_attachments, public.chat_message_reads
  from public, anon, authenticated;
grant select on public.chat_conversations, public.chat_members,
  public.chat_messages, public.chat_message_attachments, public.chat_message_reads
  to authenticated;
grant all on public.chat_conversations, public.chat_members,
  public.chat_messages, public.chat_message_attachments, public.chat_message_reads
  to service_role;

drop policy if exists chat_conversations_read on public.chat_conversations;
create policy chat_conversations_read on public.chat_conversations
  for select to authenticated
  using (deleted_at is null and (public.chat_is_admin() or public.chat_is_member(id)));

drop policy if exists chat_conversations_admin_insert on public.chat_conversations;
create policy chat_conversations_admin_insert on public.chat_conversations
  for insert to authenticated
  with check (public.chat_is_admin() and created_by = auth.uid());

drop policy if exists chat_conversations_admin_update on public.chat_conversations;
create policy chat_conversations_admin_update on public.chat_conversations
  for update to authenticated
  using (public.chat_is_admin())
  with check (public.chat_is_admin());

drop policy if exists chat_conversations_admin_delete on public.chat_conversations;
create policy chat_conversations_admin_delete on public.chat_conversations
  for delete to authenticated
  using (public.chat_is_admin());

drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members
  for select to authenticated
  using (public.chat_is_admin()
    or (user_id = auth.uid() and public.chat_is_active_user())
    or public.chat_is_member(conversation_id));

drop policy if exists chat_members_admin_insert on public.chat_members;
create policy chat_members_admin_insert on public.chat_members
  for insert to authenticated
  with check (public.chat_is_admin());

drop policy if exists chat_members_admin_update on public.chat_members;
create policy chat_members_admin_update on public.chat_members
  for update to authenticated
  using (public.chat_is_admin())
  with check (public.chat_is_admin());

drop policy if exists chat_members_admin_delete on public.chat_members;
create policy chat_members_admin_delete on public.chat_members
  for delete to authenticated
  using (public.chat_is_admin());

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated
  using (public.chat_is_admin() or public.chat_is_member(conversation_id));

drop policy if exists chat_messages_insert_member on public.chat_messages;
create policy chat_messages_insert_member on public.chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_is_member(conversation_id));

drop policy if exists chat_messages_update_sender on public.chat_messages;
create policy chat_messages_update_sender on public.chat_messages
  for update to authenticated
  using (sender_id = auth.uid() and public.chat_is_member(conversation_id))
  with check (sender_id = auth.uid() and public.chat_is_member(conversation_id));

drop policy if exists chat_attachments_read on public.chat_message_attachments;
create policy chat_attachments_read on public.chat_message_attachments
  for select to authenticated
  using (exists (
    select 1 from public.chat_messages message
    where message.id = message_id
      and (public.chat_is_admin() or public.chat_is_member(message.conversation_id))
  ));

drop policy if exists chat_attachments_insert_member on public.chat_message_attachments;
create policy chat_attachments_insert_member on public.chat_message_attachments
  for insert to authenticated
  with check (exists (
    select 1 from public.chat_messages message
    where message.id = message_id and message.sender_id = auth.uid()
      and public.chat_is_member(message.conversation_id)
  ));

drop policy if exists chat_reads_select on public.chat_message_reads;
create policy chat_reads_select on public.chat_message_reads
  for select to authenticated
  using (public.chat_is_admin() or (user_id = auth.uid() and public.chat_is_active_user()) or exists (
    select 1 from public.chat_messages message
    where message.id = message_id and public.chat_is_member(message.conversation_id)
  ));

drop policy if exists chat_reads_insert_self on public.chat_message_reads;
create policy chat_reads_insert_self on public.chat_message_reads
  for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.chat_messages message
    where message.id = message_id and message.sender_id <> auth.uid()
      and public.chat_is_member(message.conversation_id)
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('chat-media', 'chat-media', false, 10485760, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),
  ('attendance-selfies', 'attendance-selfies', false, 10485760, array[
    'image/jpeg', 'image/png', 'image/webp'
  ])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_read_authorized on storage.objects;
create policy chat_media_read_authorized on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and case split_part(name, '/', 1)
      when 'avatars' then public.chat_can_read_avatar(split_part(name, '/', 2))
      when 'groups' then public.chat_is_admin() or exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      )
      when 'messages' then (public.chat_is_admin() or exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      ))
      else false
    end
  );

drop policy if exists chat_media_insert_authorized on storage.objects;
create policy chat_media_insert_authorized on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and case split_part(name, '/', 1)
      when 'avatars' then public.chat_is_active_user()
        and split_part(name, '/', 2) = auth.uid()::text
      when 'groups' then public.chat_is_admin()
      when 'messages' then (public.chat_is_admin() or split_part(name, '/', 3) = auth.uid()::text)
        and exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      )
      else false
    end
  );

drop policy if exists chat_media_delete_authorized on storage.objects;
create policy chat_media_delete_authorized on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) = auth.uid()::text)
      or public.chat_is_admin()
      or (split_part(name, '/', 1) = 'groups' and public.chat_is_admin())
      or (split_part(name, '/', 1) = 'messages'
        and (public.chat_is_admin() or split_part(name, '/', 3) = auth.uid()::text)
        and exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and public.chat_is_member(conversation.id)
      ))
    )
  );

drop policy if exists attendance_selfies_read_authorized on storage.objects;
create policy attendance_selfies_read_authorized on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and (public.chat_is_admin() or (
      split_part(name, '/', 1) = auth.uid()::text and public.chat_is_active_user()
    ))
  );

drop policy if exists attendance_selfies_insert_self on storage.objects;
create policy attendance_selfies_insert_self on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attendance-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.chat_is_active_user()
  );

drop policy if exists attendance_selfies_delete_authorized on storage.objects;
create policy attendance_selfies_delete_authorized on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and (public.chat_is_admin() or (
      split_part(name, '/', 1) = auth.uid()::text and public.chat_is_active_user()
    ))
  );

drop policy if exists chat_media_read_guard on storage.objects;
create policy chat_media_read_guard on storage.objects
  as restrictive for select to public
  using (
    bucket_id <> 'chat-media'
    or case split_part(name, '/', 1)
      when 'avatars' then public.chat_can_read_avatar(split_part(name, '/', 2))
      when 'groups' then public.chat_is_admin() or exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      )
      when 'messages' then public.chat_is_admin() or exists (
        select 1 from public.chat_conversations conversation
        where conversation.id::text = split_part(name, '/', 2)
          and conversation.deleted_at is null
          and public.chat_is_member(conversation.id)
      )
      else false
    end
  );

drop policy if exists chat_media_insert_guard on storage.objects;
create policy chat_media_insert_guard on storage.objects
  as restrictive for insert to public
  with check (
    bucket_id <> 'chat-media'
    or case split_part(name, '/', 1)
      when 'avatars' then public.chat_is_active_user()
        and split_part(name, '/', 2) = auth.uid()::text
      when 'groups' then public.chat_is_admin()
      when 'messages' then (public.chat_is_admin() or split_part(name, '/', 3) = auth.uid()::text)
        and exists (
          select 1 from public.chat_conversations conversation
          where conversation.id::text = split_part(name, '/', 2)
            and conversation.deleted_at is null
            and public.chat_is_member(conversation.id)
        )
      else false
    end
  );

drop policy if exists chat_media_update_guard on storage.objects;
create policy chat_media_update_guard on storage.objects
  as restrictive for update to public
  using (bucket_id not in ('chat-media', 'attendance-selfies'))
  with check (bucket_id not in ('chat-media', 'attendance-selfies'));

drop policy if exists chat_media_delete_guard on storage.objects;
create policy chat_media_delete_guard on storage.objects
  as restrictive for delete to public
  using (
    bucket_id <> 'chat-media'
    or (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) = auth.uid()::text)
      or public.chat_is_admin()
      or (split_part(name, '/', 1) = 'messages'
        and (public.chat_is_admin() or split_part(name, '/', 3) = auth.uid()::text)
        and exists (
          select 1 from public.chat_conversations conversation
          where conversation.id::text = split_part(name, '/', 2)
            and public.chat_is_member(conversation.id)
        ))
    )
  );

drop policy if exists attendance_selfies_read_guard on storage.objects;
create policy attendance_selfies_read_guard on storage.objects
  as restrictive for select to public
  using (
    bucket_id <> 'attendance-selfies'
    or (public.chat_is_admin() or (
      split_part(name, '/', 1) = auth.uid()::text and public.chat_is_active_user()
    ))
  );

drop policy if exists attendance_selfies_insert_guard on storage.objects;
create policy attendance_selfies_insert_guard on storage.objects
  as restrictive for insert to public
  with check (
    bucket_id <> 'attendance-selfies'
    or (
      split_part(name, '/', 1) = auth.uid()::text
      and public.chat_is_active_user()
    )
  );

drop policy if exists attendance_selfies_update_guard on storage.objects;
create policy attendance_selfies_update_guard on storage.objects
  as restrictive for update to public
  using (bucket_id <> 'attendance-selfies')
  with check (bucket_id <> 'attendance-selfies');

drop policy if exists attendance_selfies_delete_guard on storage.objects;
create policy attendance_selfies_delete_guard on storage.objects
  as restrictive for delete to public
  using (
    bucket_id <> 'attendance-selfies'
    or (public.chat_is_admin() or (
      split_part(name, '/', 1) = auth.uid()::text and public.chat_is_active_user()
    ))
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_conversations') then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_members') then
    alter publication supabase_realtime add table public.chat_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_attachments') then
    alter publication supabase_realtime add table public.chat_message_attachments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_reads') then
    alter publication supabase_realtime add table public.chat_message_reads;
  end if;
end
$$;
