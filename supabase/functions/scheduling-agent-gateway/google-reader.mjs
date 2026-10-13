import {GatewayError} from './gateway.mjs';
// Credentials are supplied only by server-side secret storage after user consent.
export function createGoogleTokenProvider({clientId,clientSecret,refreshToken,expectedGoogleSub,fetchImpl=fetch,now=Date.now}){
 let cached=null;
 return async()=>{
  if(!clientId||!clientSecret||!refreshToken||!expectedGoogleSub)throw new GatewayError('google_server_oauth_not_configured',503);
  if(cached&&cached.expiresAt>now()+60000)return cached.token;
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new GatewayError('google_authorization_required',503);
  const token=await response.json();
  if(!token.access_token||!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=60)throw new GatewayError('google_token_invalid',503);
  const identityResponse=await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  if(!identityResponse.ok||(await identityResponse.json()).sub!==expectedGoogleSub)throw new GatewayError('google_account_mismatch',403);
  cached={token:token.access_token,expiresAt:now()+Number(token.expires_in)*1000};return cached.token;
 };
}
export function createGoogleReader({getAccessToken,spreadsheetId,folderId,fetchImpl=fetch}){
 return async(actor,id)=>{
  if(!spreadsheetId||!folderId)throw new GatewayError('spreadsheet_not_configured',503);
  if(id!==spreadsheetId)throw new GatewayError('spreadsheet_not_allowed',403);
  const accessToken=await getAccessToken(actor);
  const get=async url=>{const r=await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new GatewayError('google_read_failed',503);return r.json();};
  const metadataUrl=`https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,modifiedTime,version,parents`;
  const before=await get(metadataUrl);
  if(before.id!==id||before.mimeType!=='application/vnd.google-apps.spreadsheet'||!before.parents?.includes(folderId)||!before.modifiedTime||!before.version)throw new GatewayError('spreadsheet_identity_mismatch',409);
  const metadata=await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId,properties(timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`);
  const tab=metadata.sheets?.find(s=>s.properties?.title==='שיבוצים')?.properties;
  // Fail closed on an oversized/structurally different workbook, rather than truncate it.
  if(!tab||tab.gridProperties.columnCount>26||tab.gridProperties.rowCount>2000)throw new GatewayError('sheet_structure_requires_review',409);
  const range=encodeURIComponent(`'שיבוצים'!A1:Q${tab.gridProperties.rowCount}`);
  const values=await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
  const after=await get(metadataUrl);
  if(before.version!==after.version||before.modifiedTime!==after.modifiedTime)throw new GatewayError('sheet_changed_during_read',409);
  return {spreadsheetId:id,version:after.version,modifiedTime:after.modifiedTime,timeZone:metadata.properties?.timeZone,sheetId:tab.sheetId,values:values.values||[]};
 };
}
