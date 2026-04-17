function actionLogin_(request) {
  var identifier = String(request.identifier || '').trim();
  if (!identifier || !request.entry_code) return { user: null };

  var user = authenticate_(null, request.entry_code, identifier);
  if (!user) return { user: null };

  var safeUser = {};
  Object.keys(user).forEach(function (k) {
    if (k !== 'entry_code') safeUser[k] = user[k];
  });

  return { user: safeUser };
}
