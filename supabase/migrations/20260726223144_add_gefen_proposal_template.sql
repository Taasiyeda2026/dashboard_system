-- GEFEN proposals: immutable quote numbering, dedicated course catalog,
-- validity calculation, and linked GEFEN approval documents.

alter table public.proposals_agreements
  add column if not exists quote_number text,
  add column if not exists valid_until date,
  add column if not exists combine_gefen_approval boolean;

update public.proposals_agreements
set combine_gefen_approval = false
where combine_gefen_approval is null;

alter table public.proposals_agreements
  alter column combine_gefen_approval set default true,
  alter column combine_gefen_approval set not null;

create sequence if not exists public.proposal_quote_number_seq
  as bigint
  start with 10055
  increment by 1
  minvalue 10055;

with ordered_proposals as (
  select
    pa.id,
    row_number() over (order by pa.created_at, pa.id) as sequence_offset
  from public.proposals_agreements pa
  where nullif(btrim(pa.quote_number), '') is null
)
update public.proposals_agreements pa
set quote_number = (10054 + ordered_proposals.sequence_offset)::text
from ordered_proposals
where pa.id = ordered_proposals.id;

select setval(
  'public.proposal_quote_number_seq',
  greatest(
    10054,
    coalesce((
      select max(pa.quote_number::bigint)
      from public.proposals_agreements pa
      where pa.quote_number ~ '^[0-9]+$'
    ), 10054)
  ),
  true
);

create unique index if not exists proposals_agreements_quote_number_uidx
  on public.proposals_agreements (quote_number);

alter table public.proposals_agreements
  alter column quote_number set not null;

create or replace function public.assign_proposal_quote_number()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(new.quote_number), '') is null then
      new.quote_number := nextval('public.proposal_quote_number_seq')::text;
    end if;
  elsif new.quote_number is distinct from old.quote_number then
    raise exception 'proposal_quote_number_immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists proposals_agreements_assign_quote_number
  on public.proposals_agreements;
create trigger proposals_agreements_assign_quote_number
before insert or update of quote_number on public.proposals_agreements
for each row execute function public.assign_proposal_quote_number();

grant usage, select on sequence public.proposal_quote_number_seq to authenticated;

comment on column public.proposals_agreements.quote_number is
  'Immutable sequential quote number. Existing proposals were backfilled oldest-to-newest from 10055 without regenerating their PDFs.';

create or replace function public.calculate_proposal_valid_until(p_proposal_date date)
returns date
language plpgsql
stable
set search_path = ''
as $function$
declare
  validity_days integer;
  first_block_start date;
  first_block_end date;
  candidate date;
begin
  if p_proposal_date is null then
    return null;
  end if;

  validity_days := case
    when extract(month from p_proposal_date) between 5 and 7 then 60
    when extract(month from p_proposal_date) between 8 and 11 then 30
    else 21
  end;

  with raw_periods as (
    select
      sc.start_date as period_start,
      coalesce(sc.end_date, sc.start_date) as period_end
    from public.school_calendar sc
    where sc.is_active = true
      and sc.blocks_scheduling = true
      and sc.start_date is not null
  ),
  ordered_periods as (
    select
      rp.*,
      max(rp.period_end) over (
        order by rp.period_start, rp.period_end
        rows between unbounded preceding and 1 preceding
      ) as previous_max_end
    from raw_periods rp
  ),
  marked_periods as (
    select
      op.*,
      case
        when op.previous_max_end is null
          or op.period_start > op.previous_max_end + 1
        then 1
        else 0
      end as starts_new_block
    from ordered_periods op
  ),
  grouped_periods as (
    select
      mp.*,
      sum(mp.starts_new_block) over (
        order by mp.period_start, mp.period_end
      ) as block_number
    from marked_periods mp
  ),
  closed_blocks as (
    select
      min(gp.period_start) as block_start,
      max(gp.period_end) as block_end
    from grouped_periods gp
    group by gp.block_number
  )
  select cb.block_start, cb.block_end
  into first_block_start, first_block_end
  from closed_blocks cb
  where cb.block_start > p_proposal_date
    and (cb.block_end - cb.block_start + 1) >= 5
  order by cb.block_start
  limit 1;

  if first_block_start is not null
    and first_block_start <= p_proposal_date + 10
  then
    candidate := p_proposal_date
      + validity_days
      + (first_block_end - first_block_start + 1);
  elsif first_block_start is not null
    and p_proposal_date + validity_days >= first_block_start
  then
    candidate := first_block_start - 1;
  else
    candidate := p_proposal_date + validity_days;
  end if;

  while extract(dow from candidate) in (5, 6)
    or exists (
      select 1
      from public.school_calendar sc
      where sc.is_active = true
        and sc.blocks_scheduling = true
        and sc.start_date is not null
        and candidate between sc.start_date and coalesce(sc.end_date, sc.start_date)
    )
  loop
    candidate := candidate - 1;
  end loop;

  return candidate;
end;
$function$;

create or replace function public.set_proposal_valid_until()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.valid_until :=
    public.calculate_proposal_valid_until(new.proposal_date);
  return new;
end;
$function$;

drop trigger if exists proposals_agreements_set_valid_until
  on public.proposals_agreements;
create trigger proposals_agreements_set_valid_until
before insert or update of proposal_date on public.proposals_agreements
for each row execute function public.set_proposal_valid_until();

update public.proposals_agreements
set valid_until = public.calculate_proposal_valid_until(proposal_date)
where valid_until is distinct from
  public.calculate_proposal_valid_until(proposal_date);

comment on column public.proposals_agreements.valid_until is
  'Calculated proposal validity: May-Jul 60 days, Aug-Nov 30 days, Dec-Apr 21 days, adjusted around school-calendar closures and to the previous workday.';

alter table public.proposals_agreements
  drop constraint if exists proposals_agreements_activity_type_group_check;

alter table public.proposals_agreements
  add constraint proposals_agreements_activity_type_group_check
  check (
    activity_type_group is null
    or btrim(activity_type_group) = ''
    or activity_type_group = any (array[
      'summer',
      'next_year',
      'combined',
      'tour',
      'gefen',
      'פעילויות קיץ',
      'קיץ תשפ״ו',
      'שנה הבאה',
      'שנת הלימודים תשפ״ז',
      'תוכניות תשפ״ז',
      'הצעה משולבת',
      'קיץ תשפ״ו + תשפ״ז',
      'קיץ תשפ״ו ושנת הלימודים תשפ״ז',
      'קורסים',
      'סדנאות',
      'סיור',
      'סיורים',
      'סיור בתעשייה',
      'תוכניות חינוכיות',
      'STEM ומייקרים',
      'התנסות בתעשייה',
      'התנסות בתעשייה – סיור לימודי חווייתי',
      'גפן',
      'גפ״ן'
    ])
  ) not valid;

insert into public.proposal_activity_groups
  (group_key, display_name, template_key, included_group_keys, sort_order, is_active)
values
  ('gefen', 'גפן', 'gefen', '{}', 3, true)
on conflict (group_key) do update set
  display_name = excluded.display_name,
  template_key = excluded.template_key,
  included_group_keys = excluded.included_group_keys,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.proposal_group_aliases
  (alias_name, group_key, is_active)
values
  ('גפן', 'gefen', true),
  ('גפ״ן', 'gefen', true),
  ('GEFEN', 'gefen', true)
on conflict (alias_name) do update set
  group_key = excluded.group_key,
  is_active = excluded.is_active;

create table if not exists public.proposal_gefen_courses (
  id uuid primary key default gen_random_uuid(),
  short_name text not null,
  full_name text not null,
  gefen_number text not null unique,
  meetings_count numeric(8, 2) not null,
  hourly_price numeric(12, 4) not null,
  hours_count numeric(8, 2) not null,
  total_price numeric(12, 2) not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_gefen_courses_names_not_blank
    check (
      btrim(short_name) <> ''
      and btrim(full_name) <> ''
      and btrim(gefen_number) <> ''
    ),
  constraint proposal_gefen_courses_positive_values
    check (
      meetings_count > 0
      and hourly_price > 0
      and hours_count > 0
      and total_price > 0
    )
);

alter table public.proposal_gefen_courses enable row level security;

revoke all on table public.proposal_gefen_courses from public, anon;
grant select on table public.proposal_gefen_courses to authenticated;

drop policy if exists "Authenticated users can view GEFEN courses"
  on public.proposal_gefen_courses;
create policy "Authenticated users can view GEFEN courses"
  on public.proposal_gefen_courses
  for select
  to authenticated
  using (public.app_can_use_proposals_agreements());

insert into public.proposal_gefen_courses
  (
    short_name,
    full_name,
    gefen_number,
    meetings_count,
    hourly_price,
    hours_count,
    total_price,
    sort_order,
    is_active
  )
values
  ('ביומימיקרי', 'ביומימיקרי – המצאות בהשראה מן הטבע', '6089', 11, 600, 16.5, 9900, 10, true),
  ('טכנולוגיות החלל', 'טכנולוגיות החלל - חדשנות טכנולוגית בהשראת החלל', '57651', 10, 633, 15, 9500, 20, true),
  ('בינה מלאכותית', 'סודות ויסודות הבינה המלאכותית - חשיבה ביקורתית', '9545', 8, 640, 12.5, 8000, 30, true),
  ('ביומימיקרי לחטיבה', 'ביומימיקרי – חדשנות סביבתית־טכנולוגית בהשראת הטבע', '53828', 10, 633.333333, 15, 9500, 40, true),
  ('יישומי AI בשיתוף GOOGLE', 'יישומי AI במציאות טכנולוגית חדשנית', '53819', 10, 633.333333, 15, 9500, 50, true),
  ('רוקחים עולם', 'רוקחים עולם - יזמות לתחום הפארמצבטיקה', '46091', 14, 571.428571, 21, 12000, 60, true),
  ('פורצות דרך', 'פורצות דרך וצועדות קדימה', '3604', 14, 571.428571, 21, 12000, 70, true),
  ('אופק פרימיום', 'אופק יזמות פרימיום בתעשייה', '52279', 14, 643, 21, 13500, 80, true),
  ('משחקי קופסה', 'פיתוח ופיצוח משחקי לוח', '27342', 12, 550, 18, 9900, 90, true),
  ('מנהיגות ירוקה', 'מנהיגות ירוקה', '67867', 10, 640, 15, 9600, 100, true),
  ('השמיים אינם הגבול', 'השמיים אינם הגבול - תוכנית חלל', '57646', 10, 640, 15, 9600, 110, true)
on conflict (gefen_number) do update set
  short_name = excluded.short_name,
  full_name = excluded.full_name,
  meetings_count = excluded.meetings_count,
  hourly_price = excluded.hourly_price,
  hours_count = excluded.hours_count,
  total_price = excluded.total_price,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.proposal_template_sections
  (
    template_key,
    template_name,
    activity_type_group,
    section_key,
    section_title,
    section_body,
    sort_order,
    is_active
  )
values
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'intro',
    'פתיח',
    'תעשיידע היא עמותה חינוכית-טכנולוגית מיסודה של התאחדות התעשיינים בישראל, הפועלת לקידום החינוך המדעי והטכנולוגי ולחיבור בין מערכת החינוך לעולמות התעשייה. פעילויות העמותה בתחומי STEM משלבות למידה מעשית, חקר, התנסות ופיתוח מיומנויות בתחומי המדע, הטכנולוגיה וההנדסה.',
    10,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'activity_intro',
    'התוכניות המוצעות',
    E'הצעה זו נועדה לבחירת תוכנית ולפתיחת הזמנה במערכת גפ״ן. ההתקשרות תיכנס לתוקף רק לאחר אישור הזמנת עבודה דיגיטלית במערכת גפ״ן והשלמת האישורים הנדרשים. הצעה זו אינה מהווה חוזה נפרד או הזמנת שירותים עצמאית מול תעשיידע.\n\nסילבוס התוכנית ופרטים נוספים מצורפים כנספח להצעה זו.\nתעשיידע היא מלכ״ר הפטור ממע״מ. המחירים המפורטים בהצעה הם סופיים.',
    20,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'validity',
    'תוקף ההצעה וזמינות הפעילות',
    E'הצעה זו בתוקף עד ליום {{valid_until}}.\nשריון צוותי ההדרכה, מועדי הפעילות והיקף התוכנית יבוצע לפי סדר השלמת הזמנות העבודה במערכת גפ״ן ובכפוף לזמינות. כל עוד לא אושרה הזמנת העבודה, לא ניתן להבטיח את השריון ולאחר תום תוקף ההצעה תהיה תעשיידע רשאית להקצות את הקיבולת לבתי ספר אחרים.',
    30,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'school_responsibility',
    'תיאום והפעלת הפעילות',
    E' בית הספר יפתח הזמנה במערכת גפ״ן בהתאם לפרטי הצעה זו.\n מועדי הפעילות יתואמו מראש בכפוף למערכת השעות, ללוח השנה הבית-ספרי ולזמינות צוותי ההדרכה.\n בית הספר יעמיד מרחב פעילות מתאים, תשתיות נדרשות, איש קשר זמין ואיש צוות חינוכי מלווה, ככל שנדרש בהתאם לאופי הפעילות.\n כל שינוי בהיקף הפעילות, במספר הקבוצות, במועדים או במחיר יתואם ויאושר מראש ובכתב מול תעשיידע.',
    40,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'taasiyeda_responsibility',
    'אחריות תעשיידע',
    E' תעשיידע תפעיל את התוכנית בהתאם לסילבוס המאושר ולפרטי ההזמנה במערכת גפ״ן.\n תעשיידע תעמיד צוותי הדרכה מקצועיים, חומרי הדרכה ופעילות, תקיים תיאום שוטף, תדווח על המפגשים במערכת הספקים ותעניק ליווי מקצועי לאורך הפעילות.',
    50,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'payment_terms',
    'תנאי תשלום',
    E' חשבונית תונפק בגין מפגשים שבוצעו בפועל ודווחו במערכת גפ״ן.\n התשלום יבוצע בהתאם לכללים החלים על הבעלות או הרשות ובכפוף להוראות חוק מוסר תשלומים לספקים, התשע״ז–2017.',
    60,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'cancellation_terms',
    'שינויים, ביטולים והפחתת היקף',
    E'בקשה לשינוי או לדחיית מועד תימסר מוקדם ככל האפשר ורצוי לפחות 3 ימי עבודה מראש.\nמפגש שבוטל ביוזמת בית הספר יתואם למועד חלופי במהלך תקופת הפעילות.\nביטול או שינוי שנמסרו פחות מ-48 שעות לפני המפגש יחייבו אישור בכתב של מנהל/ת בית הספר ויטופלו בתיאום בין הצדדים.\nהפסקת תוכנית או הפחתת היקפה לאחר תחילת הפעילות ייעשו בהודעה בכתב לפחות 30 ימים מראש או בהסכמה בכתב בין הצדדים.\nבתקופת ההודעה המוקדמת יישא בית הספר בתשלום עבור פעילויות שבוצעו או שתוכננו לתקופה זו, בהתאם להזמנת העבודה המאושרת ולהוראות גפ״ן.\nמפגש לא ידווח כמבוצע אלא אם התקיים בפועל או אם הדיווח מותר לפי הוראות גפ״ן.\nבמקרה של מצב חירום או הנחיות רשות מוסמכת, יתואם מתווה חלופי בהתאם להוראות גפ״ן, לרבות דחייה, התאמה או מעבר לפעילות מקוונת. פעילות מקוונת תתומחר לפי התעריף החל בגפ״ן, לרבות הפחתה של 10%, ככל שנדרש.',
    70,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'precedence',
    'כפיפות להוראות גפ״ן',
    'במקרה של סתירה בין הצעה זו לבין הוראות גפ״ן או הזמנת העבודה המאושרת במערכת, יגברו הוראות גפ״ן והזמנת העבודה המאושרת.',
    80,
    true
  ),
  (
    'gefen',
    'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ"ז',
    'גפן',
    'signature',
    'חתימה',
    'עידן נחום, סמנכ״ל כספים',
    90,
    true
  )
on conflict (template_key, section_key) do update set
  template_name = excluded.template_name,
  activity_type_group = excluded.activity_type_group,
  section_title = excluded.section_title,
  section_body = excluded.section_body,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.proposal_linked_documents (
  id uuid primary key default gen_random_uuid(),
  proposal_agreement_id uuid not null
    references public.proposals_agreements(id) on delete cascade,
  document_type text not null,
  status text not null default 'missing',
  combined_with_proposal boolean not null default false,
  file_path text,
  file_name text,
  document_snapshot jsonb,
  document_html_snapshot text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_linked_documents_type_check
    check (document_type = 'gefen_approval'),
  constraint proposal_linked_documents_status_check
    check (status in ('missing', 'generated')),
  constraint proposal_linked_documents_generated_file_check
    check (status <> 'generated' or nullif(btrim(file_path), '') is not null),
  constraint proposal_linked_documents_proposal_type_uidx
    unique (proposal_agreement_id, document_type)
);

create index if not exists proposal_linked_documents_proposal_idx
  on public.proposal_linked_documents (proposal_agreement_id, created_at desc);

alter table public.proposal_linked_documents enable row level security;

revoke all on table public.proposal_linked_documents from public, anon;
grant select, insert, update on table public.proposal_linked_documents
  to authenticated;

drop policy if exists "Authenticated users can view linked proposal documents"
  on public.proposal_linked_documents;
create policy "Authenticated users can view linked proposal documents"
  on public.proposal_linked_documents
  for select
  to authenticated
  using (public.app_can_use_proposals_agreements());

drop policy if exists "Proposal managers can create linked proposal documents"
  on public.proposal_linked_documents;
create policy "Proposal managers can create linked proposal documents"
  on public.proposal_linked_documents
  for insert
  to authenticated
  with check (public.app_can_manage_proposals_agreements());

drop policy if exists "Proposal managers can update linked proposal documents"
  on public.proposal_linked_documents;
create policy "Proposal managers can update linked proposal documents"
  on public.proposal_linked_documents
  for update
  to authenticated
  using (public.app_can_manage_proposals_agreements())
  with check (public.app_can_manage_proposals_agreements());

create or replace function public.set_proposal_linked_document_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists proposal_linked_documents_set_updated_at
  on public.proposal_linked_documents;
create trigger proposal_linked_documents_set_updated_at
before update on public.proposal_linked_documents
for each row execute function public.set_proposal_linked_document_updated_at();

create or replace function public.link_gefen_approval_to_combined_pdf()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.combine_gefen_approval = true
    and nullif(btrim(new.final_pdf_path), '') is not null
    and new.activity_type_group <> 'summer'
    and exists (
      select 1
      from public.proposal_agreement_items pai
      where pai.proposal_agreement_id = new.id
        and nullif(btrim(pai.gefen_number), '') is not null
        and coalesce(pai.proposal_group, '') <> 'summer'
    )
  then
    insert into public.proposal_linked_documents (
      proposal_agreement_id,
      document_type,
      status,
      combined_with_proposal,
      file_path,
      file_name,
      document_snapshot,
      document_html_snapshot,
      created_by
    )
    values (
      new.id,
      'gefen_approval',
      'generated',
      true,
      new.final_pdf_path,
      new.final_pdf_file_name,
      new.document_snapshot,
      new.document_html_snapshot,
      new.final_pdf_created_by
    )
    on conflict (proposal_agreement_id, document_type) do update set
      status = 'generated',
      combined_with_proposal = true,
      file_path = excluded.file_path,
      file_name = excluded.file_name,
      document_snapshot = excluded.document_snapshot,
      document_html_snapshot = excluded.document_html_snapshot,
      created_by = excluded.created_by,
      updated_at = now();
  end if;

  return new;
end;
$function$;

drop trigger if exists proposals_agreements_link_gefen_approval
  on public.proposals_agreements;
create trigger proposals_agreements_link_gefen_approval
after insert or update of final_pdf_path on public.proposals_agreements
for each row execute function public.link_gefen_approval_to_combined_pdf();

create or replace function public.app_can_approve_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.is_active = true
      and (
        u.user_id = '8000'
        or lower(coalesce(u.username, '')) = 'idann'
        or u.auth_user_id = 'e9ca304a-4e66-4774-830e-14f1318c4908'::uuid
      )
  );
$function$;

revoke all on function public.app_can_approve_proposals_agreements()
  from public, anon;
grant execute on function public.app_can_approve_proposals_agreements()
  to authenticated;

comment on function public.app_can_approve_proposals_agreements() is
  'Approval and signature are restricted to Idan Nahum, the authorized Taasiyeda signatory.';

create or replace view public.proposals_agreements_directory_view as
select
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  coalesce(s.semel_mosad, cs.semel_mosad) as semel_mosad,
  coalesce(a.authority_name, cs.authority, pa.client_authority) as authority_name,
  pa.client_authority as legacy_client_authority,
  cs.client_type as contact_client_type,
  cs.client_name as contact_client_name,
  coalesce(s.school_name, cs.school, pa.school_framework) as school_name,
  pa.school_framework as legacy_school_framework,
  pa.document_type,
  pa.activity_type_group,
  pa.proposal_domain,
  pa.proposal_date,
  pa.activity_names,
  pa.contact_name,
  pa.contact_role,
  pa.phone,
  pa.email,
  pa.notes,
  pa.status,
  pa.approval_note,
  pa.total_amount,
  pa.custom_document_sections,
  pa.include_catalog,
  pa.signature_meta,
  pa.approved_by,
  pa.approved_at,
  pa.sent_by,
  pa.sent_at,
  pa.locked_at,
  pa.locked_by,
  pa.locked_reason,
  pa.final_pdf_path,
  pa.final_pdf_file_name,
  pa.final_pdf_created_at,
  pa.final_pdf_created_by,
  pa.document_snapshot,
  pa.document_html_snapshot,
  pa.proposal_series_id,
  pa.version_number,
  pa.supersedes_proposal_id,
  pa.archived_at,
  pa.created_at,
  pa.updated_at,
  pa.quote_number,
  pa.valid_until,
  pa.combine_gefen_approval
from public.proposals_agreements pa
left join public.authorities a on a.id = pa.authority_id
left join public.contacts_schools cs on cs.id = pa.contact_school_id
left join public.schools s on s.id = pa.school_id;

grant select on public.proposals_agreements_directory_view to authenticated;
