-- One-time approved replacement of legacy kit-holder records ONLY.
-- This intentionally does not touch stock rows, especially the 4 active
-- "ביומימיקרי חדר בריחה" kits: warehouse=0, hila=1, idan=1, gil=2.
-- Source stockroom and historical handover dates for newly reported holdings
-- are unknown; record NULL and 'unrecorded' rather than inventing information.
create temporary table pg_temp.print_kit_expected_20261015 (
  course_id uuid not null,
  instructor_name text not null,
  primary key(course_id, instructor_name)
) on commit drop;
insert into pg_temp.print_kit_expected_20261015(course_id, instructor_name)
values
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'יארא שחאדה'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'יארא שחאדה'),
  ('92eeecbe-c32a-4e3f-b2fe-6809803618c2'::uuid, 'יארא שחאדה'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'למיס בשר'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'למיס בשר'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'אימאן חטיב'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'אימאן חטיב'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'מינאס אבו חמיד'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'מינאס אבו חמיד'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'שיר דר לב'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'שיר דר לב'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'רינת דהן'),
  ('92eeecbe-c32a-4e3f-b2fe-6809803618c2'::uuid, 'רינת דהן'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'הנאא אבו אמנה'),
  ('de3f31e5-29aa-4ae4-b979-ef364e1e8266'::uuid, 'הנאא אבו אמנה'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'אילנה טיטייבסקי'),
  ('de3f31e5-29aa-4ae4-b979-ef364e1e8266'::uuid, 'אילנה טיטייבסקי'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'אלעד אליה'),
  ('de3f31e5-29aa-4ae4-b979-ef364e1e8266'::uuid, 'אלעד אליה'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'מוחמד סוילם'),
  ('760299a3-99c2-4014-902d-e23de4f4c209'::uuid, 'כרמית סמנדרוב'),
  ('92eeecbe-c32a-4e3f-b2fe-6809803618c2'::uuid, 'כרמית סמנדרוב'),
  ('909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid, 'כרמית סמנדרוב');

do $validation$
declare
 v integer;
begin
 select count(*) into v from pg_temp.print_kit_expected_20261015;
 if v<>23 then raise exception 'Wrong new kit count %, expected 23',v; end if;
 select count(*) into v from public.course_print_kit_distributions;
 if v<>39 then raise exception 'Legacy source differs from expected 39 rows: %',v; end if;
 select count(*) into v from private.course_print_kit_replacement_audit
 where replacement_key='new-print-kits-2026-10-15';
 if v<>0 then raise exception 'Print kit replacement already recorded'; end if;
 select count(*) into v
 from pg_temp.print_kit_expected_20261015 expected
 left join public.contacts_instructors instructor on instructor.full_name=expected.instructor_name and instructor.active='yes'
 left join public.proposal_gefen_courses course on course.id=expected.course_id and course.requires_print_kit=true
 where instructor.emp_id is null or course.id is null;
 if v<>0 then raise exception 'Missing active instructor or printable course for % kits',v; end if;
 select count(*) into v from public.course_print_kit_inventory stock
 join public.proposal_gefen_courses c on c.id=stock.course_id
 where c.short_name='ביומימיקרי חדר בריחה'
   and stock.warehouse_quantity=0 and stock.hila_quantity=1
   and stock.idan_quantity=1 and stock.gil_quantity=2;
 if v<>1 then raise exception 'Escape-room stock differs: abort replacement'; end if;
 select count(*) into v from pg_temp.print_kit_expected_20261015
 where course_id='909ec13b-dae8-4c19-b2f1-61a4ca25cf9c'::uuid;
 if v<>10 then raise exception 'Incorrect biomimicry quantity %', v; end if;
 select count(*) into v from pg_temp.print_kit_expected_20261015
 where course_id='760299a3-99c2-4014-902d-e23de4f4c209'::uuid;
 if v<>7 then raise exception 'Incorrect space quantity %', v; end if;
 select count(*) into v from pg_temp.print_kit_expected_20261015
 where course_id='de3f31e5-29aa-4ae4-b979-ef364e1e8266'::uuid;
 if v<>3 then raise exception 'Incorrect AI quantity %', v; end if;
 select count(*) into v from pg_temp.print_kit_expected_20261015
 where course_id='92eeecbe-c32a-4e3f-b2fe-6809803618c2'::uuid;
 if v<>3 then raise exception 'Incorrect trailblazers quantity %', v; end if;
end
$validation$;

insert into private.course_print_kit_replacement_audit(
 replacement_key, reason, old_distributions, old_inventory, new_distributions)
select
 'new-print-kits-2026-10-15',
 'User confirmed replacement of 39 legacy holdings with 23 newly received; biomimicry escape-room 4-kit stock explicitly preserved',
 (select coalesce(jsonb_agg(to_jsonb(old) order by old.instructor_name,old.course_id), '[]'::jsonb)
   from public.course_print_kit_distributions old),
 (select coalesce(jsonb_agg(to_jsonb(stock) order by stock.course_id), '[]'::jsonb)
   from public.course_print_kit_inventory stock),
 '[]'::jsonb;

delete from public.course_print_kit_distributions;
insert into public.course_print_kit_distributions
 (course_id,instructor_name,source_location,delivered_at)
select course_id,instructor_name,'unrecorded',null
from pg_temp.print_kit_expected_20261015
order by instructor_name,course_id;

update private.course_print_kit_replacement_audit
set new_distributions=(
  select coalesce(jsonb_agg(to_jsonb(x) order by x.instructor_name,x.course_id), '[]'::jsonb)
  from public.course_print_kit_distributions x)
where replacement_key='new-print-kits-2026-10-15';

do $final$
declare v integer;
begin
 select count(*) into v from public.course_print_kit_distributions;
 if v<>23 then raise exception 'Final quantity mismatch: %',v; end if;
 select count(*) into v from public.course_print_kit_inventory stock
 join public.proposal_gefen_courses c on c.id=stock.course_id
 where c.short_name='ביומימיקרי חדר בריחה'
   and stock.warehouse_quantity=0 and stock.hila_quantity=1
   and stock.idan_quantity=1 and stock.gil_quantity=2;
 if v<>1 then raise exception 'Escape-room kits must be preserved'; end if;
end
$final$;
