-- Extend ensure_contact_school_from_proposal with school catalog linkage.
-- Backward compatible: existing 11 text arguments remain; new args are optional.

DROP FUNCTION IF EXISTS public.ensure_contact_school_from_proposal(
  text, text, text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.ensure_contact_school_from_proposal(
  p_client_type   text,
  p_client_name   text,
  p_authority     text,
  p_school        text DEFAULT NULL,
  p_contact_name  text DEFAULT NULL,
  p_contact_role  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_mobile        text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_school_id     uuid DEFAULT NULL,
  p_authority_id  uuid DEFAULT NULL,
  p_semel_mosad   text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_client_type   text;
  v_client_name   text;
  v_authority     text;
  v_school        text;
  v_contact_name  text;
  v_contact_role  text;
  v_phone         text;
  v_mobile        text;
  v_email         text;
  v_address       text;
  v_notes         text;

  v_school_id     uuid;
  v_authority_id  uuid;
  v_semel_mosad   text;

  v_match_count   integer;
  v_existing_id   bigint;
BEGIN
  v_client_type := lower(nullif(btrim(coalesce(p_client_type, '')), ''));
  v_client_name := nullif(btrim(coalesce(p_client_name, '')), '');
  v_authority := nullif(btrim(coalesce(p_authority, '')), '');
  v_school := nullif(btrim(coalesce(p_school, '')), '');
  v_contact_name := coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), '');
  v_contact_role := nullif(btrim(coalesce(p_contact_role, '')), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_mobile := nullif(btrim(coalesce(p_mobile, '')), '');
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  v_address := nullif(btrim(coalesce(p_address, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  IF v_authority IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_client_type IS NULL OR v_client_type NOT IN ('school', 'authority', 'other') THEN
    v_client_type := CASE
      WHEN v_school IS NOT NULL AND v_school IS DISTINCT FROM v_authority THEN 'school'
      ELSE 'authority'
    END;
  END IF;

  IF v_client_name IS NULL THEN
    v_client_name := CASE
      WHEN v_client_type = 'school' THEN coalesce(v_school, v_authority)
      ELSE v_authority
    END;
  END IF;

  IF v_client_type = 'authority' THEN
    v_school := NULL;
  ELSIF v_client_type = 'school' AND v_school IS NULL THEN
    v_school := v_client_name;
  END IF;

  v_school_id := p_school_id;
  v_authority_id := p_authority_id;
  v_semel_mosad := nullif(btrim(coalesce(p_semel_mosad, '')), '');

  IF p_school_id IS NOT NULL THEN
    SELECT
      s.id,
      coalesce(s.authority_id, p_authority_id),
      coalesce(nullif(btrim(coalesce(s.semel_mosad, '')), ''), nullif(btrim(coalesce(p_semel_mosad, '')), ''))
    INTO v_school_id, v_authority_id, v_semel_mosad
    FROM public.schools s
    WHERE s.id = p_school_id
      AND coalesce(lower(btrim(coalesce(s.active::text, 'yes'))), 'yes') NOT IN ('no', '0', 'false')
    LIMIT 1;

    IF NOT FOUND THEN
      v_school_id := p_school_id;
      v_authority_id := coalesce(p_authority_id, v_authority_id);
      v_semel_mosad := coalesce(nullif(btrim(coalesce(p_semel_mosad, '')), ''), v_semel_mosad);
    END IF;
  ELSIF v_client_type = 'school' AND v_school IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_match_count
    FROM public.schools s
    LEFT JOIN public.authorities a ON a.id = s.authority_id
    WHERE lower(btrim(coalesce(s.school_name, ''))) = lower(v_school)
      AND (
        lower(btrim(coalesce(s.authority, ''))) = lower(v_authority)
        OR lower(btrim(coalesce(a.authority_name, ''))) = lower(v_authority)
      )
      AND coalesce(lower(btrim(coalesce(s.active::text, 'yes'))), 'yes') NOT IN ('no', '0', 'false');

    IF v_match_count = 1 THEN
      SELECT
        s.id,
        coalesce(s.authority_id, p_authority_id),
        coalesce(nullif(btrim(coalesce(s.semel_mosad, '')), ''), nullif(btrim(coalesce(p_semel_mosad, '')), ''))
      INTO v_school_id, v_authority_id, v_semel_mosad
      FROM public.schools s
      LEFT JOIN public.authorities a ON a.id = s.authority_id
      WHERE lower(btrim(coalesce(s.school_name, ''))) = lower(v_school)
        AND (
          lower(btrim(coalesce(s.authority, ''))) = lower(v_authority)
          OR lower(btrim(coalesce(a.authority_name, ''))) = lower(v_authority)
        )
        AND coalesce(lower(btrim(coalesce(s.active::text, 'yes'))), 'yes') NOT IN ('no', '0', 'false')
      LIMIT 1;
    END IF;
  END IF;

  IF v_authority_id IS NULL AND p_authority_id IS NOT NULL THEN
    v_authority_id := p_authority_id;
  END IF;

  IF v_semel_mosad IS NULL AND p_semel_mosad IS NOT NULL THEN
    v_semel_mosad := nullif(btrim(coalesce(p_semel_mosad, '')), '');
  END IF;

  IF v_school_id IS NOT NULL THEN
    UPDATE public.contacts_schools cs
    SET
      school_id = v_school_id,
      authority_id = coalesce(v_authority_id, cs.authority_id),
      semel_mosad = coalesce(v_semel_mosad, cs.semel_mosad)
    WHERE (
      cs.school_id = v_school_id
      OR (
        cs.school_id IS NULL
        AND v_school IS NOT NULL
        AND lower(btrim(coalesce(cs.school, ''))) = lower(v_school)
        AND lower(btrim(coalesce(cs.authority, ''))) = lower(v_authority)
      )
    )
    AND coalesce(nullif(btrim(coalesce(cs.contact_name, '')), ''), '') = v_contact_name;
  END IF;

  SELECT cs.id
    INTO v_existing_id
  FROM public.contacts_schools cs
  WHERE lower(btrim(coalesce(cs.authority, ''))) = lower(v_authority)
    AND coalesce(nullif(btrim(coalesce(cs.school, '')), ''), '') = coalesce(v_school, '')
    AND coalesce(nullif(btrim(coalesce(cs.contact_name, '')), ''), '') = v_contact_name
  ORDER BY cs.id
  LIMIT 1;

  IF v_existing_id IS NULL AND v_school_id IS NOT NULL AND v_client_type = 'school' THEN
    SELECT cs.id
      INTO v_existing_id
    FROM public.contacts_schools cs
    WHERE cs.school_id = v_school_id
      AND coalesce(nullif(btrim(coalesce(cs.contact_name, '')), ''), '') = v_contact_name
    ORDER BY cs.id
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.contacts_schools
    SET
      client_type = v_client_type,
      client_name = coalesce(v_client_name, client_name),
      authority = v_authority,
      school = coalesce(v_school, ''),
      authority_id = coalesce(v_authority_id, authority_id),
      school_id = CASE WHEN v_client_type = 'school' THEN coalesce(v_school_id, school_id) ELSE NULL END,
      semel_mosad = CASE WHEN v_client_type = 'school' THEN coalesce(v_semel_mosad, semel_mosad) ELSE semel_mosad END,
      contact_role = coalesce(v_contact_role, contact_role),
      phone = coalesce(v_phone, phone),
      mobile = coalesce(v_mobile, mobile),
      email = coalesce(v_email, email),
      address = coalesce(v_address, address),
      notes = coalesce(v_notes, notes),
      active = coalesce(active, 'פעיל')
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  INSERT INTO public.contacts_schools (
    client_type,
    client_name,
    authority,
    school,
    contact_name,
    contact_role,
    phone,
    mobile,
    email,
    address,
    notes,
    authority_id,
    school_id,
    semel_mosad,
    active
  ) VALUES (
    v_client_type,
    v_client_name,
    v_authority,
    coalesce(v_school, ''),
    v_contact_name,
    coalesce(v_contact_role, ''),
    coalesce(v_phone, ''),
    coalesce(v_mobile, ''),
    coalesce(v_email, ''),
    coalesce(v_address, ''),
    coalesce(v_notes, ''),
    v_authority_id,
    CASE WHEN v_client_type = 'school' THEN v_school_id ELSE NULL END,
    CASE WHEN v_client_type = 'school' THEN v_semel_mosad ELSE NULL END,
    'פעיל'
  )
  ON CONFLICT ON CONSTRAINT contacts_schools_authority_school_contact_name_key
  DO UPDATE SET
    client_type = EXCLUDED.client_type,
    client_name = EXCLUDED.client_name,
    authority_id = coalesce(EXCLUDED.authority_id, contacts_schools.authority_id),
    school_id = coalesce(EXCLUDED.school_id, contacts_schools.school_id),
    semel_mosad = coalesce(EXCLUDED.semel_mosad, contacts_schools.semel_mosad),
    contact_role = coalesce(nullif(EXCLUDED.contact_role, ''), contacts_schools.contact_role),
    phone = coalesce(nullif(EXCLUDED.phone, ''), contacts_schools.phone),
    mobile = coalesce(nullif(EXCLUDED.mobile, ''), contacts_schools.mobile),
    email = coalesce(nullif(EXCLUDED.email, ''), contacts_schools.email),
    address = coalesce(nullif(EXCLUDED.address, ''), contacts_schools.address),
    notes = coalesce(nullif(EXCLUDED.notes, ''), contacts_schools.notes),
    active = coalesce(contacts_schools.active, 'פעיל')
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ensure_contact_school_from_proposal(
  text, text, text, text, text, text, text, text, text, text, text, uuid, uuid, text
) TO authenticated;

-- Acceptance check (run after deploy):
-- select
--   p.oid::regprocedure::text as signature,
--   pg_get_function_arguments(p.oid) as arguments
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname = 'ensure_contact_school_from_proposal';
