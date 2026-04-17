function findModuleById_(moduleId) {
  return CONFIG.MODULES.find(function (moduleDef) {
    return moduleDef.id === moduleId;
  });
}

function applyFilters_(rows, filters) {
  if (!filters) return rows;

  var nextRows = rows;
  Object.keys(filters).forEach(function (key) {
    var value = filters[key];
    if (value === undefined || value === null || value === '') return;

    nextRows = nextRows.filter(function (row) {
      return String(row[key] || '').toLowerCase() === String(value).toLowerCase();
    });
  });

  return nextRows;
}

function actionGetModuleData_(request, user) {
  var moduleId = String(request.module_id || '').trim();
  if (!moduleId) throw new Error('Missing module_id');

  var moduleDef = findModuleById_(moduleId);
  if (!moduleDef) throw new Error('Unknown module: ' + moduleId);

  if (moduleDef.permission) {
    requirePerm_(user, moduleDef.permission);
  }

  if (!moduleDef.sheet) {
    throw new Error('Module is not sheet-backed: ' + moduleId);
  }

  var sheetData = getSheetData_(moduleDef.sheet);
  var filters = {};

  Object.keys(request).forEach(function (key) {
    if (key.indexOf('filter_') !== 0) return;
    filters[key.replace('filter_', '')] = request[key];
  });

  return {
    module: {
      id: moduleDef.id,
      title: moduleDef.title,
      sheet: moduleDef.sheet
    },
    schema: {
      internal_headers: sheetData.internal_headers,
      display_headers: sheetData.display_headers
    },
    rows: applyFilters_(sheetData.rows, filters),
    total_rows: sheetData.rows.length,
    filtered_rows: applyFilters_(sheetData.rows, filters).length
  };
}
