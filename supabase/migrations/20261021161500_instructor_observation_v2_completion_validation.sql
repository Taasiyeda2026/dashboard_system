-- Version-aware immutable instructor observation completion checks.
-- Historical six-section reports keep the original completion contract.
-- Approved form version 2 requires 24 ratings, 11 narrative answers and 5 final items.
create or replace function public.instructor_observation_immutable()
returns trigger
language plpgsql set search_path = public, pg_temp
as $fn$
declare
  rating_key text;
  narrative_key text;
  required_ratings text[] := array['0-0','0-1','1-0','1-1','2-0','2-1','3-0','3-1','3-2','4-0','4-1','5-0','5-1','5-2','6-0','6-1','7-0','7-1','8-0','8-1','9-0','9-1','10-0','10-1'];
  required_narratives text[] := array['0','1','2','3','4','5','6','7','8','9','10'];
begin
  if old.status = 'completed' then
    raise exception 'completed_instructor_observation_is_immutable' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by
     or new.emp_id is distinct from old.emp_id
     or new.instructor_name is distinct from old.instructor_name
     or new.created_at is distinct from old.created_at then
    raise exception 'instructor_observation_identity_is_immutable' using errcode = '42501';
  end if;

  if coalesce(new.details->>'form_version','1') not in ('1','2')
     or (old.details->>'form_version' = '2'
         and new.details->>'form_version' is distinct from '2') then
    raise exception 'instructor_observation_form_version_invalid' using errcode = '23514';
  end if;

  if new.status = 'completed' then
    if new.overall_rating is null
       or btrim(new.strengths) = ''
       or btrim(new.improvements) = ''
       or btrim(new.summary) = ''
       or new.observation_date is null
       or new.completed_at is null
       or nullif(btrim(new.observer_name), '') is null
       or nullif(btrim(new.details->>'course'), '') is null
       or nullif(btrim(new.details->>'school'), '') is null
       or nullif(btrim(new.details->>'class'), '') is null
       or coalesce(new.details->>'school_staff','') not in ('כן','לא')
       or coalesce(new.details->>'meeting','') !~ '^[1-9][0-9]*$'
       or coalesce(new.details->>'students','') !~ '^[1-9][0-9]*$' then
      raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
    end if;

    if new.details->>'form_version' = '2' then
      if coalesce(btrim(new.details->>'recommendations'),'') = ''
         or not (new.responses ?& required_ratings)
         or not (new.comments ?& required_narratives) then
        raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
      end if;

      foreach rating_key in array required_ratings loop
        if coalesce(new.responses->>rating_key,'') not in
           ('1','2','3','4','5','לא נצפה','לא רלוונטי') then
          raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
        end if;
      end loop;

      foreach narrative_key in array required_narratives loop
        if coalesce(btrim(new.comments->>narrative_key),'') = '' then
          raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
        end if;
      end loop;
    elsif not (new.responses ?& array[
      '0-0','0-1','1-0','1-1','1-2','2-0','2-1','2-2',
      '3-0','3-1','4-0','4-1','4-2','5-0','5-1'
    ]) then
      raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$fn$;
