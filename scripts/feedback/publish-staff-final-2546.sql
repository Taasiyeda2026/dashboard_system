-- Run after the #2546 frontend deployment and all available acceptance checks pass.
-- Report browser checks separately if network policy prevents them.
-- One transaction: preserve all response snapshots and existing link tokens/statuses.
begin;
do $publish$
declare
  version record;
  campaign record;
  updated_campaigns integer := 0;
begin
  if (select count(*) from public.feedback_template_versions v join public.feedback_templates t on t.id=v.template_id
      where t.audience='educational_staff' and t.stage='final' and v.status='draft'
        and v.notes='Approved Hebrew final 2026; pending Arabic and conditional UI') <> 11 then
    raise exception 'staff_final_expected_11_reviewed_drafts';
  end if;
  for version in
    select v.id,v.template_id from public.feedback_template_versions v join public.feedback_templates t on t.id=v.template_id
    where t.audience='educational_staff' and t.stage='final' and v.status='draft'
      and v.notes='Approved Hebrew final 2026; pending Arabic and conditional UI'
    order by v.id for update of v
  loop
    if (select count(*) from public.feedback_template_questions q where q.version_id=version.id
        and q.required and nullif(q.wording->>'ar','') is not null and q.scoring ? 'question_number') <> 33
      or (select count(*) from public.feedback_template_questions q where q.version_id=version.id
        and q.scoring ? 'visible_when') <> 3 then
      raise exception 'staff_final_unreviewed_draft';
    end if;
    update public.feedback_template_versions
      set notes='Issue #2546: 33-question Hebrew/Arabic staff final, reviewed against owner specification 2026-11-01; Arabic working translation, not certified official translation'
      where id=version.id;
    perform private.feedback_publish_version(version.id);
    -- Lock campaigns in the same order as submission. Recheck responses after
    -- obtaining the lock so a concurrent submission keeps its original version.
    for campaign in
      select c.id from public.feedback_campaigns c
      join public.feedback_template_versions old_v on old_v.id=c.template_version_id
      where old_v.template_id=version.template_id and c.status='active'
        and c.audience='educational_staff' and c.stage='final'
        and c.template_version_id<>version.id
      order by c.id for update of c
    loop
      if not exists(select 1 from public.feedback_responses r where r.campaign_id=campaign.id) then
        update public.feedback_campaigns set template_version_id=version.id where id=campaign.id;
        updated_campaigns := updated_campaigns+1;
      end if;
    end loop;
  end loop;
  raise notice 'Published 11 staff-final templates; rebound % unanswered active campaigns',updated_campaigns;
end $publish$;
commit;
