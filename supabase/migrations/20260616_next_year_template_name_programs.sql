-- next_year proposal document title: "קורסי" → "תוכניות"
DO $$
BEGIN
  IF to_regclass('public.proposal_template_sections') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposal_template_sections'
      AND column_name = 'updated_at'
  ) THEN
    UPDATE public.proposal_template_sections
    SET template_name = 'הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז',
        updated_at = now()
    WHERE template_key = 'next_year';
  ELSE
    UPDATE public.proposal_template_sections
    SET template_name = 'הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז'
    WHERE template_key = 'next_year';
  END IF;
END $$;
