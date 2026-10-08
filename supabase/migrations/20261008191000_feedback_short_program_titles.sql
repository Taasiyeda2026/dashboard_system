-- Use short course names throughout the impact-feedback module.
-- Mapping stays keyed by stable feedback program keys; only display titles change.

with short_names(program_key, short_title) as (
  values
    ('biomimicry', 'ביומימיקרי'),
    ('green_leadership', 'מנהיגות ירוקה'),
    ('space_tech', 'טכנולוגיות החלל'),
    ('ai_applications', 'יישומי AI'),
    ('pharma', 'רוקחים עולם'),
    ('ofek', 'אופק פרימיום'),
    ('ai_foundations', 'סודות ויסודות AI'),
    ('trailblazers', 'פורצות דרך')
)
update public.feedback_programs p
set title = s.short_title
from short_names s
where p.key = s.program_key
  and p.title is distinct from s.short_title;

-- Keep template titles consistent with the shorter program display names.
update public.feedback_templates t
set title = p.title || ' – ' ||
  case
    when t.audience = 'student' and t.stage = 'pre' then 'תלמידים – פתיחה'
    when t.audience = 'student' and t.stage = 'post' then 'תלמידים – סיום'
    when t.audience = 'educational_staff' and t.stage = 'final' then 'צוות חינוכי'
    when t.audience = 'instructor' and t.stage = 'pre' then 'מדריך – פתיחה'
    when t.audience = 'instructor' and t.stage = 'final' then 'מדריך – סיום'
    else t.title
  end,
  updated_at = now()
from public.feedback_programs p
where p.key = t.program_key;

notify pgrst, 'reload schema';
