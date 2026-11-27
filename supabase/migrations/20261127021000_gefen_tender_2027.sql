create table public.gefen_tender_2027 (
  id text primary key,
  kind text not null check (kind in ('administrative','program','operator')),
  title text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.gefen_tender_2027 enable row level security;
revoke all on public.gefen_tender_2027 from anon, authenticated;
grant select, insert, update on public.gefen_tender_2027 to authenticated;
grant all on public.gefen_tender_2027 to service_role;
create policy gefen_tender_admin_read on public.gefen_tender_2027 for select to authenticated using ((select public.app_current_role())='admin');
create policy gefen_tender_admin_insert on public.gefen_tender_2027 for insert to authenticated with check ((select public.app_current_role())='admin');
create policy gefen_tender_admin_update on public.gefen_tender_2027 for update to authenticated using ((select public.app_current_role())='admin') with check ((select public.app_current_role())='admin');
insert into public.gefen_tender_2027(id,kind,title,payload) values
('admin','administrative','הגשה מנהלית','{}'::jsonb),
('p-new-app','program','MIT App Inventor','{"number":null,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-new-arduino','program','Arduino','{"number":null,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-new-microbit','program','micro-bit','{"number":null,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-new-scratch','program','Scratch (סקראץ׳)','{"number":null,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-new-photonics','program','פוטוניקה (Photonics)','{"number":null,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-67867','program','מנהיגות ירוקה','{"number":67867,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-67861','program','פורצות דרך','{"number":67861,"associations":[{"code":112,"status":"תוכנית חדשה","validity":""}]}'::jsonb),
('p-13990','program','התנסות בתעשייה','{"number":13990,"associations":[{"code":114,"status":"חידוש / תוכנית חדשה","validity":"תשפ״ז"},{"code":112,"status":"חידוש / תוכנית חדשה","validity":"תשפ״ז"}]}'::jsonb),
('p-46091','program','רוקחים עולם - יזמות לעולם הפרמצבטיקה','{"number":46091,"associations":[{"code":112,"status":"חידוש / תוכנית חדשה","validity":"תשפ״ז"}]}'::jsonb),
('p-960','program','קורס יזמות פרימיום','{"number":960,"associations":[{"code":112,"status":"חידוש / תוכנית חדשה","validity":"תשפ״ו"}]}'::jsonb),
('p-27342','program','הקורס לפיתוח ופיצוח משחקי לוח','{"number":27342,"associations":[{"code":106,"status":"חידוש / תוכנית חדשה","validity":"תשפ״ו"}]}'::jsonb),
('p-9545','program','סודות (ויסודות) הבינה המלאכותית','{"number":9545,"associations":[{"code":706,"status":"להגיש","validity":""},{"code":112,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-53819','program','יישומי AI ברפואה ובחקלאות','{"number":53819,"associations":[{"code":706,"status":"להגיש","validity":""},{"code":112,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-53828','program','ביומימיקרי - לחטיבות','{"number":53828,"associations":[{"code":706,"status":"להגיש","validity":""},{"code":112,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-57646','program','השמיים אינם הגבול','{"number":57646,"associations":[{"code":706,"status":"להגיש","validity":""},{"code":112,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-6089','program','יזמות ביומימיקרי (יסודי)','{"number":6089,"associations":[{"code":706,"status":"להגיש","validity":""},{"code":112,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-52279','program','אופק לתעשייה','{"number":52279,"associations":[{"code":112,"status":"בתוקף","validity":"תשפ״ח"},{"code":114,"status":"בתוקף","validity":"תשפ״ח"}]}'::jsonb),
('p-57651','program','טכנולוגיות החלל','{"number":57651,"associations":[{"code":112,"status":"בתוקף","validity":"תשפ״ח"},{"code":706,"status":"בתוקף","validity":"תשפ״ט"}]}'::jsonb),
('o-1','operator','אביגדור שרון','{"folder":"אביגדור שרון","training_hours":null}'::jsonb),
('o-2','operator','אילנה טיטייבסקי','{"folder":"אילנה טיטייבסקי","training_hours":100}'::jsonb),
('o-3','operator','אימאן חטיב','{"folder":"אימאן חטיב","training_hours":null}'::jsonb),
('o-4','operator','אלדר מיכאל טייב','{"folder":"אלדר מיכאל טייב","training_hours":100}'::jsonb),
('o-5','operator','אלין סאלח','{"folder":"אלין סאלח","training_hours":null}'::jsonb),
('o-6','operator','אלכס זפקה','{"folder":"אלכס זפקה","training_hours":null}'::jsonb),
('o-7','operator','אלעד אליה','{"folder":"אלעד אליה","training_hours":null}'::jsonb),
('o-8','operator','אפרת אוחיון','{"folder":"אפרת אוחיון","training_hours":100}'::jsonb),
('o-9','operator','הנאא אבו אמנה','{"folder":"הנאא אבו אמנה","training_hours":null}'::jsonb),
('o-10','operator','יארא שחאדה','{"folder":"יארא שחאדה","training_hours":100}'::jsonb),
('o-11','operator','למיס בשר','{"folder":"למיס בשר","training_hours":null}'::jsonb),
('o-12','operator','שיר דר לב','{"folder":"שיר דר לב","training_hours":null}'::jsonb),
('o-13','operator','הילה רוזן','{"folder":"הילה רוזן","training_hours":100}'::jsonb),
('o-14','operator','לירון נחום','{"folder":"לירון נחום","training_hours":100}'::jsonb)
on conflict (id) do nothing;
