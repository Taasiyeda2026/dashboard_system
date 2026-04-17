function handleHttpRequest_(e) {
  try {
    var request = buildRequest_(e);
    if (!request.action) return jsonError_('Missing action');

    if (request.action === 'login') {
      return jsonOk_(actionLogin_(request));
    }

    var user = authenticate_(request.user_id, request.entry_code);
    if (!user) return jsonError_('Unauthorized', 401);

    var handlers = {
      getBootstrap: actionGetBootstrap_,
      getDashboard: actionGetDashboard_,
      getActivities: actionGetActivities_,
      getModuleData: actionGetModuleData_
    };

    var handler = handlers[request.action];
    if (!handler) return jsonError_('Unknown action: ' + request.action, 404);

    return jsonOk_(handler(request, user));
  } catch (err) {
    return jsonError_(err && err.message ? err.message : 'Internal error', 500);
  }
}

function buildRequest_(e) {
  var params = (e && e.parameter) || {};
  var body = {};

  if (e && e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      body = {};
    }
  }

  var request = {};
  Object.keys(params).forEach(function (k) { request[k] = params[k]; });
  Object.keys(body).forEach(function (k) { request[k] = body[k]; });
  return request;
}

function jsonOk_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(message, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: message, code: code || 400 }))
    .setMimeType(ContentService.MimeType.JSON);
}
