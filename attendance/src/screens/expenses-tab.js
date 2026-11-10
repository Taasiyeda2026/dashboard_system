import { createUnsavedChangesGuard } from '../services/unsaved-changes.js';
import { createInputField } from '../components/field.js';
import {listExpenseReports,saveExpenseReport,attachExpenseReceipt,expenseReceiptSignedUrl} from '../services/expense-reports.service.js';
import {readHistoricalAttendance,historicalExpenses,monthRange,monthLabel,monthStatusLabel} from '../services/historical-display.service.js';

const STATUS={pending_review:'ממתין לאישור',approved:'אושר',rejected:'נדרש תיקון'};
const todayLocal=()=>{
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')].join('-');
};
const fmtAmount=value=>new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'}).format(Number(value)||0);

export function createExpensesTab({instructor,initialDate}={}){
  const panel=document.createElement('section');
  panel.id='av2-expenses-tab-panel';
  panel.className='av2-expenses-tab';
  panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby','av2-expenses-tab-trigger');
  panel.hidden=true;

  const heading=document.createElement('h2');
  heading.textContent='דיווח הוצאות';
  const monthStatus=document.createElement('p');
  monthStatus.className='av2-expenses-tab__month-status';
  const form=document.createElement('form');
  form.className='av2-expenses-tab__form';
  const fieldsRow=document.createElement('div');
  fieldsRow.className='av2-expenses-tab__fields-row';
  form.noValidate=true;
  const draftGuard=createUnsavedChangesGuard(form);
  let pendingReceipts=[],savedForReceipts=null;
  const date=createInputField({id:'av2-expense-date',label:'תאריך הוצאה',
    type:'date',value:initialDate||todayLocal()});
  const amount=createInputField({id:'av2-expense-amount',label:'סכום (₪)',type:'number',
    attrs:{min:'0.01',max:'100000',step:'0.01',placeholder:'0.00'}});
  const details=createInputField({id:'av2-expense-details',label:'פירוט הוצאה',
    placeholder:'על מה ההוצאה?'});
  const filesWrap=document.createElement('div');
  filesWrap.className='av2-expenses-tab__files';
  const fileLabel=document.createElement('label');
  fileLabel.className='av2-field__label';
  fileLabel.htmlFor='av2-expense-receipts';
  fileLabel.textContent='מסמכים מצורפים';
  const fileInput=document.createElement('input');
  fileInput.type='file';fileInput.id='av2-expense-receipts';
  fileInput.multiple=true;
  fileInput.accept='.pdf,.jpg,.jpeg,.png,.webp';
  const fileHint=document.createElement('small');
  fileHint.textContent='PDF או תמונה, עד 10MB לקובץ';
  const uploadText=document.createElement('span');
  uploadText.className='av2-expenses-tab__upload-text';
  uploadText.textContent='צירוף קובץ';
  fileInput.setAttribute('aria-label','צירוף מסמכים להוצאה');
  filesWrap.append(fileLabel,uploadText,fileInput,fileHint);
  fileInput.addEventListener('change',()=>{
    pendingReceipts.push(...Array.from(fileInput.files||[]));
    uploadText.textContent=fileInput.files?.length
      ?(fileInput.files.length===1?fileInput.files[0].name:fileInput.files.length+' קבצים נבחרו')
      :'צירוף קובץ';
  });
  const status=document.createElement('p');
  status.className='av2-expenses-tab__status';
  status.setAttribute('role','status');
  const save=document.createElement('button');
  save.type='submit';save.className='av2-btn av2-btn--primary';
  save.textContent='שמירה';
  const reset=document.createElement('button');
  reset.type='button';reset.className='av2-btn av2-btn--secondary';
  reset.textContent='ביטול';
  const actions=document.createElement('div');
  actions.className='av2-expenses-tab__actions';
  actions.append(save,reset);
  fieldsRow.append(date.wrap,amount.wrap);
  form.append(fieldsRow,details.wrap,filesWrap,status,actions);
  const listHeading=document.createElement('h3');
  listHeading.textContent='ההוצאות שלי';
  const list=document.createElement('div');
  list.className='av2-expenses-tab__list';
  panel.append(heading,form,monthStatus,listHeading,list);
  let reports=[],editing=null,loadToken=0;
  const currentMonth=todayLocal().slice(0,7);
  let selectedMonth=(date.input.value||todayLocal()).slice(0,7);
  let historicalView=false;

  function resetForm({resetDate=false}={}){
    editing=null;pendingReceipts=[];savedForReceipts=null;draftGuard.markClean();
    date.input.disabled=false;amount.input.disabled=false;details.input.disabled=false;
    if(resetDate)date.input.value=todayLocal();
    amount.input.value='';
    details.input.value='';
    fileInput.value='';
    uploadText.textContent='צירוף קובץ';
    save.textContent='שמירה';
    status.textContent='';
  }
  reset.addEventListener('click',()=>{
    const hasChanges=Boolean(
      pendingReceipts.length || editing || amount.input.value.trim() || details.input.value.trim()
      || fileInput.files?.length
    );
    if(hasChanges && !window.confirm(savedForReceipts?'ההוצאה כבר נשמרה. לבטל את צירוף הקבצים שנותרו?':'לבטל את מילוי ההוצאה ללא שמירה?'))return;
    resetForm({resetDate:true});
    void refresh();
  });
  async function refresh(){
    const token=++loadToken;
    selectedMonth=(date.input.value||todayLocal()).slice(0,7);
    const validMonth=/^20\d{2}-(0[1-9]|1[0-2])$/;
    if(!validMonth.test(selectedMonth)){
      monthStatus.textContent='';
      list.textContent='';
      return;
    }
    list.textContent='טוען הוצאות…';
    try{
      const {from,to}=monthRange(selectedMonth);
      historicalView=selectedMonth!==currentMonth;
      const [independent,history]=await Promise.all([
        listExpenseReports({fromDate:from,toDate:to,employeeIds:[instructor.empId]}),
        readHistoricalAttendance(instructor.empId,selectedMonth)
      ]);
      if(token!==loadToken)return;
      reports=historicalExpenses(history.rows,independent);
      // An older reporting month is displayed read-only; do not hide the date
      // field, otherwise the user cannot return to the active period.
      form.hidden=false;
      save.disabled=historicalView;
      monthStatus.textContent=historicalView
        ?monthLabel(selectedMonth)+' · צפייה בלבד · '+monthStatusLabel(history.approval)
        :'';
      renderList();
    }catch(err){
      if(token===loadToken)list.textContent=err.message||'לא ניתן לטעון את ההוצאות';
    }
  }
  function renderList(){
    list.replaceChildren();
    if(!reports.length){
      const empty=document.createElement('p');
      empty.textContent='אין הוצאות מדווחות לחודש זה';
      list.append(empty);return;
    }
    for(const row of reports){
      const item=document.createElement('article');
      item.className='av2-expenses-tab__item';
      const top=document.createElement('div');
      top.className='av2-expenses-tab__item-top';
      const info=document.createElement('strong');
      info.textContent=row.expense_date+' · '+fmtAmount(row.amount);
      const badge=document.createElement('span');
      badge.textContent=row.source==='legacy'?'דיווח קודם':(STATUS[row.review_status]||'ממתין לאישור');
      badge.className='av2-expenses-tab__review-status';
      top.append(info,badge);
      const description=document.createElement('p');
      description.textContent=row.details;
      item.append(top,description);
      const attachments=document.createElement('div');
      attachments.className='av2-expenses-tab__receipts';
      for(const attachment of (row.attachments||[])){
        const link=document.createElement('button');
        link.type='button';link.className='av2-btn av2-btn--secondary';
        link.textContent=attachment.file_name||'צפייה במסמך';
        link.addEventListener('click',async()=>{
          try{
            const url=await expenseReceiptSignedUrl(attachment.storage_path);
            window.open(url,'_blank','noopener');
          }catch{status.textContent='לא ניתן לפתוח את המסמך';}
        });
        attachments.append(link);
      }
      item.append(attachments);
      if(!historicalView && row.source==='independent' && row.review_status!=='approved'){
        const edit=document.createElement('button');
        edit.type='button';
        edit.className='av2-btn av2-btn--secondary av2-expenses-tab__edit';
        edit.textContent='עריכה';
        edit.addEventListener('click',()=>{
          if(!draftGuard.confirmLeave())return;
          resetForm();
          editing=row.id;
          date.input.value=row.expense_date;
          amount.input.value=String(row.amount);
          details.input.value=row.details;
          fileInput.value='';
          status.textContent='';
          save.textContent='שמירת תיקון';
          form.scrollIntoView({block:'nearest',behavior:'smooth'});
          amount.input.focus();
        });
        item.append(edit);
      }
      list.append(item);
    }
  }
  date.input.addEventListener('change',()=>{
    if(editing)resetForm();
    void refresh();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(historicalView){
      status.textContent='חודש קודם מוצג לצפייה בלבד';
      return;
    }
    if(draftGuard.busy)return;
    const chosen=pendingReceipts.slice();
    const invalid=chosen.find(file=>file.size<=0 || file.size>10*1024*1024
      || !['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type));
    if(invalid){status.textContent='ניתן לצרף PDF או תמונה עד 10MB';return;}
    draftGuard.busy=true;save.disabled=true;
    status.textContent=savedForReceipts?'ההוצאה נשמרה; מנסה לצרף קבצים…':'שומר הוצאה…';
    try{
      const saved=savedForReceipts || await saveExpenseReport({
        date:date.input.value,amount:amount.input.value,
        details:details.input.value,id:editing
      });
      savedForReceipts=saved;editing=saved.id;
      if(chosen.length)status.textContent='ההוצאה נשמרה; מעלה קבצים…';
      const failed=[];
      for(const file of chosen){
        try{
          await attachExpenseReceipt({file,expenseId:saved.id,
            employeeId:instructor.empId,email:instructor.email||'',date:saved.expense_date});
        }catch{failed.push(file);}
      }
      pendingReceipts=failed;
      if(failed.length){
        status.textContent='ההוצאה נשמרה, אך צירוף הקבצים לא הושלם: '+failed.map(file=>file.name).join(', ');
        uploadText.textContent=failed.map(file=>file.name).join(', ');
        save.textContent='נסה שוב צירוף קבצים';
        return;
      }
      resetForm({resetDate:true});
      status.textContent='ההוצאה נשמרה';
      await refresh();
    }catch(error){status.textContent=error.message||'שמירת ההוצאה נכשלה';}
    finally{
      draftGuard.busy=false;save.disabled=false;
      if(savedForReceipts){date.input.disabled=true;amount.input.disabled=true;details.input.disabled=true;}
    }
  });
  return {panel,load:refresh};
}
