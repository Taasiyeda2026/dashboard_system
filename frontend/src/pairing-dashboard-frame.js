import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { verifiedSession } from './inspiration-session-bridge.js';

const COURSE_ORIGIN = 'https://portzot-derech.org';
export function bindPairingDashboardFrame(frame, canView) {
 let disposed=false;
 async function receive(event) {
  if(disposed || !frame.isConnected || !canView() || event.origin!==COURSE_ORIGIN || event.source!==frame.contentWindow ||
     event.data?.type!=='pairing:dashboard-session-request' || !/^[a-f0-9]{48}$/.test(event.data?.nonce||''))return;
  const nonce=event.data.nonce;
  await waitForSupabaseAuthSession();
  const session=await verifiedSession(supabase).catch(()=>null);
  if(disposed || !frame.isConnected || !canView())return;
  event.source.postMessage({type:'pairing:dashboard-session',nonce,access_token:session?.access_token||null},COURSE_ORIGIN);
 }
 window.addEventListener('message',receive);
 return ()=>{disposed=true;window.removeEventListener('message',receive);frame.removeAttribute('src');};
}
