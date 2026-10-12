/** Paper PDF is an optional, admin-managed alternative for elementary student feedback only.
 * The digital questionnaire remains available at every school level and for every audience.
 */
export function isElementaryPaperTemplate(template, program) {
  return Boolean(
    template?.audience === 'student' &&
    (template.stage === 'pre' || template.stage === 'post') &&
    program?.education_level === 'elementary' &&
    program.key === template.program_key
  );
}
