-- Immutable final PDF archive for completed annual reviews.

create table if not exists public.annual_review_final_documents (
  review_id uuid primary key references public.annual_reviews(id) on delete restrict,
  file_path text not null unique,
  original_file_name text not null,
  mime_type text not null default 'application/pdf',
  file_size bigint not null,
  sha256 text not null,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  constraint annual_review_final_documents_path_check
    check (file_path = review_id::text || '/final.pdf'),
  constraint annual_review_final_documents_mime_check
    check (mime_type = 'application/pdf'),
  constraint annual_review_final_documents_size_check
    check (file_size > 0 and file_size <= 20971520),
  constraint annual_review_final_documents_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$')
);

alter table public.annual_review_final_documents enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'annual-review-final-pdfs',
  'annual-review-final-pdfs',
  false,
  20971520,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.prevent_annual_review_final_document_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'annual_review_final_document_immutable';
end
$$;

drop trigger if exists annual_review_final_documents_immutable on public.annual_review_final_documents;
create trigger annual_review_final_documents_immutable
before update or delete on public.annual_review_final_documents
for each row execute function public.prevent_annual_review_final_document_mutation();

drop policy if exists annual_review_final_documents_select_participants on public.annual_review_final_documents;
create policy annual_review_final_documents_select_participants
on public.annual_review_final_documents
for select to authenticated
using (
  exists (
    select 1
    from public.annual_reviews r
    where r.id = review_id
      and auth.uid() in (r.employee_id, r.manager_id)
  )
);

-- The manager uploads one deterministic object after the employee has signed and the review is locked.
drop policy if exists annual_review_final_pdfs_storage_insert_manager on storage.objects;
create policy annual_review_final_pdfs_storage_insert_manager
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'annual-review-final-pdfs'
  and exists (
    select 1
    from public.annual_reviews r
    where name = r.id::text || '/final.pdf'
      and r.manager_id = auth.uid()
      and r.status = 'completed_locked'
      and r.employee_signed_at is not null
      and r.locked_at is not null
      and not exists (
        select 1
        from public.annual_review_final_documents d
        where d.review_id = r.id
      )
  )
);

drop policy if exists annual_review_final_pdfs_storage_select_participants on storage.objects;
create policy annual_review_final_pdfs_storage_select_participants
on storage.objects
for select to authenticated
using (
  bucket_id = 'annual-review-final-pdfs'
  and (
    exists (
      select 1
      from public.annual_review_final_documents d
      join public.annual_reviews r on r.id = d.review_id
      where d.file_path = name
        and auth.uid() in (r.employee_id, r.manager_id)
    )
    or exists (
      select 1
      from public.annual_reviews r
      where name = r.id::text || '/final.pdf'
        and r.manager_id = auth.uid()
        and r.status = 'completed_locked'
        and r.employee_signed_at is not null
        and r.locked_at is not null
        and not exists (
          select 1
          from public.annual_review_final_documents d
          where d.review_id = r.id
        )
    )
  )
);

-- Intentionally no UPDATE or DELETE policy for this bucket.

create or replace function public.register_annual_review_final_document(
  p_review_id uuid,
  p_original_file_name text,
  p_file_size bigint,
  p_sha256 text
)
returns public.annual_review_final_documents
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  result public.annual_review_final_documents;
  expected_path text;
  stored_size bigint;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'annual_review_final_pdf_manager_forbidden';
  end if;
  if r.status <> 'completed_locked'
     or r.employee_signed_at is null
     or r.locked_at is null then
    raise exception 'annual_review_final_pdf_review_not_completed';
  end if;
  if exists (
    select 1 from public.annual_review_final_documents d where d.review_id = p_review_id
  ) then
    raise exception 'annual_review_final_pdf_already_registered';
  end if;
  if nullif(btrim(p_original_file_name), '') is null then
    raise exception 'annual_review_final_pdf_name_required';
  end if;
  if p_file_size is null or p_file_size <= 0 or p_file_size > 20971520 then
    raise exception 'annual_review_final_pdf_invalid_size';
  end if;
  if lower(coalesce(p_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'annual_review_final_pdf_invalid_sha256';
  end if;

  expected_path := p_review_id::text || '/final.pdf';

  select case
    when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (o.metadata ->> 'size')::bigint
    else null
  end
  into stored_size
  from storage.objects o
  where o.bucket_id = 'annual-review-final-pdfs'
    and o.name = expected_path;

  if not found then
    raise exception 'annual_review_final_pdf_object_missing';
  end if;
  if stored_size is not null and stored_size <> p_file_size then
    raise exception 'annual_review_final_pdf_size_mismatch';
  end if;

  insert into public.annual_review_final_documents (
    review_id,
    file_path,
    original_file_name,
    mime_type,
    file_size,
    sha256,
    uploaded_by
  ) values (
    p_review_id,
    expected_path,
    btrim(p_original_file_name),
    'application/pdf',
    p_file_size,
    lower(p_sha256),
    auth.uid()
  )
  returning * into result;

  insert into public.review_audit_log(
    review_id,
    actor_id,
    action,
    from_status,
    to_status,
    details
  ) values (
    p_review_id,
    auth.uid(),
    'final_pdf_uploaded',
    'completed_locked',
    'completed_locked',
    jsonb_build_object(
      'file_path', expected_path,
      'original_file_name', btrim(p_original_file_name),
      'file_size', p_file_size,
      'sha256', lower(p_sha256)
    )
  );

  return result;
end
$$;

revoke all on table public.annual_review_final_documents from anon;
revoke insert, update, delete on table public.annual_review_final_documents from authenticated;
grant select on table public.annual_review_final_documents to authenticated;

revoke execute on function public.register_annual_review_final_document(uuid, text, bigint, text) from public, anon;
grant execute on function public.register_annual_review_final_document(uuid, text, bigint, text) to authenticated;

notify pgrst, 'reload schema';
