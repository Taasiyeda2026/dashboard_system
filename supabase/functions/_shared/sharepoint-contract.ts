export const EMPLOYEE_FILE_COMPONENT_PATHS = {
  signed_agreement: ['01 הסכם ומסמכים', 'הסכם חתום'],
  supporting_documents: ['01 הסכם ומסמכים', 'מסמכים נלווים'],
  intro_feedback: ['02 משובים', 'משוב היכרות'],
  midyear_feedback: ['02 משובים', 'משוב אמצע שנה'],
  year_end_feedback: ['02 משובים', 'משוב סוף שנה'],
  observation_1: ['03 תצפיות', 'תצפית 1'],
  observation_2: ['03 תצפיות', 'תצפית 2'],
  payroll_reports: ['04 דוחות שכר']
} as const;

export type EmployeeFileComponentKey = keyof typeof EMPLOYEE_FILE_COMPONENT_PATHS;

export type EmployeeFileSnapshotRow = {
  folder_mapping_id: string;
  component_key: EmployeeFileComponentKey;
  present: boolean;
  item_count: number;
  latest_modified_at: string | null;
  synced_at: string;
};

export type SharePointServerConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  webhookClientState: string;
  siteHostname: 'think365orgil.sharepoint.com';
  sitePath: '/sites/taasiyeda2027';
  employeeFilesRoot: 'תיקים אישיים';
};

/** Server-only configuration contract. No Graph endpoint is assumed here. */
export function readSharePointServerConfig(): SharePointServerConfig {
  const config: SharePointServerConfig = {
    tenantId: Deno.env.get('MS_TENANT_ID') || '',
    clientId: Deno.env.get('MS_CLIENT_ID') || '',
    clientSecret: Deno.env.get('MS_CLIENT_SECRET') || '',
    webhookClientState: Deno.env.get('MS_GRAPH_WEBHOOK_CLIENT_STATE') || '',
    siteHostname: 'think365orgil.sharepoint.com',
    sitePath: '/sites/taasiyeda2027',
    employeeFilesRoot: 'תיקים אישיים'
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`sharepoint_server_configuration_missing:${missing.join(',')}`);
  return config;
}
