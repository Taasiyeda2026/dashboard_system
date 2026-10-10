-- Expose an optional Arabic wording alongside the Hebrew wording for digital feedback.
-- Does not affect PDFs, answer IDs, historic submissions, or the active template version.
do $migration$
declare
  function_sql text;
  old_piece text := '''text'', replace(tq.wording->>''default'', ''{topic}'', v_program.topic),';
  new_piece text := '''text'', replace(tq.wording->>''default'', ''{topic}'', v_program.topic),
        ''text_ar'', nullif(replace(coalesce(tq.wording->>''ar'', ''''), ''{topic}'', v_program.topic), ''''),';
begin
  select pg_get_functiondef(p.oid) into function_sql
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='feedback_public_get'
    and pg_get_function_identity_arguments(p.oid) = 'p_token text';

  if function_sql is null then
    raise exception 'feedback_public_get(p_token text) not found';
  end if;
  if position('''text_ar''' in function_sql) > 0 then
    return;
  end if;
  if position(old_piece in function_sql) = 0 then
    raise exception 'unexpected feedback_public_get definition; migration refused';
  end if;
  execute replace(function_sql, old_piece, new_piece);
end
$migration$;