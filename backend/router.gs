function handleGet_() {
  var validation = validateRequiredSheets_();

  return jsonResponse_({
    ok: validation.ok,
    data: {
      service: 'dashboard-system',
      status: validation.ok ? 'ready' : 'missing_sheets',
      missing_sheets: validation.missing
    }
  });
}

function handlePost_(e) {
  try {
    beginRequestCache_();
    var payload = parsePayload_(e);
    var action = text_(payload.action);
    var user = action === 'login' ? null : requireAuth_(payload.token);

    var handlers = {
      login: function() { return actionLogin_(payload); },
      bootstrap: function() { return actionBootstrap_(user); },
      dashboard: function() { return actionDashboard_(user, payload); },
      activities: function() { return actionActivities_(user, payload); },
      week: function() { return actionWeek_(user, payload); },
      month: function() { return actionMonth_(user, payload); },
      exceptions: function() { return actionExceptions_(user, payload); },
      finance: function() { return actionFinance_(user, payload); },
      instructors: function() { return actionInstructors_(user, payload); },
      instructorContacts: function() { return actionInstructorContacts_(user, payload); },
      contacts: function() { return actionContacts_(user, payload); },
      endDates: function() { return actionEndDates_(user, payload); },
      myData: function() { return actionMyData_(user, payload); },
      permissions: function() { return actionPermissions_(user, payload); },
      addActivity: function() { return actionAddActivity_(user, payload); },
      saveActivity: function() { return actionSaveActivity_(user, payload); },
      submitEditRequest: function() { return actionSubmitEditRequest_(user, payload); },
      reviewEditRequest: function() { return actionReviewEditRequest_(user, payload); },
      savePermission: function() { return actionSavePermission_(user, payload); },
      addUser: function() { return actionAddUser_(user, payload); },
      deactivateUser: function() { return actionDeactivateUser_(user, payload); },
      deleteUser: function() { return actionDeleteUser_(user, payload); },
      savePrivateNote: function() { return actionSavePrivateNote_(user, payload); }
    };

    if (!handlers[action]) {
      throw new Error('Unknown action: ' + action);
    }

    return jsonResponse_({
      ok: true,
      data: handlers[action]()
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : 'Unexpected error'
    });
  }
}
