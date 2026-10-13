import {GatewayError} from './gateway.mjs';
// Dedicated service account: only explicitly shared files are accessible.
// No domain-wide delegation, impersonation, project IAM roles or writable scopes.
export function createServiceAccountTokenProvider({credentialsJson,createJwt,now=Date.now}){
 let client,cached;
 return async()=>{
  if(!credentialsJson)throw new GatewayError('google_server_oauth_not_configured',503);
  if(cached&&cached.expiresAt>now()+60000)return cached.token;
  if(!client){
   let c;try{c=JSON.parse(credentialsJson);}catch{throw new GatewayError('google_credentials_invalid',503);}
   if(c.type!=='service_account'||typeof c.client_email!=='string'||!c.client_email.endsWith('.iam.gserviceaccount.com')||typeof c.private_key!=='string'||!c.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw new GatewayError('google_credentials_invalid',503);
   client=createJwt({email:c.client_email,key:c.private_key,scopes:['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/spreadsheets.readonly']});
  }
  let credentials;try{credentials=await client.authorize();}catch{throw new GatewayError('google_authorization_required',503);}
  if(!credentials.access_token||!Number.isFinite(credentials.expiry_date)||credentials.expiry_date<=now()+60000)throw new GatewayError('google_token_invalid',503);
  cached={token:credentials.access_token,expiresAt:credentials.expiry_date};return cached.token;
 };
}
