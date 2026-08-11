# Instructor employee-file live SharePoint reader

This Edge Function reads the eight fixed employee-file folders from the SharePoint site `https://think365orgil.sharepoint.com/sites/taasiyeda2027` when the employee-file modal is opened.

It does not use webhooks, delta sync, polling, subscriptions, OCR, or document-content storage.

Required Supabase Edge Function secrets:

- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`

Microsoft Graph access should use application permission `Sites.Selected`, with read access granted only to the `taasiyeda2027` SharePoint site. Do not store the client secret in this repository or in frontend code.

Until these three secrets are configured, the function returns the secured database snapshot as a temporary fallback. The UI remains read-only for document status.
