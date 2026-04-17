function actionLogin_(request) {
  var user = authenticate_(request.user_id, request.entry_code);
  if (!user) return { user: null };

  var safeUser = {};
  Object.keys(user).forEach(function (k) {
    if (k !== 'entry_code') safeUser[k] = user[k];
  });

  return { user: safeUser };
}
