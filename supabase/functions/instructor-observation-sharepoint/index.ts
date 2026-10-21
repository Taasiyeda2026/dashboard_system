import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import bidiFactory from "npm:bidi-js@1.0.3";

const SITE="https://think365orgil.sharepoint.com/sites/taasiyeda2027";
const DRIVE="b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const BASE="/sites/taasiyeda2027/Shared Documents/תיקים אישיים/";
const GRAPH="https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(DRIVE);
const FONT="https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const clean=(v:unknown)=>String(v??"").trim();
const json=(o:unknown,status=200)=>new Response(JSON.stringify(o),{status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const bidi=bidiFactory();
const SCORE=["","חלש","טעון שיפור","טוב","טוב מאוד","מצוין"];
const SECTIONS:[string,string[]][]=[
  ["הכנה ופתיחה",["האם המדריך הגיע מוכן לשיעור (ציוד, מצגת, חומרים, סדר עבודה)?","פתיחת השיעור הייתה ברורה, מסקרנת ומכינה את התלמידים לנושא?"]],
  ["שליטה בתוכן ובמבנה השיעור",["שליטה בתוכן ובידע הנדרש לשיעור","עבודה עקבית לפי הסילבוס והמטרות שנקבעו לשיעור","יכולת קישור בין שיעור קודם לנושא הנלמד היום / סיכום בסוף השיעור"]],
  ["איכות ההסבר והעברת התוכן",["בהירות ההסבר והתאמת השפה לגיל התלמידים","שימוש בהמחשות, שאלות, דוגמאות, ציוד או מצגת","עידוד חשיבה, סקרנות או שאלות מצד התלמידים"]],
  ["אינטראקציה עם תלמידים",["רמת המעורבות של התלמידים במהלך השיעור","יחס אישי, תקשורת נעימה ויצירת קשר עם כלל התלמידים"]],
  ["ניהול כיתה",["שמירה על סדר וקשב במהלך השיעור","התמודדות עם בעיות משמעת או הפרעות","עבודה יעילה במהלך פעילות/בנייה (במידת הצורך)"]],
  ["מקצועיות ושיתוף פעולה",["ביטחון מקצועי, נוכחות והובלת השיעור","שיתוף פעולה עם צוות בית הספר הנוכח בשיעור (אם יש)"]]
];
const safeName=(v:unknown)=>clean(v).replace(/[\/\\:*?"<>|#%]+/g," ").replace(/\s+/g," ").slice(0,110).trim();
function dateString(value:unknown) {
 const m=clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
 return m?m[3]+"."+m[2]+"."+m[1]:clean(value);
}
function visualRtl(value:unknown) {
 const logical=clean(value).replace(/\s+/g," ");
 const chars=logical.split("");
 const levels=bidi.getEmbeddingLevels(logical,"rtl");
 for(const [start,end] of bidi.getReorderSegments(logical,levels)){
   let l=start,r=end;while(l<r){[chars[l],chars[r]]=[chars[r],chars[l]];l++;r--;}
 }
 return Array.from(chars.join("")).reverse().join("");
}
async function graphToken() {
 const tenant=clean(Deno.env.get("MS_TENANT_ID"));
 const client=clean(Deno.env.get("MS_CLIENT_ID"));
 const secret=clean(Deno.env.get("MS_CLIENT_SECRET"));
 if(!tenant||!client||!secret)throw new Error("חיבור SharePoint אינו מוגדר בשרת.");
 const r=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"})
 });
 if(!r.ok)throw new Error("אימות השירות ל־SharePoint נכשל ("+r.status+").");
 const token=clean((await r.json()).access_token);
 if(!token)throw new Error("לא התקבל אסימון חיבור SharePoint.");
 return token;
}
async function graph(token:string,path:string,options:RequestInit={},allow404=false):Promise<any> {
 const r=await fetch(GRAPH+path,{...options,headers:{Authorization:"Bearer "+token,...(options.headers||{})}});
 if(allow404 && r.status===404)return null;
 if(!r.ok)throw new Error("שירות SharePoint החזיר שגיאה "+r.status+". בדקו הרשאות כתיבה לתיקייה.");
 return await r.json();
}
function canonicalEmployeeFolder(url:unknown) {
 const parsed=new URL(clean(url));
 if(parsed.origin!==new URL(SITE).origin)throw new Error("קישור תיק העובד אינו באתר SharePoint המאושר.");
 const folder=parsed.searchParams.get("id")||parsed.searchParams.get("RootFolder")||decodeURIComponent(parsed.pathname);
 const decoded=decodeURIComponent(folder).replace(/\/+$/,"");
 if(!decoded.startsWith(BASE))throw new Error("קישור תיק העובד אינו תחת תיקים אישיים.");
 const name=decoded.slice(BASE.length);
 if(!name||name.includes("/")||name==="."||name==="..")throw new Error("נתיב תיק העובד אינו תקין.");
 return "תיקים אישיים/"+name;
}
function encodePath(path:string) {return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");}
let fonts:Promise<Uint8Array[]>|null=null;
function loadFonts() {
 if(!fonts)fonts=Promise.all(["Alef-Regular.ttf","Alef-Bold.ttf"].map(async name=>{
  const response=await fetch(FONT+name);
  if(!response.ok)throw new Error("גופן הדו״ח אינו זמין.");
  return new Uint8Array(await response.arrayBuffer());
 }));
 return fonts;
}
async function buildPdf(record:any,slot:number):Promise<Uint8Array> {
 const bytes=await loadFonts();
 const pdf=await PDFDocument.create();
 pdf.registerFontkit(fontkit);
 const regular=await pdf.embedFont(bytes[0],{subset:true});
 const bold=await pdf.embedFont(bytes[1],{subset:true});
 const W=595,H=842,L=40,R=555;
 let page=pdf.addPage([W,H]),y=786,pageNumber=1;
 function drawRight(value:unknown,x:number,yy:number,size=9,heavy=false,color=rgb(.13,.20,.28)) {
  const text=visualRtl(value);if(!text)return;
  const font=heavy?bold:regular;
  page.drawText(text,{x:Math.max(L,x-font.widthOfTextAtSize(text,size)),y:yy,size,font,color});
 }
 function header(first=false) {
  page.drawRectangle({x:L,y:750,width:R-L,height:64,color:rgb(.94,.97,.99)});
  drawRight("תעשיידע — משוב תצפית "+slot+" | "+record.instructor_name,R-13,785,15,true,rgb(.08,.30,.43));
  drawRight("צפייה והערכת מדריך • "+dateString(record.observation_date),R-13,762,9);
  if(!first)drawRight("המשך דו״ח תצפית — עמוד "+pageNumber,R,737,8);
 }
 function newPage(){
  pageNumber++;page=pdf.addPage([W,H]);y=720;header();
 }
 function room(h:number){if(y-h<55)newPage();}
 function wrapped(value:unknown,size=9,heavy=false,indent=0,after=5) {
  const font=heavy?bold:regular,text=clean(value).replace(/\s+/g," ");
  if(!text)return;
  const words=text.split(" "),lines:string[]=[];let line="";
  for(const word of words) {
    const candidate=line?line+" "+word:word;
    if(line && font.widthOfTextAtSize(visualRtl(candidate),size)>R-L-indent){
      lines.push(line);line=word;
    } else line=candidate;
  }
  if(line)lines.push(line);
  for(const part of lines){room(size+7);drawRight(part,R-indent,y,size,heavy);y-=size+6;}
  y-=after;
 }
 function section(title:string){
  room(38);y-=5;
  page.drawRectangle({x:L,y:y-19,width:R-L,height:27,color:rgb(.92,.96,.98)});
  drawRight(title,R-10,y-10,11,true,rgb(.08,.31,.48));y-=38;
 }
 header(true);y=734;
 section("פרטי התצפית");
 const d=record.details||{};
 for(const [label,value] of [
  ["שם המדריך",record.instructor_name],["תאריך התצפית",dateString(record.observation_date)],
  ["שם הצופה",record.observer_name],["קורס",d.course],["בית הספר",d.school],
  ["כיתה",d.class],["מספר מפגש",d.meeting],["מספר תלמידים",d.students],
  ["נוכחות צוות בית הספר",d.school_staff],["מידע מקדים",d.important]
 ]) {
  if(!clean(value))continue;
  wrapped(label+": "+value,9,false,5,1);
 }
 section("סולם הערכה: 5 מצוין | 4 טוב מאוד | 3 טוב | 2 טעון שיפור | 1 חלש");
 for(let i=0;i<SECTIONS.length;i++){
  const [title,questions]=SECTIONS[i];
  section((i+1)+". "+title);
  for(let j=0;j<questions.length;j++){
   const response=clean(record.responses?.[i+"-"+j]);
   wrapped(questions[j],9.3,true,3,2);
   if(/^[1-5]$/.test(response)){
     room(31);
     for(let n=5;n>=1;n--){
      const start=R-(5-n)*103;
      page.drawRectangle({x:start-12,y:y-1,width:10,height:10,borderWidth:0.8,borderColor:rgb(.27,.42,.54)});
      if(String(n)===response){
       page.drawLine({start:{x:start-10,y:y+2},end:{x:start-4,y:y+7},thickness:1.2,color:rgb(.05,.38,.55)});
       page.drawLine({start:{x:start-4,y:y+7},end:{x:start+1,y:y-1},thickness:1.2,color:rgb(.05,.38,.55)});
      }
      drawRight(n+" - "+SCORE[n],start-17,y+1,8);
     }
     y-=27;
   } else {
     wrapped("תשובה: "+(response||"לא מולא"),9,false,5,5);
   }
  }
  const comment=clean(record.comments?.[i]);
  if(comment){wrapped("הערות ודוגמאות: "+comment,8.5,false,7,7);}
 }
 section("סיכום מקצועי");
 wrapped("דירוג כולל: "+record.overall_rating+" - "+SCORE[record.overall_rating],10,true);
 for(const [name,value] of [
  ["נקודות כוח",record.strengths],["נקודות לשיפור",record.improvements],["סיכום מקצועי וחוות דעת",record.summary]
 ]) {
  wrapped(name,10,true,3,2);wrapped(value,9,false,5,9);
 }
 room(26);drawRight("מסמך תצפית סופי | תעשיידע | "+dateString(record.observation_date),R,y,8);
 return new Uint8Array(await pdf.save());
}
function savedReceipt(x:any) {
 return {saved:true,file_name:x.file_name,url:x.sp_web_url,observation_slot:x.observation_slot};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 try{
  const raw=clean(req.headers.get("Authorization"));
  if(!raw.startsWith("Bearer "))return json({error:"authentication_required"},401);
  const anon=clean(Deno.env.get("SUPABASE_ANON_KEY")),url=clean(Deno.env.get("SUPABASE_URL"));
  const service=clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if(!anon||!url||!service)throw new Error("Supabase server credentials missing");
  const client=createClient(url,anon,{global:{headers:{Authorization:raw}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:userError}=await client.auth.getUser(raw.slice(7));
  if(userError||!user?.user)return json({error:"authentication_required"},401);
  const body=await req.json();
  const observationId=clean(body?.observation_id);
  const action=clean(body?.action)||"save";
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(observationId)||!["save","status"].includes(action))
   return json({error:"invalid_request"},400);
  // Read through RLS, never trust an emp_id, slot, name, filename or path supplied by the browser.
  const {data:observation,error:readError}=await client.from("instructor_observations").select("*").eq("id",observationId).maybeSingle();
  if(readError||!observation||observation.status!=="completed")return json({error:"completed_observation_not_available"},403);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:receipt,error:receiptError}=await admin.from("instructor_observation_sharepoint_exports")
   .select("*").eq("observation_id",observationId).maybeSingle();
  if(receiptError)throw receiptError;
  if(receipt)return json(savedReceipt(receipt));
  if(action==="status")return json({saved:false});
  const slot=Number(observation.details?.observation_slot || 1);
  if(![1,2].includes(slot))return json({error:"invalid_observation_slot"},422);
  const {data:mapping,error:mapError}=await admin.from("instructor_employee_folders")
   .select("folder_web_url").eq("emp_id",observation.emp_id).eq("school_year","2027").maybeSingle();
  if(mapError)throw mapError;
  if(!mapping?.folder_web_url)return json({error:"employee_sharepoint_folder_not_mapped"},409);
  const employeeFolder=canonicalEmployeeFolder(mapping.folder_web_url);
  const folderPath=employeeFolder+"/03 תצפיות/תצפית "+slot;
  const token=await graphToken();
  const folder=await graph(token,"/root:/"+encodePath(folderPath));
  if(!folder?.folder)throw new Error("תיקיית התצפית אינה קיימת ב־SharePoint.");
  const name=safeName(observation.instructor_name);
  const filename=name+" - תצפית "+slot+" - "+dateString(observation.observation_date)+" - "+
    observation.id.slice(0,8)+".pdf";
  const destination="/items/"+encodeURIComponent(folder.id)+":/"+encodeURIComponent(filename);
  let file=await graph(token,destination,{},true);
  if(!file) {
   const pdfBytes=await buildPdf(observation,slot);
   const response=await fetch(GRAPH+destination+":/content",{
    method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/pdf"},
    body:new Uint8Array(pdfBytes)
   });
   if(!response.ok)throw new Error("שמירת PDF בתיקיית התצפית נכשלה ("+response.status+"). בדקו הרשאת כתיבה ב־SharePoint.");
   file=await response.json();
  }
  if(!file?.id||!file?.webUrl)throw new Error("SharePoint לא אישר את שמירת הקובץ.");
  const row={observation_id:observation.id,emp_id:observation.emp_id,observation_slot:slot,
   file_name:filename,sp_drive_id:DRIVE,sp_item_id:file.id,sp_web_url:file.webUrl};
  const {error:insertError}=await admin.from("instructor_observation_sharepoint_exports")
   .upsert(row,{onConflict:"observation_id"});
  if(insertError)throw insertError;
  return json(savedReceipt(row));
 }catch(error) {
  console.error("[instructor-observation-sharepoint]",error);
  return json({error:clean((error as Error).message)||"sharepoint_pdf_failed"},500);
 }
});