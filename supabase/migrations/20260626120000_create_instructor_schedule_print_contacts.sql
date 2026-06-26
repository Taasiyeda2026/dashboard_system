-- Print-only helper data for enriching instructor schedule printouts.
-- This table is not a source of truth for schools, contacts, activities, or operations.
create table if not exists public.instructor_schedule_print_contacts (
  id uuid primary key default gen_random_uuid(),

  season text not null default 'summer_2026',

  external_key text,
  authority text,
  school text not null,

  contact_name text,
  contact_phone text,
  school_address text,
  city_or_authority text,

  active boolean not null default true,

  source_note text not null default 'print_only_instructor_schedule_contacts',
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.instructor_schedule_print_contacts is
'Print-only helper table for instructor schedule output. Not a source of truth for contacts, schools, activities or operations.';

comment on column public.instructor_schedule_print_contacts.source_note is
'This table is used only to enrich printed instructor schedules.';

create unique index if not exists instructor_schedule_print_contacts_season_authority_school_uidx
  on public.instructor_schedule_print_contacts (season, authority, school);

create index if not exists instructor_schedule_print_contacts_active_lookup_idx
  on public.instructor_schedule_print_contacts (active, season, authority, school);

alter table public.instructor_schedule_print_contacts enable row level security;

drop policy if exists instructor_schedule_print_contacts_select_authenticated on public.instructor_schedule_print_contacts;
create policy instructor_schedule_print_contacts_select_authenticated
on public.instructor_schedule_print_contacts
for select
using (auth.role() = 'authenticated');

grant select on public.instructor_schedule_print_contacts to authenticated;
