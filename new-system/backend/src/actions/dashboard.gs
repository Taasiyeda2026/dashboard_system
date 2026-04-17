function actionGetDashboard_(request, user) {
  requirePerm_(user, 'view_dashboard');

  var shortRows = getRows_('data_short');
  var longRows = getRows_('data_long');
  var instructors = getRows_('contacts_instructors').filter(function (row) {
    return isTruthy_(row.active);
  });

  var today = new Date();
  var month = today.getMonth();
  var year = today.getFullYear();

  var endings = longRows.filter(function (row) {
    var d = new Date(row.end_date);
    return !isNaN(d) && d.getMonth() === month && d.getFullYear() === year;
  }).length;

  var byManagerMap = {};
  shortRows.concat(longRows).forEach(function (row) {
    var manager = row.activity_manager || '—';
    if (!byManagerMap[manager]) {
      byManagerMap[manager] = { manager: manager, total_short: 0, total_long: 0 };
    }

    if (String(row.RowID || '').indexOf('SHORT-') === 0) byManagerMap[manager].total_short += 1;
    if (String(row.RowID || '').indexOf('LONG-') === 0) byManagerMap[manager].total_long += 1;
  });

  return {
    dashboard: {
      total_short: shortRows.length,
      total_long: longRows.length,
      total_instructors: instructors.length,
      total_course_endings_this_month: endings,
      by_manager: Object.keys(byManagerMap).map(function (key) { return byManagerMap[key]; })
    }
  };
}
