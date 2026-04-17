function actionGetBootstrap_(request, user) {
  var requiredSheetsState = validateRequiredSheets_();
  var lists = getRows_('lists');

  return {
    user: user,
    schema: CONFIG.SHEETS,
    bootstrap: {
      required_sheets_ok: requiredSheetsState.ok,
      missing_sheets: requiredSheetsState.missing,
      activity_tabs: ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'],
      finance_status: ['open', 'closed']
    },
    lists: lists
  };
}
