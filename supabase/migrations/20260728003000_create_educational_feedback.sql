-- Public educational-team feedback for Taasiyeda summer activities.
-- Secure personal links are validated through SECURITY DEFINER RPC functions.
create schema if not exists private;

create or replace function private.is_educational_feedback_manager()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id=(select auth.uid())
      and coalesce(u.is_active,false)
      and u.role in ('admin','operation_manager','activities_manager','instructor_manager','domain_manager')
  );
$$;

revoke all on function private.is_educational_feedback_manager() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_educational_feedback_manager() to authenticated;

create table if not exists public.educational_feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique,
  title text not null,
  intro_text text not null default '',
  status text not null default 'draft' check (status in ('draft','open','closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.educational_feedback_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.educational_feedback_campaigns(id) on delete cascade,
  authority_name text not null,
  school_name text not null,
  access_token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  sent_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id,authority_name,school_name)
);

create index if not exists educational_feedback_recipients_campaign_idx
  on public.educational_feedback_recipients(campaign_id,authority_name,school_name);

create table if not exists public.educational_feedback_responses (
  recipient_id uuid primary key references public.educational_feedback_recipients(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','submitted')),
  respondent_name text not null default '',
  respondent_role text not null default '',
  respondent_role_other text not null default '',
  satisfaction_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(satisfaction_answers)='object'),
  student_experience_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(student_experience_answers)='object'),
  student_highlights text[] not null default '{}'::text[],
  preserve_text text not null default '',
  improve_text text not null default '',
  future_interest text not null default ''
    check (future_interest in ('','yes','maybe','no')),
  memorable_response text not null default '',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create index if not exists educational_feedback_responses_status_idx
  on public.educational_feedback_responses(status,updated_at desc);

create or replace function public.educational_feedback_touch_updated_at()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at:=now();
  if tg_table_name='educational_feedback_responses' and tg_op='UPDATE' then
    new.version:=old.version+1;
  end if;
  return new;
end;
$$;

drop trigger if exists educational_feedback_campaigns_touch_trg
  on public.educational_feedback_campaigns;
create trigger educational_feedback_campaigns_touch_trg
before update on public.educational_feedback_campaigns
for each row execute function public.educational_feedback_touch_updated_at();

drop trigger if exists educational_feedback_recipients_touch_trg
  on public.educational_feedback_recipients;
create trigger educational_feedback_recipients_touch_trg
before update on public.educational_feedback_recipients
for each row execute function public.educational_feedback_touch_updated_at();

drop trigger if exists educational_feedback_responses_touch_trg
  on public.educational_feedback_responses;
create trigger educational_feedback_responses_touch_trg
before update on public.educational_feedback_responses
for each row execute function public.educational_feedback_touch_updated_at();

alter table public.educational_feedback_campaigns enable row level security;
alter table public.educational_feedback_recipients enable row level security;
alter table public.educational_feedback_responses enable row level security;

revoke all on public.educational_feedback_campaigns,
  public.educational_feedback_recipients,
  public.educational_feedback_responses
from anon;

grant select,insert,update,delete on public.educational_feedback_campaigns,
  public.educational_feedback_recipients,
  public.educational_feedback_responses
to authenticated;

grant all on public.educational_feedback_campaigns,
  public.educational_feedback_recipients,
  public.educational_feedback_responses
to service_role;

drop policy if exists educational_feedback_campaigns_manager_all
  on public.educational_feedback_campaigns;
create policy educational_feedback_campaigns_manager_all
on public.educational_feedback_campaigns
for all to authenticated
using ((select private.is_educational_feedback_manager()))
with check ((select private.is_educational_feedback_manager()));

drop policy if exists educational_feedback_recipients_manager_all
  on public.educational_feedback_recipients;
create policy educational_feedback_recipients_manager_all
on public.educational_feedback_recipients
for all to authenticated
using ((select private.is_educational_feedback_manager()))
with check ((select private.is_educational_feedback_manager()));

drop policy if exists educational_feedback_responses_manager_all
  on public.educational_feedback_responses;
create policy educational_feedback_responses_manager_all
on public.educational_feedback_responses
for all to authenticated
using ((select private.is_educational_feedback_manager()))
with check ((select private.is_educational_feedback_manager()));

create or replace function public.educational_feedback_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rec record;
  v_response jsonb;
  v_can_edit boolean;
begin
  if p_token is null or length(trim(p_token))<32 then
    return jsonb_build_object('ok',false,'code','invalid_link');
  end if;

  select
    r.id as recipient_id,
    r.authority_name,
    r.school_name,
    c.id as campaign_id,
    c.campaign_key,
    c.title,
    c.intro_text,
    c.status as campaign_status,
    c.opens_at,
    c.closes_at
  into v_rec
  from public.educational_feedback_recipients r
  join public.educational_feedback_campaigns c on c.id=r.campaign_id
  where r.access_token=trim(p_token)
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'code','invalid_link');
  end if;

  v_can_edit :=
    v_rec.campaign_status='open'
    and (v_rec.opens_at is null or v_rec.opens_at<=now())
    and (v_rec.closes_at is null or v_rec.closes_at>=now());

  update public.educational_feedback_recipients
  set first_opened_at=coalesce(first_opened_at,now()),
      last_opened_at=now()
  where id=v_rec.recipient_id;

  select jsonb_build_object(
    'status',x.status,
    'respondent_name',x.respondent_name,
    'respondent_role',x.respondent_role,
    'respondent_role_other',x.respondent_role_other,
    'satisfaction_answers',x.satisfaction_answers,
    'student_experience_answers',x.student_experience_answers,
    'student_highlights',to_jsonb(x.student_highlights),
    'preserve_text',x.preserve_text,
    'improve_text',x.improve_text,
    'future_interest',x.future_interest,
    'memorable_response',x.memorable_response,
    'submitted_at',x.submitted_at,
    'updated_at',x.updated_at,
    'version',x.version
  )
  into v_response
  from public.educational_feedback_responses x
  where x.recipient_id=v_rec.recipient_id;

  return jsonb_build_object(
    'ok',true,
    'can_edit',v_can_edit,
    'campaign',jsonb_build_object(
      'key',v_rec.campaign_key,
      'title',v_rec.title,
      'intro_text',v_rec.intro_text,
      'status',v_rec.campaign_status,
      'opens_at',v_rec.opens_at,
      'closes_at',v_rec.closes_at
    ),
    'recipient',jsonb_build_object(
      'authority_name',v_rec.authority_name,
      'school_name',v_rec.school_name
    ),
    'response',coalesce(v_response,'null'::jsonb)
  );
end;
$$;

create or replace function public.educational_feedback_save(
  p_token text,
  p_payload jsonb,
  p_submit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rec record;
  v_name text:=trim(coalesce(p_payload->>'respondent_name',''));
  v_role text:=trim(coalesce(p_payload->>'respondent_role',''));
  v_role_other text:=trim(coalesce(p_payload->>'respondent_role_other',''));
  v_satisfaction jsonb:=coalesce(p_payload->'satisfaction_answers','{}'::jsonb);
  v_student jsonb:=coalesce(p_payload->'student_experience_answers','{}'::jsonb);
  v_highlights text[];
  v_preserve text:=trim(coalesce(p_payload->>'preserve_text',''));
  v_improve text:=trim(coalesce(p_payload->>'improve_text',''));
  v_future text:=trim(coalesce(p_payload->>'future_interest',''));
  v_memorable text:=trim(coalesce(p_payload->>'memorable_response',''));
  v_required_satisfaction text[]:=array[
    'coordination_info',
    'facilitation_professionalism',
    'age_group_fit',
    'content_equipment_duration',
    'learning_experience',
    'expectations_staff',
    'overall_satisfaction'
  ];
  v_required_student text[]:=array[
    'interest_curiosity',
    'active_participation',
    'enjoyment_motivation',
    'building_creation',
    'positive_experience'
  ];
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'נתוני המשוב אינם תקינים' using errcode='22023';
  end if;

  select
    r.id as recipient_id,
    c.status as campaign_status,
    c.opens_at,
    c.closes_at
  into v_rec
  from public.educational_feedback_recipients r
  join public.educational_feedback_campaigns c on c.id=r.campaign_id
  where r.access_token=trim(coalesce(p_token,''))
  limit 1;

  if not found then
    raise exception 'קישור המשוב אינו תקין' using errcode='22023';
  end if;

  if v_rec.campaign_status<>'open'
    or (v_rec.opens_at is not null and v_rec.opens_at>now())
    or (v_rec.closes_at is not null and v_rec.closes_at<now())
  then
    raise exception 'המשוב אינו פתוח כעת למילוי' using errcode='22023';
  end if;

  if jsonb_typeof(v_satisfaction)<>'object'
    or jsonb_typeof(v_student)<>'object'
  then
    raise exception 'דירוגי המשוב אינם תקינים' using errcode='22023';
  end if;

  if exists (
    select 1 from jsonb_each_text(v_satisfaction)
    where value not in ('1','2','3','4','5','na')
  ) or exists (
    select 1 from jsonb_each_text(v_student)
    where value not in ('1','2','3','4','5','na')
  ) then
    raise exception 'ערכי הדירוג חייבים להיות בין 1 ל-5 או לא ניתן להתרשם'
      using errcode='22023';
  end if;

  if jsonb_typeof(coalesce(p_payload->'student_highlights','[]'::jsonb))<>'array' then
    raise exception 'בחירת תגובות התלמידים אינה תקינה' using errcode='22023';
  end if;

  select coalesce(array_agg(value order by ordinality),'{}'::text[])
  into v_highlights
  from jsonb_array_elements_text(
    coalesce(p_payload->'student_highlights','[]'::jsonb)
  ) with ordinality;

  if v_role not in ('manager','coordinator','teacher','other','') then
    raise exception 'תפקיד ממלא/ת המשוב אינו תקין' using errcode='22023';
  end if;

  if v_future not in ('yes','maybe','no','') then
    raise exception 'בחירת העניין בפעילות נוספת אינה תקינה' using errcode='22023';
  end if;

  if p_submit then
    if length(v_name)<2 then
      raise exception 'יש למלא שם מלא' using errcode='22023';
    end if;
    if v_role='' then
      raise exception 'יש לבחור תפקיד' using errcode='22023';
    end if;
    if v_role='other' and length(v_role_other)<2 then
      raise exception 'יש לפרט את התפקיד' using errcode='22023';
    end if;

    foreach v_key in array v_required_satisfaction loop
      if not (v_satisfaction ? v_key) then
        raise exception 'יש להשלים את כל היגדי שביעות הרצון' using errcode='22023';
      end if;
    end loop;

    foreach v_key in array v_required_student loop
      if not (v_student ? v_key) then
        raise exception 'יש להשלים את כל היגדי חוויית התלמידים' using errcode='22023';
      end if;
    end loop;

    if cardinality(v_highlights)=0 then
      raise exception 'יש לבחור לפחות תגובה אחת של התלמידים' using errcode='22023';
    end if;
    if length(v_preserve)<3 then
      raise exception 'יש לציין מה חשוב לשמר' using errcode='22023';
    end if;
    if length(v_improve)<3 then
      raise exception 'יש לציין מה ניתן לשפר' using errcode='22023';
    end if;
    if v_future='' then
      raise exception 'יש לבחור האם תהיו מעוניינים בפעילות נוספת' using errcode='22023';
    end if;
  end if;

  insert into public.educational_feedback_responses (
    recipient_id,
    status,
    respondent_name,
    respondent_role,
    respondent_role_other,
    satisfaction_answers,
    student_experience_answers,
    student_highlights,
    preserve_text,
    improve_text,
    future_interest,
    memorable_response,
    submitted_at
  )
  values (
    v_rec.recipient_id,
    case when p_submit then 'submitted' else 'draft' end,
    v_name,
    v_role,
    case when v_role='other' then v_role_other else '' end,
    v_satisfaction,
    v_student,
    v_highlights,
    v_preserve,
    v_improve,
    v_future,
    v_memorable,
    case when p_submit then now() else null end
  )
  on conflict (recipient_id) do update set
    status=excluded.status,
    respondent_name=excluded.respondent_name,
    respondent_role=excluded.respondent_role,
    respondent_role_other=excluded.respondent_role_other,
    satisfaction_answers=excluded.satisfaction_answers,
    student_experience_answers=excluded.student_experience_answers,
    student_highlights=excluded.student_highlights,
    preserve_text=excluded.preserve_text,
    improve_text=excluded.improve_text,
    future_interest=excluded.future_interest,
    memorable_response=excluded.memorable_response,
    submitted_at=excluded.submitted_at;

  return jsonb_build_object(
    'ok',true,
    'status',case when p_submit then 'submitted' else 'draft' end,
    'saved_at',now()
  );
end;
$$;

revoke all on function public.educational_feedback_get(text) from public;
revoke all on function public.educational_feedback_save(text,jsonb,boolean) from public;
grant execute on function public.educational_feedback_get(text) to anon,authenticated;
grant execute on function public.educational_feedback_save(text,jsonb,boolean) to anon,authenticated;

insert into public.educational_feedback_campaigns (
  campaign_key,
  title,
  intro_text,
  status
)
values (
  'summer_2026_educational_staff',
  'משוב לצוות החינוכי – פעילויות הקיץ של תעשיידע',
  'נשמח לקבל משוב קצר על שביעות רצונכם מהפעילויות ועל האופן שבו התלמידים חוו אותן, כפי שבא לידי ביטוי בהשתתפותם, בהתנהגותם ובתגובותיהם בפועל.',
  'open'
)
on conflict (campaign_key) do update set
  title=excluded.title,
  intro_text=excluded.intro_text;

with campaign as (
  select id
  from public.educational_feedback_campaigns
  where campaign_key='summer_2026_educational_staff'
)
insert into public.educational_feedback_recipients (
  campaign_id,
  authority_name,
  school_name
)
select campaign.id,source.authority_name,source.school_name
from campaign
cross join (
  values
    ('אשכול','מרחבי אשכול'),
    ('גן יבנה','בן גוריון'),
    ('גן יבנה','שיר השירים'),
    ('כפר ורדים','קשת'),
    ('לכיש','רבקה גובר'),
    ('נהריה','אוסישקין'),
    ('נהריה','הדרור'),
    ('נהריה','גולדה'),
    ('נהריה','אביר יעקב'),
    ('נהריה','רמבם מד'),
    ('קריית גת','מנחם בגין'),
    ('קריית גת','אפרים בן דוד'),
    ('קריית שמונה','מגנים'),
    ('קריית שמונה','רמב"ם'),
    ('רחובות','בן גוריון'),
    ('רחובות','הרצוג'),
    ('רחובות','סמילנסקי'),
    ('רחובות','פרחי המדע'),
    ('רחובות','רמת אלון'),
    ('רחובות','שזר'),
    ('רחובות','שפרינצק'),
    ('רחובות','שריד'),
    ('רחובות','בגין+שדמה'),
    ('רחובות','בכור לוי'),
    ('רחובות','גלים'),
    ('רחובות','השיטה'),
    ('רחובות','ויצמן+בן צבי'),
    ('רחובות','נבון'),
    ('רחובות','ניצני המדע'),
    ('רחובות','רמון'),
    ('רחובות-קריית משה','שביט'),
    ('שדרות','מדעים אלון'),
    ('שדרות','שקמים'),
    ('שדרות','נריה')
) as source(authority_name,school_name)
on conflict (campaign_id,authority_name,school_name) do nothing;

notify pgrst,'reload schema';
