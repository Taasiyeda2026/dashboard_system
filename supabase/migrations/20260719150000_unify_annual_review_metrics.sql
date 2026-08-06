-- Give every 2026 annual review the same general evaluation framework.
-- This migration intentionally does not invoke the assignment provisioning RPC.

create or replace function public.annual_review_metric_definitions(
  p_employee_key public.annual_review_employee_key
) returns table(metric_key text, metric_label text, metric_group text, sort_order integer)
language sql
immutable
set search_path=pg_catalog
as $$
  select format('general_%s', lpad(metric.ord::text, 2, '0')),
         metric.label,
         'common'::text,
         metric.ord::integer
  from unnest(array[
    'הבנה של התפקיד, תהליכי העבודה והנהלים',
    'רמת המקצועיות והידע הנדרשים לביצוע התפקיד',
    'קליטת מידע חדש ויישומו בעבודה',
    'איכות העבודה, דיוק ובקרה עצמית',
    'סדר, ארגון ותיעוד של מידע ומשימות',
    'תכנון העבודה, ניהול זמן וקביעת סדרי עדיפויות',
    'עמידה בלוחות זמנים וביצוע מעקב שוטף',
    'אחריות, עצמאות וסגירת משימות מתחילתן ועד סופן',
    'גמישות והסתגלות לשינויים ולמצבים בלתי צפויים',
    'תפקוד במצבי עומס ובריבוי משימות',
    'מוטיבציה, יוזמה ונכונות לקחת אחריות',
    'תקשורת מקצועית, שיתוף פעולה ושקיפות',
    'קבלת משוב, למידה ויישום המלצות',
    'שירותיות, יחסי אנוש ויצירת אמון',
    'מחויבות לארגון, למטרותיו ולערכיו',
    'התמודדות עם בעיות, הפעלת שיקול דעת וטיפול עצמאי עד לפתרון'
  ]) with ordinality as metric(label, ord)
  where p_employee_key is not null
$$;

revoke all on function public.annual_review_metric_definitions(public.annual_review_employee_key) from public, anon;
grant execute on function public.annual_review_metric_definitions(public.annual_review_employee_key) to authenticated;

-- Keep the operator-only provisioning definition consistent for future, reviewed
-- environments. Defining the RPC is not the same as invoking it here.
create or replace function public.provision_annual_review_assignments(
  p_manager_id uuid, p_tony_id uuid, p_hila_id uuid, p_gil_id uuid, p_eden_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare ids uuid[] := array[p_manager_id,p_tony_id,p_hila_id,p_gil_id,p_eden_id];
begin
  if array_position(ids, null) is not null or (select count(distinct x) from unnest(ids) x) <> 5 then
    raise exception 'annual_review_assignment_ids_must_be_five_distinct_auth_uuids';
  end if;
  if (select count(*) from auth.users where id = any(ids)) <> 5 then
    raise exception 'annual_review_assignment_auth_uuid_not_found';
  end if;

  insert into public.annual_review_assignments(employee_key,employee_id,manager_id,employee_name,employee_role) values
    ('tony_naim',p_tony_id,p_manager_id,'טוני נעים','הנהלת חשבונות וחשבות שכר'),
    ('hila_rozen',p_hila_id,p_manager_id,'הילה רוזן','אחראית הדרכה ארצית בכל תוכניות תעשיידע'),
    ('gil_neeman',p_gil_id,p_manager_id,'גיל נאמן','מנהל פעילויות ארצי'),
    ('eden_cohen',p_eden_id,p_manager_id,'עדן כהן','מתאמת פעילויות ואדמיניסטרציה ארצית')
  on conflict (employee_key) do update
    set employee_id=excluded.employee_id, manager_id=excluded.manager_id;

  insert into public.annual_reviews(employee_id,manager_id,review_year)
  select employee_id,manager_id,extract(year from current_date)::integer
  from public.annual_review_assignments
  on conflict (employee_id,review_year) do nothing;

  insert into public.manager_review_evaluations(review_id,metric_key,metric_label,metric_group,sort_order)
  select review.id, definition.metric_key, definition.metric_label,
         definition.metric_group, definition.sort_order
  from public.annual_reviews review
  join public.annual_review_assignments assignment
    on assignment.employee_id=review.employee_id and assignment.manager_id=review.manager_id
  cross join lateral public.annual_review_metric_definitions(assignment.employee_key) definition
  on conflict(review_id,metric_key) do nothing;
end $$;
revoke all on function public.provision_annual_review_assignments(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;

-- Production may already contain three or four reviews. Fill only a missing 2026
-- review for one of the four existing assignments; do not modify assignments.
insert into public.annual_reviews(employee_id, manager_id, review_year, status)
select assignment.employee_id, assignment.manager_id, 2026, 'not_opened'
from public.annual_review_assignments assignment
where assignment.employee_key in ('tony_naim', 'hila_rozen', 'gil_neeman', 'eden_cohen')
on conflict (employee_id, review_year) do nothing;

-- Only reviews with no user-authored content are eligible for definition replacement.
-- Existing ratings, comments, summaries, goals, or employee responses make a review
-- ineligible even if its lifecycle status was accidentally left at not_opened.
create temporary table annual_review_pristine_2026 on commit drop as
select review.id, assignment.employee_key
from public.annual_reviews review
join public.annual_review_assignments assignment
  on assignment.employee_id = review.employee_id
 and assignment.manager_id = review.manager_id
where review.review_year = 2026
  and review.status = 'not_opened'
  and assignment.employee_key in ('tony_naim', 'hila_rozen', 'gil_neeman', 'eden_cohen')
  and not exists (
    select 1 from public.manager_review_evaluations evaluation
    where evaluation.review_id = review.id
      and (evaluation.rating is not null
        or evaluation.not_applicable
        or nullif(btrim(evaluation.comment), '') is not null)
  )
  and not exists (select 1 from public.review_conversation_summary summary where summary.review_id = review.id)
  and not exists (select 1 from public.review_goals goal where goal.review_id = review.id)
  and not exists (select 1 from public.employee_review_response response where response.review_id = review.id);

delete from public.manager_review_evaluations evaluation
using annual_review_pristine_2026 pristine
where evaluation.review_id = pristine.id;

insert into public.manager_review_evaluations(
  review_id, metric_key, metric_label, metric_group, sort_order
)
select pristine.id, definition.metric_key, definition.metric_label,
       definition.metric_group, definition.sort_order
from annual_review_pristine_2026 pristine
cross join lateral public.annual_review_metric_definitions(pristine.employee_key) definition;
