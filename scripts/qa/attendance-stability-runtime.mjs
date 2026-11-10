// Manual disposable runtime: PostgreSQL + genuine GoTrue and PostgREST.
// No linked project, production credentials, or remote database is accepted.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
const wd=resolve('work/attendance-stability-qa');
const names=['attendance-stability-qa-gateway','attendance-stability-qa-rest','attendance-stability-qa-auth','attendance-stability-qa-db'];
const network='attendance-stability-qa-runtime';
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(...args)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(process.argv[2]==='stop'){
 for(const name of names){
  let label;try{label=docker('inspect','-f','{{index .Config.Labels "attendance_stability_qa"}}',name);}catch{continue;}
  if(label!=='true')throw Error('Refuse to remove an unlabelled container: '+name);
  docker('rm','-f','-v',name);
 }
 try{docker('network','rm',network);}catch{}
 process.exit(0);
}
for(const name of names){let exists=false;try{docker('inspect',name);exists=true;}catch{}if(exists)throw Error('Container exists; stop this disposable runtime first: '+name);}
await mkdir(wd,{recursive:true});
const secret=randomBytes(32).toString('hex');
const password=randomBytes(24).toString('hex');
const jwt=role=>{const body=[{alg:'HS256',typ:'JWT'},{role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const write=(name,contents)=>writeFile(resolve(wd,name),contents,{mode:0o600});
await write('init.sql',`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password '${password}';
grant anon,authenticated,service_role to authenticator;
create role supabase_auth_admin login createrole password '${password}';
create schema auth authorization supabase_auth_admin;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
alter database postgres set app.attendance_stability_fixture='disposable';
`);
await write('kong.yml',`_format_version: '2.1'
services:
  - name: auth
    url: http://${names[2]}:9999/
    routes:
      - name: auth
        paths: [/auth/v1/]
        strip_path: true
  - name: rest
    url: http://${names[1]}:3000/
    routes:
      - name: rest
        paths: [/rest/v1/]
        strip_path: true
plugins:
  - name: cors
    config:
      origins: ['*']
      headers: [Accept, Authorization, Content-Type, apikey, x-client-info, Prefer, Range, x-supabase-api-version]
      exposed_headers: [Content-Range, Range-Unit, Preference-Applied]
      credentials: true
`);
await chmod(resolve(wd,'init.sql'),0o644);await chmod(resolve(wd,'kong.yml'),0o644);
await write('postgres.env',`POSTGRES_PASSWORD=${password}\n`);
await write('auth.env',`GOTRUE_API_HOST=0.0.0.0
GOTRUE_API_PORT=9999
API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${names[3]}:5432/postgres?search_path=auth
GOTRUE_SITE_URL=http://127.0.0.1:4179
GOTRUE_JWT_SECRET=${secret}
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_RATE_LIMIT_EMAIL_SENT=100
`);
await write('rest.env',`PGRST_DB_URI=postgres://authenticator:${password}@${names[3]}:5432/postgres
PGRST_DB_SCHEMAS=public
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET=${secret}
`);
const created=[];
try{
 docker('network','create',network);
 const start=(name,image,args=[])=>{docker('run','-d','--label','attendance_stability_qa=true','--name',name,'--network',network,...args,image);created.push(name);};
 start(names[3],'postgres:17-alpine',['-p','127.0.0.1:54332:5432','--env-file',resolve(wd,'postgres.env'),'--mount',`type=bind,src=${resolve(wd,'init.sql')},dst=/docker-entrypoint-initdb.d/init.sql,readonly`]);
 const until=async task=>{for(let i=0;i<120;i++){try{if(await task())return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Local fixture readiness timeout');};
 await until(()=>docker('exec',names[3],'psql','-U','postgres','-tAc',"select current_setting('app.attendance_stability_fixture',true)")==='disposable');
 start(names[2],'supabase/gotrue:v2.187.0',['--env-file',resolve(wd,'auth.env')]);
 start(names[1],'postgrest/postgrest:v14.5',['--env-file',resolve(wd,'rest.env')]);
 start(names[0],'kong:2.8.1',['-p','127.0.0.1:54321:8000','-e','KONG_DATABASE=off','-e','KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yml','-e','KONG_PROXY_LISTEN=0.0.0.0:8000','-e','KONG_LOG_LEVEL=error','--mount',`type=bind,src=${resolve(wd,'kong.yml')},dst=/etc/kong/kong.yml,readonly`]);
 await until(async()=> (await fetch('http://127.0.0.1:54321/auth/v1/health')).ok);
 await write('status.json',JSON.stringify({API_URL:'http://127.0.0.1:54321',DB_URL:`postgresql://postgres:${password}@127.0.0.1:54332/postgres`,ANON_KEY:jwt('anon'),SERVICE_ROLE_KEY:jwt('service_role')}));
 console.log('Disposable runtime ready. ATTENDANCE_STABILITY_STATUS='+resolve(wd,'status.json'));
}catch(error){for(const name of created.reverse())try{docker('rm','-f','-v',name);}catch{}throw new Error('Local fixture startup failed: '+error.message);}
