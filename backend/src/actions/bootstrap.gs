function actionGetBootstrap_(request, user) {
  var requiredSheetsState = validateRequiredSheets_();
  var lists = getRows_('lists');

  var modules = CONFIG.MODULES.map(function (moduleDef) {
    var hasAccess = !moduleDef.permission || isTruthy_(user[moduleDef.permission]);
    var schema = null;

    if (moduleDef.sheet) {
      schema = getSheetSchema_(moduleDef.sheet);
    }

    return {
      id: moduleDef.id,
      title: moduleDef.title,
      type: moduleDef.type || 'sheet',
      permission: moduleDef.permission || '',
      sheet: moduleDef.sheet || '',
      sheets: moduleDef.sheets || [],
      accessible: hasAccess,
      schema: schema
    };
  });

  return {
    user: user,
    schema: CONFIG.SHEETS,
    bootstrap: {
      required_sheets_ok: requiredSheetsState.ok,
      missing_sheets: requiredSheetsState.missing,
      modules: modules
    },
    lists: lists
  };
}
