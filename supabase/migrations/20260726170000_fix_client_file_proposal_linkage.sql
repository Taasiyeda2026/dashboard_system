-- Repair legacy proposal rows that were saved without canonical authority/school IDs.
-- Keep a point-in-time backup, reconcile incorrect contact links, backfill IDs,
-- and prevent the same gap from being created again.

CREATE TABLE IF NOT EXISTS public.proposals_agreements_client_link_backup_20260726 AS
SELECT pa.*
FROM public.proposals_agreements pa
WHERE pa.contact_school_id IS NOT NULL
  AND (pa.authority_id IS NULL OR pa.school_id IS NULL);

CREATE TABLE IF NOT EXISTS public.contacts_schools_client_link_backup_20260726 AS
SELECT DISTINCT cs.*
FROM public.contacts_schools cs
JOIN public.proposals_agreements pa ON pa.contact_school_id = cs.id
WHERE pa.authority_id IS NULL
   OR pa.school_id IS NULL
   OR cs.authority_id IS NULL
   OR (cs.client_type = 'school' AND cs.school_id IS NULL);

-- Some legacy school proposals point to a duplicate contact that was mistakenly
-- classified as an authority contact. Reconnect them to the unique matching
-- school contact before copying canonical IDs into the proposal.
WITH candidate_contacts AS (
  SELECT
    pa.id AS proposal_id,
    MIN(target.id) AS target_contact_id
  FROM public.proposals_agreements pa
  JOIN public.contacts_schools linked ON linked.id = pa.contact_school_id
  JOIN public.schools s
    ON regexp_replace(lower(trim(coalesce(s.school_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
     = regexp_replace(lower(trim(coalesce(pa.school_framework, ''))), '[^[:alnum:]א-ת]+', '', 'g')
  JOIN public.contacts_schools target
    ON target.client_type = 'school'
   AND target.school_id = s.id
   AND regexp_replace(lower(trim(coalesce(target.contact_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
     = regexp_replace(lower(trim(coalesce(pa.contact_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
  WHERE linked.client_type = 'authority'
    AND pa.school_id IS NULL
    AND regexp_replace(lower(trim(coalesce(pa.school_framework, ''))), '[^[:alnum:]א-ת]+', '', 'g')
       <> regexp_replace(lower(trim(coalesce(pa.client_authority, ''))), '[^[:alnum:]א-ת]+', '', 'g')
  GROUP BY pa.id
  HAVING COUNT(DISTINCT target.id) = 1
)
UPDATE public.proposals_agreements pa
SET contact_school_id = c.target_contact_id,
    updated_at = now()
FROM candidate_contacts c
WHERE pa.id = c.proposal_id
  AND pa.contact_school_id IS DISTINCT FROM c.target_contact_id;

-- Complete canonical school metadata on referenced school contacts when the
-- normalized school name resolves to exactly one school in the master table.
WITH candidates AS (
  SELECT
    cs.id AS contact_id,
    MIN(s.id) AS school_id,
    MIN(s.authority_id) AS authority_id,
    MIN(s.semel_mosad) AS semel_mosad,
    MIN(s.school_name) AS school_name
  FROM public.contacts_schools cs
  JOIN public.proposals_agreements pa ON pa.contact_school_id = cs.id
  JOIN public.schools s
    ON regexp_replace(lower(trim(coalesce(s.school_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
     = regexp_replace(lower(trim(coalesce(nullif(cs.school, ''), cs.client_name, pa.school_framework, ''))), '[^[:alnum:]א-ת]+', '', 'g')
  WHERE cs.client_type = 'school'
    AND cs.school_id IS NULL
  GROUP BY cs.id
  HAVING COUNT(DISTINCT s.id) = 1
)
UPDATE public.contacts_schools cs
SET school_id = c.school_id,
    authority_id = coalesce(cs.authority_id, c.authority_id),
    semel_mosad = coalesce(cs.semel_mosad, c.semel_mosad),
    school = coalesce(nullif(cs.school, ''), c.school_name),
    client_name = coalesce(nullif(cs.client_name, ''), c.school_name)
FROM candidates c
WHERE cs.id = c.contact_id;

-- Complete canonical authority IDs on referenced authority/other contacts when
-- the normalized authority name resolves uniquely.
WITH candidates AS (
  SELECT
    cs.id AS contact_id,
    MIN(a.id) AS authority_id
  FROM public.contacts_schools cs
  JOIN public.proposals_agreements pa ON pa.contact_school_id = cs.id
  JOIN public.authorities a
    ON regexp_replace(lower(trim(coalesce(a.authority_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
     = regexp_replace(lower(trim(coalesce(nullif(cs.authority, ''), pa.client_authority, cs.client_name, ''))), '[^[:alnum:]א-ת]+', '', 'g')
  WHERE cs.client_type IN ('authority', 'other')
    AND cs.authority_id IS NULL
  GROUP BY cs.id
  HAVING COUNT(DISTINCT a.id) = 1
)
UPDATE public.contacts_schools cs
SET authority_id = c.authority_id
FROM candidates c
WHERE cs.id = c.contact_id;

-- Copy the canonical identity from the selected directory contact into each
-- proposal. Authority/other proposals intentionally keep school_id NULL.
UPDATE public.proposals_agreements pa
SET authority_id = coalesce(pa.authority_id, cs.authority_id),
    school_id = CASE
      WHEN cs.client_type = 'school' THEN coalesce(pa.school_id, cs.school_id)
      ELSE pa.school_id
    END,
    updated_at = now()
FROM public.contacts_schools cs
WHERE pa.contact_school_id = cs.id
  AND (
    (pa.authority_id IS NULL AND cs.authority_id IS NOT NULL)
    OR (pa.school_id IS NULL AND cs.client_type = 'school' AND cs.school_id IS NOT NULL)
  );

-- Future proposals that select a directory contact automatically inherit its
-- canonical authority and school IDs, even when written through an older path.
CREATE OR REPLACE FUNCTION public.sync_proposal_client_ids_from_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  linked_authority_id bigint;
  linked_school_id bigint;
  linked_client_type text;
BEGIN
  IF NEW.contact_school_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cs.authority_id, cs.school_id, cs.client_type
    INTO linked_authority_id, linked_school_id, linked_client_type
  FROM public.contacts_schools cs
  WHERE cs.id = NEW.contact_school_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.authority_id IS NULL THEN
    NEW.authority_id := linked_authority_id;
  END IF;

  IF NEW.school_id IS NULL AND linked_client_type = 'school' THEN
    NEW.school_id := linked_school_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_agreements_sync_client_ids ON public.proposals_agreements;
CREATE TRIGGER proposals_agreements_sync_client_ids
BEFORE INSERT OR UPDATE OF contact_school_id, authority_id, school_id
ON public.proposals_agreements
FOR EACH ROW
EXECUTE FUNCTION public.sync_proposal_client_ids_from_contact();
