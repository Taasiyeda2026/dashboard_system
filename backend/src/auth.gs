function isTruthy_(value) {
  return value === true || value === 'TRUE' || value === 'yes' || value === 1 || value === '1';
}

function normalizeAuthValue_(value) {
  return String(value || '').trim().toLowerCase();
}

function authenticate_(userId, entryCode, identifier) {
  if (!entryCode) return null;

  var normalizedIdentifier = normalizeAuthValue_(identifier);
  var normalizedUserId = normalizeAuthValue_(userId);

  var rows = getRows_('permissions');
  var user = rows.find(function (row) {
    var byCode = String(row.entry_code || '').trim() === String(entryCode || '').trim();
    var byId = normalizedUserId ? normalizeAuthValue_(row.user_id) === normalizedUserId : true;

    var byIdentifier = true;
    if (normalizedIdentifier) {
      var isEmailIdentifier = normalizedIdentifier.indexOf('@') !== -1;
      if (isEmailIdentifier) {
        byIdentifier = normalizeAuthValue_(row.email) === normalizedIdentifier;
      } else {
        byIdentifier = normalizeAuthValue_(row.user_id) === normalizedIdentifier;
      }
    }

    return byCode && byId && byIdentifier && isTruthy_(row.active);
  });

  return user || null;
}

function requirePerm_(user, permName) {
  if (!isTruthy_(user[permName])) {
    throw new Error('Missing permission: ' + permName);
  }
}
