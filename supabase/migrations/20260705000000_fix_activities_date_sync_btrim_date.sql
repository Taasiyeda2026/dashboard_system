-- Fix activities end-date sync function after date_1..date_35 columns became DATE.
-- The previous version used btrim(date), which fails on UPDATE with:
-- function btrim(date) does not exist

create or replace function public.activities_calculated_end_date_from_meetings(p_row public.activities)
returns text
language plpgsql
immutable
as $$
declare
  latest_date date;
begin
  select max(v)
    into latest_date
  from (
    values
      (p_row.date_1),  (p_row.date_2),  (p_row.date_3),  (p_row.date_4),  (p_row.date_5),
      (p_row.date_6),  (p_row.date_7),  (p_row.date_8),  (p_row.date_9),  (p_row.date_10),
      (p_row.date_11), (p_row.date_12), (p_row.date_13), (p_row.date_14), (p_row.date_15),
      (p_row.date_16), (p_row.date_17), (p_row.date_18), (p_row.date_19), (p_row.date_20),
      (p_row.date_21), (p_row.date_22), (p_row.date_23), (p_row.date_24), (p_row.date_25),
      (p_row.date_26), (p_row.date_27), (p_row.date_28), (p_row.date_29), (p_row.date_30),
      (p_row.date_31), (p_row.date_32), (p_row.date_33), (p_row.date_34), (p_row.date_35)
  ) as dates(v)
  where v is not null;

  return latest_date::text;
end;
$$;
