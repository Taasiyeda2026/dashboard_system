function isTruthy_(value) {
  return value === true || value === 'TRUE' || value === 'yes' || value === 1 || value === '1';
}

function authenticate_(userId, entryCode) {
  if (!entryCode) return null;

  var rows = getRows_('permissions');
  var user = rows.find(function (row) {
    var byCode = String(row.entry_code).trim() === String(entryCode).trim();
    var byId = userId ? String(row.user_id).trim() === String(userId).trim() : true;
    return byCode && byId && isTruthy_(row.active);
  });

  return user || null;
}

function requirePerm_(user, permName) {
  if (!isTruthy_(user[permName])) {
    throw new Error('Missing permission: ' + permName);
  }
}
