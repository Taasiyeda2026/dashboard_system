function actionGetActivities_(request, user) {
  requirePerm_(user, 'view_activities');

  var shortRows = getRows_('data_short');
  var longRows = getRows_('data_long');
  var rows = shortRows.concat(longRows);

  var filters = {
    activity_type: request.activity_type,
    authority: request.authority,
    school: request.school,
    instructor_name: request.instructor_name,
    activity_manager: request.activity_manager,
    status: request.status
  };

  Object.keys(filters).forEach(function (k) {
    if (filters[k] === '' || filters[k] === undefined || filters[k] === null) return;
    rows = rows.filter(function (row) {
      return String(row[k] || '').toLowerCase() === String(filters[k]).toLowerCase();
    });
  });

  return { activities: rows };
}
