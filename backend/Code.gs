/**
 * Apps Script entrypoint file.
 *
 * Keep `doGet` / `doPost` here so repository setup is explicit and
 * consistent with Apps Script deployment expectations.
 */
function doGet() {
  return handleGet_();
}

function doPost(e) {
  return handlePost_(e);
}
