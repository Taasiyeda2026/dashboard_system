-- Manager annual-review question set v2:
-- five observable rating questions and three open management questions.

insert into public.settings(key, value, description)
values (
  'annual_review_manager_question_set_version',
  '2',
  'Manager annual-review form uses exactly eight questions: five ratings and three open questions.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

alter table public.manager_review_preparation
  drop constraint if exists manager_review_preparation_answers_object;

alter table public.manager_review_preparation
  add constraint manager_review_preparation_answers_object
  check (jsonb_typeof(answers) = 'object');

comment on column public.manager_review_preparation.answers is
  'Question-set v2 answers. Active keys: professional_quality, task_management, collaboration_communication, initiative_problem_solving, learning_feedback, achievements_strengths, improvement_lessons, managerial_support.';

comment on table public.manager_review_next_school_year is
  'Deprecated for manager input in question-set v2. Kept temporarily for backwards compatibility and historical safety.';

comment on table public.manager_review_role_lessons is
  'Deprecated for manager input in question-set v2. Kept temporarily for backwards compatibility and historical safety.';

comment on table public.manager_review_evaluations is
  'Legacy role-specific manager metrics. Not displayed in question-set v2; retained without deleting historical configuration.';
