-- Fix payment terms wording: "התשלום עבור הקורס יחולק" → "התשלום יבוצע"
-- Applies to next_year and combined templates only.

UPDATE public.proposal_template_sections
SET section_body = replace(
  section_body,
  'התשלום עבור הקורס יחולק לשני חלקים:',
  'התשלום יבוצע בשני חלקים:'
)
WHERE template_key IN ('next_year', 'combined')
  AND section_key = 'payment_terms'
  AND section_body LIKE '%התשלום עבור הקורס יחולק לשני חלקים:%';

UPDATE public.proposal_template_sections
SET section_body = replace(
  section_body,
  'עבור קורס, התשלום יחולק לשני חלקים:',
  'עבור קורס, התשלום יבוצע בשני חלקים:'
)
WHERE template_key = 'combined'
  AND section_key = 'payment_terms'
  AND section_body LIKE '%עבור קורס, התשלום יחולק לשני חלקים:%';
