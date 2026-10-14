-- Approved canonical mapping: elementary Biomimicry = 6089;
-- middle/secondary Biomimicry = 53828.
-- The retired 82835 code was mistakenly used for BOTH ages, so NEVER map it
-- to a single new ID without per-activity evidence.
begin;
set local app.skip_dynamic_lists_sync = 'on';

create schema if not exists private;
create table if not exists private.biomimicry_20261015_correction_audit (
  correction_key text primary key,
  corrected_at timestamptz not null default now(),
  reason text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null
);
revoke all on private.biomimicry_20261015_correction_audit
  from public, anon, authenticated;

do $validate$
declare
  v_count integer;
begin
  if exists(select 1 from private.biomimicry_20261015_correction_audit
            where correction_key='biomimicry-grade-correction-20261015') then
    raise exception 'This correction has already been applied';
  end if;
  select count(*) into v_count from public.activities
  where activity_season='school_2027' and activity_no='82835';
  if v_count<>49 then raise exception 'Expected 49 legacy activity rows, found %',v_count; end if;

  select count(*) into v_count from public.activities
  where activity_season='school_2027' and activity_no='82835'
    and row_id in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032');
  if v_count<>2 then raise exception 'Expected two confirmed secondary rows'; end if;

  select count(*) into v_count from public.activities
  where activity_season='school_2027' and activity_no='82835'
    and row_id not in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032')
    and (grade ~ '[זחט]' or coalesce(education_level,'') in ('middle_school','secondary','high_school'));
  if v_count<>0 then raise exception 'Unexpected middle-school evidence in elementary correction'; end if;

  -- Proposal-linked legacy rows MUST all be elementary 6089.
  select count(*) into v_count
  from public.activities a join public.proposal_agreement_items i on i.id=a.proposal_item_id
  where a.activity_no='82835' and a.activity_season='school_2027'
    and (i.activity_no is distinct from '6089' or i.gefen_number is distinct from '6089');
  if v_count<>0 then raise exception 'Legacy rows have conflicting proposal item program numbers'; end if;

  select count(*) into v_count from public.attendance_records
  where activity_no='82835'
    and activity_row_id not in (select row_id from public.activities
                               where activity_season='school_2027' and activity_no='82835');
  if v_count<>0 then raise exception 'Orphaned legacy attendance references'; end if;

  select count(*) into v_count from public.feedback_campaigns
  where activity_row_id='school_2027_111' and program_key='biomimicry_secondary'
    and audience='student' and stage='pre'
    and not exists(select 1 from public.feedback_responses r where r.campaign_id=feedback_campaigns.id);
  if v_count<>1 then raise exception 'Expected one unanswered incorrectly-mapped elementary student campaign'; end if;

  select count(*) into v_count from public.lists where list_id in (28,29,378)
    and category='activity_names';
  if v_count<>3 then raise exception 'Activity catalog identifiers differ; abort'; end if;
end
$validate$;

insert into private.biomimicry_20261015_correction_audit
  (correction_key,reason,before_snapshot,after_snapshot)
select 'biomimicry-grade-correction-20261015',
 'User confirmed elementary=6089, secondary=53828. 82835 applied wrongly to 47 elementary activities and 2 secondary ones. Preserve proposals, scheduling and feedback links.',
 jsonb_build_object(
   'legacy_activities',(select coalesce(jsonb_agg(to_jsonb(a) order by a.row_id),'[]'::jsonb) from public.activities a where a.activity_no='82835' and a.activity_season='school_2027'),
   'other_biomimicry_2027',(select coalesce(jsonb_agg(to_jsonb(a) order by a.row_id),'[]'::jsonb) from public.activities a where a.activity_season='school_2027' and a.activity_no in ('6089','53828')),
   'attendance',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.attendance_records r where r.activity_no='82835'),
   'list_options',(select coalesce(jsonb_agg(to_jsonb(l) order by l.list_id),'[]'::jsonb) from public.lists l where l.list_id in (28,29,378)),
   'campaign',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.feedback_campaigns c where c.activity_row_id='school_2027_111'),
   'delivery',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.feedback_auto_delivery d where d.activity_row_id='school_2027_111')
 ), '{}'::jsonb;

-- Preserve activity row IDs, activity dates, assigned instructors and proposed meetings.
-- The two secondary rows have independent school evidence: seventh grade and high school.
update public.activities a
set activity_no=case when a.row_id in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032') then '53828' else '6089' end,
    gefen_number=case when a.row_id in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032') then '53828' else '6089' end,
    education_level=case when a.row_id in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032') then 'middle_school' else 'elementary' end,
    catalog_slug=case
      when nullif(trim(coalesce(a.catalog_slug,'')),'') is not null
        and a.catalog_slug in('6089','53828','82835','9545')
      then case when a.row_id in ('ACT-7b152c38-7975-4658-a0ee-17a050491dcb','school_2027_032') then '53828' else '6089' end
      else a.catalog_slug end
where a.activity_season='school_2027' and a.activity_no='82835';

-- Harmonize the already canonical school-2027 Biomimicry rows.
update public.activities a set
  gefen_number=a.activity_no,
  education_level=case when a.activity_no='6089' then 'elementary' else 'middle_school' end
where a.activity_season='school_2027' and a.activity_no in('6089','53828')
  and (a.gefen_number is distinct from a.activity_no
       or a.education_level is distinct from (case when a.activity_no='6089' then 'elementary' else 'middle_school' end));

-- A small number of already approved attendance rows recorded old incorrect
-- course number; preserve record ID, hours, approval and payroll information.
update public.attendance_records r
set activity_no=a.activity_no, updated_at=now()
from public.activities a
where r.activity_no='82835' and r.activity_row_id=a.row_id
  and a.activity_season='school_2027'
  and a.activity_no in('6089','53828');

-- The actual cause of incorrect new selections: middle course disabled, obsolete 82835 enabled.
update public.lists set
  active=true,is_active=true,label='ביומימיקרי (יסודי)',label_he='ביומימיקרי (יסודי)',updated_at=now()
where list_id=28 and category='activity_names' and activity_no='6089';
update public.lists set
  active=true,is_active=true,label='ביומימיקרי (לחטיבה)',label_he='ביומימיקרי (לחטיבה)',updated_at=now()
where list_id=29 and category='activity_names' and activity_no='53828';
update public.lists set active=false,is_active=false,updated_at=now()
where list_id=378 and category='activity_names' and activity_no='82835';

-- One elementary student survey was erroneously associated with secondary
-- template; zero responses so far. Keep campaign ID and public link unchanged.
update public.feedback_campaigns c
set program_key='biomimicry',
    template_version_id=(select t.current_version_id from public.feedback_templates t
                         where t.program_key='biomimicry' and t.audience='student'
                           and t.stage='pre'),
    updated_at=now()
where c.activity_row_id='school_2027_111'
  and c.program_key='biomimicry_secondary'
  and not exists(select 1 from public.feedback_responses r where r.campaign_id=c.id);

update public.feedback_auto_delivery d
set program_key='biomimicry',updated_at=now()
where d.activity_row_id='school_2027_111'
  and d.program_key='biomimicry_secondary'
  and d.status='pending';

-- Remove the incorrect global assumption that 82835 means secondary.
-- Future classification uses the actual corrected program number.
create or replace function private.feedback_canonical_program_number(p_value text)
returns text language sql immutable set search_path = ''
as $fn$
  select nullif(btrim(coalesce(p_value,'')), '');
$fn$;
revoke all on function private.feedback_canonical_program_number(text) from public,anon,authenticated;

-- Reject reintroduction of the obsolete activity number in school-2027.
alter table public.activities
  add constraint activities_school2027_biomimicry_no_82835
  check (
    coalesce(activity_season,'') <> 'school_2027'
    or (coalesce(activity_no,'') <> '82835' and coalesce(gefen_number,'') <> '82835')
  );

do $final$
declare n integer;
begin
  select count(*) into n from public.activities where activity_season='school_2027' and
  (activity_no='82835' or gefen_number='82835');
  if n<>0 then raise exception '82835 still present in school-2027: %',n; end if;
  select count(*) into n from public.activities where activity_season='school_2027' and activity_no='6089';
  if n<>89 then raise exception 'Expected 89 elementary records, found %',n; end if;
  select count(*) into n from public.activities where activity_season='school_2027' and activity_no='53828';
  if n<>12 then raise exception 'Expected 12 secondary records, found %',n; end if;
  select count(*) into n from public.activities where activity_season='school_2027' and activity_no in('6089','53828')
    and (gefen_number is distinct from activity_no or education_level is distinct from
         (case when activity_no='6089' then 'elementary' else 'middle_school' end));
  if n<>0 then raise exception 'Biomimicry 2027 has mismatched identities or school levels'; end if;
  select count(*) into n from public.attendance_records where activity_no='82835';
  if n<>0 then raise exception 'Legacy attendance still present: %',n; end if;
  select count(*) into n from public.lists where category='activity_names' and activity_no='82835'
    and (active or is_active);
  if n<>0 then raise exception 'Legacy 82835 still selectable'; end if;
  select count(*) into n from public.lists where category='activity_names'
    and activity_no in('6089','53828') and active and is_active;
  if n<>2 then raise exception 'Both canonical selection options must be enabled'; end if;
  select count(*) into n from public.feedback_campaigns c
    join public.feedback_templates t on t.current_version_id=c.template_version_id
    where c.activity_row_id='school_2027_111' and c.program_key='biomimicry'
      and t.program_key='biomimicry';
  if n<>1 then raise exception 'Elementary survey template was not corrected'; end if;
end
$final$;

update private.biomimicry_20261015_correction_audit
set after_snapshot=jsonb_build_object(
   'biomimicry_2027',(select coalesce(jsonb_agg(to_jsonb(a) order by a.row_id),'[]'::jsonb) from public.activities a where a.activity_season='school_2027' and a.activity_no in('6089','53828')),
   'attendance',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.attendance_records r where r.activity_row_id in (select row_id from public.activities where activity_season='school_2027' and activity_no in('6089','53828')) and r.report_date is not null and r.activity_no in('6089','53828')),
   'list_options',(select coalesce(jsonb_agg(to_jsonb(l) order by l.list_id),'[]'::jsonb) from public.lists l where l.list_id in(28,29,378)),
   'campaign',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.feedback_campaigns c where c.activity_row_id='school_2027_111'),
   'delivery',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.feedback_auto_delivery d where d.activity_row_id='school_2027_111')
)
where correction_key='biomimicry-grade-correction-20261015';

commit;
