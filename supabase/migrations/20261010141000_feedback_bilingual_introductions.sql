-- Separate Hebrew and Arabic introduction for digital questionnaires.
alter table public.feedback_template_versions
  add column if not exists intro_text_ar text;

do $migration$
declare
  function_sql text;
  old_piece text := '''intro_text'', (select intro_text from public.feedback_template_versions where id = c.template_version_id),';
  new_piece text := '''intro_text'', (select intro_text from public.feedback_template_versions where id = c.template_version_id),
    ''intro_text_ar'', (select intro_text_ar from public.feedback_template_versions where id = c.template_version_id),';
begin
  select pg_get_functiondef(p.oid) into function_sql
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='feedback_public_get';
  if function_sql is null then
    raise exception 'feedback_public_get missing';
  end if;
  if position('''intro_text_ar''' in function_sql) > 0 then return; end if;
  if position(old_piece in function_sql) = 0 then
    raise exception 'unexpected feedback_public_get definition';
  end if;
  execute replace(function_sql, old_piece, new_piece);
end
$migration$;
