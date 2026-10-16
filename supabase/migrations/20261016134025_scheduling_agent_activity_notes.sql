-- Append-only operational activity notes through the organizational agent.
-- The same direct-edit permission as activities UPDATE RLS is enforced.
create table public.scheduling_activity_note_audit (
 id bigint generated always as identity primary key,
 activity_id text not null,
 request_id uuid not null,
 actor_id uuid not null references auth.users(id),
 note_text text not null,
 previous_notes text,
 resulting_version text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_id)
);
create index scheduling_activity_note_audit_activity on public.scheduling_activity_note_audit(activity_id);
alter table public.scheduling_activity_note_audit enable row level security;
revoke all on public.scheduling_activity_note_audit from public,anon,authenticated;
comment on table public.scheduling_activity_note_audit is 'RPC-only audit; default-deny RLS intentionally has no client policies. No assignment or approval effects.';

create function public.scheduling_agent_team_read_activity_notes(p_activity_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.activities;
begin
 perform public.scheduling_agent_team_assert_member();
 select * into a from public.activities where row_id=p_activity_id
  and activity_season='school_2027' and activity_type='course';
 if not found then raise exception 'activity_notes_not_found'; end if;
 return jsonb_build_object('activityId',a.row_id,'school',a.school,'program',a.activity_name,
  'notes',coalesce(a.notes,''),'notesVersion',md5(coalesce(a.notes,'')),
  'canAppendNotes',coalesce(public.app_can_edit_direct(),false));
end $$;

create function public.scheduling_agent_team_append_activity_note(p_activity_id text,p_note text,p_expected_notes_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.activities; prior public.scheduling_activity_note_audit; updated_notes text; result jsonb;
begin
 perform public.scheduling_agent_team_assert_member();
 if public.app_can_edit_direct() is not true then raise exception 'activity_notes_permission_denied' using errcode='42501'; end if;
 if p_request_id is null or p_note is null or length(btrim(p_note)) not between 1 and 2000
   or p_expected_notes_version is null or p_expected_notes_version !~ '^[a-f0-9]{32}$'
 then raise exception 'activity_notes_invalid'; end if;
 -- Serialize retries, including the same request ID accidentally used on another course.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
 select * into a from public.activities where row_id=p_activity_id
  and activity_season='school_2027' and activity_type='course' for update;
 if not found then raise exception 'activity_notes_not_found'; end if;
 select * into prior from public.scheduling_activity_note_audit where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.activity_id<>p_activity_id or prior.note_text<>btrim(p_note) then raise exception 'activity_notes_request_conflict' using errcode='PT409'; end if;
  return public.scheduling_agent_team_read_activity_notes(p_activity_id) || jsonb_build_object('saved',true,'alreadyApplied',true,'requestId',p_request_id,'savedNotesVersion',prior.resulting_version,'assignmentChanged',false);
 end if;
 if md5(coalesce(a.notes,''))<>p_expected_notes_version then raise exception 'activity_notes_version_conflict' using errcode='PT409'; end if;
 updated_notes:=case when coalesce(a.notes,'')='' then btrim(p_note) else a.notes || chr(10) || btrim(p_note) end;
 if length(updated_notes)>20000 then raise exception 'activity_notes_capacity'; end if;
 -- Do not touch scheduling_note, finance_notes, operations_private_notes, or any assignment field.
 update public.activities set notes=updated_notes where row_id=p_activity_id;
 -- Read after UPDATE triggers; never claim the append persisted if a trigger changed it.
 select notes into updated_notes from public.activities where row_id=p_activity_id;
 if updated_notes is distinct from (case when coalesce(a.notes,'')='' then btrim(p_note) else a.notes || chr(10) || btrim(p_note) end)
 then raise exception 'activity_notes_verification_failed'; end if;
 insert into public.scheduling_activity_note_audit(activity_id,request_id,actor_id,note_text,previous_notes,resulting_version)
 values(p_activity_id,p_request_id,auth.uid(),btrim(p_note),a.notes,md5(updated_notes));
 result:=public.scheduling_agent_team_read_activity_notes(p_activity_id);
 return result || jsonb_build_object('saved',true,'alreadyApplied',false,'requestId',p_request_id,'savedNotesVersion',md5(updated_notes),'assignmentChanged',false);
end $$;
revoke all on function public.scheduling_agent_team_read_activity_notes(text),public.scheduling_agent_team_append_activity_note(text,text,text,uuid) from public,anon;
grant execute on function public.scheduling_agent_team_read_activity_notes(text),public.scheduling_agent_team_append_activity_note(text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
