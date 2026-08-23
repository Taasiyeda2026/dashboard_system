alter table public.staff_messages
  add column if not exists recipient_user_ids uuid[] not null default '{}'::uuid[];

alter table public.staff_messages
  drop constraint if exists staff_messages_audience;

alter table public.staff_messages
  add constraint staff_messages_audience
  check (audience in ('all_non_instructors', 'selected_users'));

alter table public.staff_messages
  drop constraint if exists staff_messages_recipient_selection;

alter table public.staff_messages
  add constraint staff_messages_recipient_selection
  check (
    (audience = 'all_non_instructors' and cardinality(recipient_user_ids) = 0)
    or
    (audience = 'selected_users' and cardinality(recipient_user_ids) > 0)
  );

drop policy if exists "staff messages read" on public.staff_messages;
create policy "staff messages read"
  on public.staff_messages
  for select
  to authenticated
  using (
    (select public.app_current_role()) = 'admin'
    or (
      is_active = true
      and coalesce((select public.app_current_role()), '') not in ('', 'instructor')
      and (
        audience = 'all_non_instructors'
        or (
          audience = 'selected_users'
          and (select auth.uid()) = any(recipient_user_ids)
        )
      )
    )
  );

comment on column public.staff_messages.recipient_user_ids is
  'Auth user IDs used only when audience=selected_users.';
