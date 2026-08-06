BEGIN;

DO $$
DECLARE
  target_keys CONSTANT text[] := ARRAY['6089', '57651', '9545', '53828', '53819', '46091', '3604', '52279'];
  target_key text;
  matching_count integer;
BEGIN
  FOREACH target_key IN ARRAY target_keys LOOP
    SELECT count(*)
      INTO matching_count
      FROM public.proposal_activity_pricing
     WHERE pricing_key = target_key
       AND COALESCE(is_active, true) = true;

    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one active pricing row for %, found %', target_key, matching_count;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.proposal_activity_pricing
       WHERE pricing_key = target_key
         AND activity_no = target_key
         AND gefen_number = target_key
         AND proposal_display_mode = 'single'
         AND is_bundle_parent = false
         AND COALESCE(is_active, true) = true
    ) THEN
      RAISE EXCEPTION 'Pricing identifiers or single/bundle flags do not match for %', target_key;
    END IF;
  END LOOP;
END $$;

WITH target(pricing_key, meetings_count, hours_count, hourly_price, unit_price) AS (
  VALUES
    ('6089',  11::numeric, 16.5::numeric, 600::numeric,  9900::numeric),
    ('57651', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
    ('9545',   8::numeric, 12.5::numeric, 640::numeric,  8000::numeric),
    ('53828', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
    ('53819', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
    ('46091', 14::numeric,   21::numeric, 571::numeric, 12000::numeric),
    ('3604',  14::numeric,   21::numeric, 571::numeric, 12000::numeric),
    ('52279', 14::numeric,   21::numeric, 643::numeric, 13500::numeric)
)
UPDATE public.proposal_activity_pricing AS pricing
   SET meetings_count = target.meetings_count,
       hours_count = target.hours_count,
       hourly_price = target.hourly_price,
       unit_price = target.unit_price
  FROM target
 WHERE pricing.pricing_key = target.pricing_key
   AND pricing.activity_no = target.pricing_key
   AND pricing.gefen_number = target.pricing_key
   AND pricing.proposal_display_mode = 'single'
   AND pricing.is_bundle_parent = false
   AND COALESCE(pricing.is_active, true) = true;

UPDATE public.catalog_program_details
   SET scope = '11 מפגשים'
 WHERE activity_no = '6089'
   AND gefen_number = '6089'
   AND scope IS DISTINCT FROM '11 מפגשים';

UPDATE public.catalog_program_details
   SET scope = '10 מפגשים',
       final_outcome = 'פוסטר חקר טכנולוגי, פרזנטציה והצגת הפתרון.',
       program_flow = 'לומדים בגישת PBL ולמידת חקר: חוקרים טכנולוגיות חלל, מזהים צורך, מאפיינים ומתכננים פתרון, מכינים פוסטר חקר טכנולוגי ומציגים אותו בפרזנטציה.',
       goals = 'תוכנית טכנולוגיות החלל מובילה את התלמידים למסע חקר בעולמות החלל, המדע והחדשנות הטכנולוגית. הלמידה מבוססת על PBL, למידת חקר והעברה טכנולוגית: המשתתפים מכירים את תנאי החלל, בוחנים טכנולוגיות שפותחו למשימות חלל, מזהים יישומים בחיי היומיום ומפתחים רעיון חדש בהשראתם. התהליך כולל חקר בעיה וצורך, הגדרת קהל יעד, אפיון פתרון, תכנון טכנולוגי, הכנת פוסטר חקר טכנולוגי ותרגול פרזנטציה. כך התלמידים מחברים בין ידע מדעי, חשיבה הנדסית ויזמות ומפתחים אוריינות טכנולוגית ויכולת לתרגם ידע מתקדם לרעיון בעל ערך.'
 WHERE activity_no = '57651'
   AND gefen_number = '57651';

UPDATE public.catalog_program_details
   SET scope = '14 מפגשים'
 WHERE activity_no = '3604'
   AND gefen_number = '3604'
   AND scope IS DISTINCT FROM '14 מפגשים';

UPDATE public.catalog_program_details
   SET scope = '14 מפגשים'
 WHERE activity_no = '52279'
   AND gefen_number = '52279'
   AND scope IS DISTINCT FROM '14 מפגשים';

UPDATE public.catalog_program_details
   SET gefen_number = '53828'
 WHERE activity_no = '53828'
   AND gefen_number = '82835';

DO $$
DECLARE
  invalid_count integer;
BEGIN
  WITH target(pricing_key, meetings_count, hours_count, hourly_price, unit_price) AS (
    VALUES
      ('6089',  11::numeric, 16.5::numeric, 600::numeric,  9900::numeric),
      ('57651', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
      ('9545',   8::numeric, 12.5::numeric, 640::numeric,  8000::numeric),
      ('53828', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
      ('53819', 10::numeric,   15::numeric, 633::numeric,  9500::numeric),
      ('46091', 14::numeric,   21::numeric, 571::numeric, 12000::numeric),
      ('3604',  14::numeric,   21::numeric, 571::numeric, 12000::numeric),
      ('52279', 14::numeric,   21::numeric, 643::numeric, 13500::numeric)
  )
  SELECT count(*)
    INTO invalid_count
    FROM target
    LEFT JOIN public.proposal_activity_pricing AS pricing
      ON pricing.pricing_key = target.pricing_key
     AND pricing.activity_no = target.pricing_key
     AND pricing.gefen_number = target.pricing_key
     AND pricing.proposal_display_mode = 'single'
     AND pricing.is_bundle_parent = false
     AND COALESCE(pricing.is_active, true) = true
   WHERE pricing.pricing_key IS NULL
      OR pricing.meetings_count IS DISTINCT FROM target.meetings_count
      OR pricing.hours_count IS DISTINCT FROM target.hours_count
      OR pricing.hourly_price IS DISTINCT FROM target.hourly_price
      OR pricing.unit_price IS DISTINCT FROM target.unit_price;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'Pricing verification failed for % target rows', invalid_count;
  END IF;
END $$;

COMMIT;
