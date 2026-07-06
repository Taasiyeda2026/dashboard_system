-- Rename any old program names to the canonical final name:
-- "אופק יזמות פרימיום לתעשייה" (gefen 52279)
--
-- Affected tables: proposal_activity_pricing, catalog_program_details,
--                  lists, proposal_activity_pricing_aliases
--
-- Rules:
--   • "אופק לתעשייה"        → "אופק יזמות פרימיום לתעשייה"
--   • "יזמות פרימיום"       (standalone, not – חברה suffix) → same
--   • "אופק יזמות לתעשייה" → same
--   • activity_no/gefen "960" for this program → "52279" where safe
--   • Any duplicate row with old name + 52279 → mark inactive (52279_old)
--
-- Safe to run multiple times (idempotent WHERE conditions).

-- ── proposal_activity_pricing ─────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'proposal_activity_pricing'
  ) THEN

    UPDATE public.proposal_activity_pricing
    SET activity_name = 'אופק יזמות פרימיום לתעשייה'
    WHERE activity_name IN (
      'אופק לתעשייה',
      'יזמות פרימיום',
      'אופק יזמות לתעשייה'
    )
    AND (activity_no IS NULL OR activity_no IN ('52279','960',''));

  END IF;
END $$;

-- ── catalog_program_details ───────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'catalog_program_details'
  ) THEN

    -- Rename old active rows
    UPDATE public.catalog_program_details
    SET
      title       = 'אופק יזמות פרימיום לתעשייה',
      catalog_title = CASE
        WHEN catalog_title IN ('אופק לתעשייה','יזמות פרימיום','אופק יזמות לתעשייה')
        THEN 'אופק יזמות פרימיום לתעשייה'
        ELSE catalog_title
      END
    WHERE title IN (
      'אופק לתעשייה',
      'יזמות פרימיום',
      'אופק יזמות לתעשייה'
    )
    AND COALESCE(is_active, TRUE) = TRUE;

    -- Deactivate stale duplicate rows (same gefen, old name still around)
    UPDATE public.catalog_program_details
    SET
      is_active = FALSE,
      title     = title || ' (לא פעיל)'
    WHERE title = 'אופק לתעשייה'
    AND is_active = FALSE;

  END IF;
END $$;

-- ── lists (dropdown values visible to users) ──────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lists'
  ) THEN

    UPDATE public.lists
    SET label = 'אופק יזמות פרימיום לתעשייה'
    WHERE label IN (
      'אופק לתעשייה',
      'יזמות פרימיום',
      'אופק יזמות לתעשייה'
    );

    -- also update label_he / value if those columns exist
    UPDATE public.lists
    SET label_he = 'אופק יזמות פרימיום לתעשייה'
    WHERE label_he IN (
      'אופק לתעשייה',
      'יזמות פרימיום',
      'אופק יזמות לתעשייה'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'lists' AND column_name = 'label_he'
    );

  END IF;
END $$;

-- ── proposal_activity_pricing_aliases ─────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'proposal_activity_pricing_aliases'
  ) THEN

    UPDATE public.proposal_activity_pricing_aliases
    SET alias_name = 'אופק יזמות פרימיום לתעשייה'
    WHERE alias_name IN (
      'אופק לתעשייה',
      'יזמות פרימיום',
      'אופק יזמות לתעשייה'
    );

  END IF;
END $$;

-- ── Verify after running ──────────────────────────────────────────────────────
-- SELECT 'proposal_activity_pricing' AS tbl, activity_name AS name, activity_no
-- FROM public.proposal_activity_pricing
-- WHERE activity_name ILIKE '%אופק%' OR activity_name ILIKE '%יזמות%'
-- UNION ALL
-- SELECT 'catalog_program_details', title, NULL
-- FROM public.catalog_program_details
-- WHERE title ILIKE '%אופק%' OR title ILIKE '%יזמות%'
-- UNION ALL
-- SELECT 'lists', label, NULL
-- FROM public.lists
-- WHERE label ILIKE '%אופק%' OR label ILIKE '%יזמות%'
-- ORDER BY 1, 2;
