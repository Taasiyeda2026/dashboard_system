-- Summer proposal: shorten school responsibility space requirement sentence.
UPDATE public.proposal_template_sections
SET section_body = replace(
  section_body,
  'העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט, ככל שנדרש לפי אופי הסדנה',
  'העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט.'
)
WHERE template_key = 'summer'
  AND section_body LIKE '%העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט, ככל שנדרש לפי אופי הסדנה%';
