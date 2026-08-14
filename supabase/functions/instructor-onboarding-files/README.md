# Instructor onboarding SharePoint files

Authenticated users with the existing employee-file permission can retrieve one complete onboarding kit from `תיקים אישיים/קליטת מדריך` on the `taasiyeda2027` SharePoint site. The employment type selects either the `תעשיידע` or `כוח אדם` folder in the explicit `מסמכים` drive, and every direct file currently in that folder is returned. Subfolders are ignored and an empty folder rejects draft preparation.

The function reuses `MS_TENANT_ID`, `MS_CLIENT_ID`, and `MS_CLIENT_SECRET` plus the existing application-level `Sites.Selected` read grant. It never accesses Outlook and never sends mail. Outlook drafts are created separately in the browser using the signed-in employee's delegated `Mail.ReadWrite` token.
