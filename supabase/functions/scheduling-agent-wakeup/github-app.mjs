const REPO='Taasiyeda2026/dashboard_system';
const REPO_ID=1212938814;
const WORKFLOW='scheduling-agent-worker.yml';
const API='https://api.github.com';
const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value)))
  .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export class WakeupError extends Error {
  constructor(code){super(code);this.code=code;}
}

// Only GitHub App installation tokens minted here; no PAT fallback or caller URL.
export function createGithubAppDispatcher({appId='',installationId='',privateKey='',fetchImpl=fetch,
  cryptoImpl=globalThis.crypto,now=Date.now}={}) {
  const validId=x=>/^\d+$/.test(String(x||''));
  async function request(path,token,body){
    let response;
    try {response=await fetchImpl(API+path,{
      method:body===undefined?'GET':'POST',redirect:'error',
      headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',
        'X-GitHub-Api-Version':'2022-11-28','User-Agent':'taasiyeda-scheduling-wakeup',
        Authorization:'Bearer '+token},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
    });}catch{throw new WakeupError('github_unreachable');}
    if(!response.ok)throw new WakeupError(
      response.status===401||response.status===403?'github_app_permission_denied':
      response.status===429||response.status>=500?'github_temporary_failure':'github_request_rejected');
    if(response.status===204)return null;
    try{return await response.json();}catch{throw new WakeupError('github_invalid_response');}
  }
  async function prepare(){
    if(!validId(appId)||!validId(installationId)||!privateKey)
      throw new WakeupError('github_app_not_configured');
    const seconds=Math.floor(now()/1000);
    const jwtHeader=encode(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
    const jwtBody=encode(new TextEncoder().encode(JSON.stringify({iat:seconds-30,exp:seconds+120,iss:String(appId)})));
    let signature;
    try {
      const pem=privateKey.replace(/\\n/g,'\n').replace(/-----[^-]+-----|\s/g,'');
      const key=await cryptoImpl.subtle.importKey('pkcs8',
        Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),
        {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      signature=await cryptoImpl.subtle.sign('RSASSA-PKCS1-v1_5',key,
        new TextEncoder().encode(jwtHeader+'.'+jwtBody));
    }catch{throw new WakeupError('github_app_key_invalid');}
    const appToken=jwtHeader+'.'+jwtBody+'.'+encode(signature);
    const installation=await request('/app/installations/'+installationId,appToken);
    if(installation?.app_id!==Number(appId)||installation?.suspended_at
      ||installation?.account?.login!=='Taasiyeda2026')throw new WakeupError('github_installation_denied');
    const token=await request('/app/installations/'+installationId+'/access_tokens',appToken,
      {repository_ids:[REPO_ID],permissions:{actions:'write'}});
    // GitHub must attest actual granted permissions. Never trust config alone.
    if(token?.permissions?.actions!=='write'||!token.token
      ||Date.parse(token.expires_at)<=now()+30000)throw new WakeupError('github_actions_write_required');
    const repos=await request('/installation/repositories?per_page=100',token.token);
    if(repos?.total_count!==1||repos.repositories?.[0]?.id!==REPO_ID
      ||repos.repositories[0].full_name!==REPO)throw new WakeupError('github_repository_scope_denied');
    const workflow=await request('/repos/'+REPO+'/actions/workflows/'+WORKFLOW,token.token);
    if(workflow?.state!=='active'||workflow.path!=='.github/workflows/'+WORKFLOW)
      throw new WakeupError('github_workflow_inactive');
    return token.token;
  }
  const dispatch=async()=>{
    const token=await prepare();
    await request('/repos/'+REPO+'/actions/workflows/'+WORKFLOW+'/dispatches',token,{ref:'main'});
    return {accepted:true}; // Dispatch acceptance is not a claim or a completed plan.
  };
  // Readiness verifies granted permissions without creating a run or claiming work.
  dispatch.verify=async()=>{await prepare();return {verified:true,actions:'write',repository:REPO};};
  return dispatch;
}
