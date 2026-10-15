import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createGithubAppDispatcher} from './github-app.mjs';
import {createWakeupHandler} from './handler.mjs';

const client=createClient('https://szinlhjuwyiyszdpsdop.supabase.co',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'not-configured',
  {auth:{persistSession:false,autoRefreshToken:false}});
const dispatch=createGithubAppDispatcher({
  appId:Deno.env.get('SCHEDULING_GITHUB_APP_ID'),
  installationId:Deno.env.get('SCHEDULING_GITHUB_INSTALLATION_ID'),
  privateKey:Deno.env.get('SCHEDULING_GITHUB_APP_PRIVATE_KEY')
});
Deno.serve(createWakeupHandler({
  secret:Deno.env.get('SCHEDULING_WAKEUP_SECRET'),dispatch,
  command:async(action:string,payload:Record<string,unknown>)=>{
    const {data,error}=await client.rpc('scheduling_agent_wakeup_command',{p_action:action,p_payload:payload});
    if(error)throw Error('wakeup_rpc_failed');
    return data;
  }
}));
