-- Use the specifically identified school, not the ambiguous locality "מסעדה".
update public.schools
set route_verified_address = 'תיכון עתיד מסעדה, מסעדה, רמת הגולן, ישראל', updated_at=now()
where id=3193 and school_name='חט"ב מסעדה'
  and (route_verified_address is null or btrim(route_verified_address)='');
