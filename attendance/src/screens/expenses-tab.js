import { createInputField } from '../components/field.js';
import {listExpenseReports,saveExpenseReport,attachExpenseReceipt,expenseReceiptSignedUrl} from '../services/expense-reports.service.js';
import {listInstructorDisplayMonths,readHistoricalAttendance,historicalExpenses,monthRange,monthLabel,monthStatusLabel} from '../services/historical-display.service.js';

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
  heading.textContent='הוצאות';
  const monthWrap=document.createElement('div');
  monthWrap.className='av2-daily-travel__month-wrap';
  const monthTitle=document.createElement('label');
  monthTitle.textContent='חודש דיווח';
  monthTitle.htmlFor='av2-expense-month-select';
  const monthSelect=document.createElement('select');
  monthSelect.id='av2-expense-month-select';
  monthSelect.className='av2-field__select av2-daily-travel__month-select';
  monthWrap.append(monthTitle,monthSelect);
  const monthStatus=document.createElement('p');
  monthStatus.className='av2-expenses-tab__month-status';
  const form=document.createElement('form');
  form.className='av2-expenses-tab__form';
  form.noValidate=true;
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
  filesWrap.append(fileLabel,fileInput,fileHint);
  const status=document.createElement('p');
  status.className='av2-expenses-tab__status';
  status.setAttribute('role','status');
  const save=document.createElement('button');
  save.type='submit';save.className='av2-btn av2-btn--primary';
  save.textContent='שמירת הוצאה';
  const reset=document.createElement('button');
  reset.type='button';reset.className='av2-btn av2-btn--secondary';
  reset.textContent='הוצאה חדשה';
  const actions=document.createElement('div');
  actions.className='av2-expenses-tab__actions';
  actions.append(save,reset);
  form.append(date.wrap,amount.wrap,details.wrap,filesWrap,status,actions);
  const listHeading=document.createElement('h3');
  listHeading.textContent='ההוצאות שלי';
  const list=document.createElement('div');
  list.className='av2-expenses-tab__list';
  panel.append(heading,monthWrap,monthStatus,form,listHeading,list);
  let reports=[],editing=null,loadToken=0,monthsLoaded=false;
  const currentMonth=todayLocal().slice(0,7);
  let selectedMonth=currentMonth;
  let historicalView=false;

  function resetForm(){
    editing=null;
    amount.input.value='';
    details.input.value='';
    fileInput.value='';
    save.textContent='שמירת הוצאה';
    status.textContent='';
  }
  reset.addEventListener('click',resetForm);
  async function refresh(){
    const token=++loadToken;
    list.textContent='טוען הוצאות…';
    try{
      if(!monthsLoaded){
        const months=await listInstructorDisplayMonths(instructor.empId);
        monthSelect.replaceChildren();
        for(const month of months){
          const option=document.createElement('option');
          option.value=month;option.textContent=monthLabel(month);
          monthSelect.append(option);
        }
        if(!months.includes(selectedMonth))selectedMonth=months.includes(currentMonth)
          ?currentMonth:months[0]||currentMonth;
        monthSelect.value=selectedMonth;
        monthsLoaded=true;
      }
      const {year,month,from,to}=monthRange(selectedMonth);
      historicalView=selectedMonth!==currentMonth;
      const [independent,history]=await Promise.all([
        listExpenseReports({fromDate:from,toDate:to,employeeIds:[instructor.empId]}),
        readHistoricalAttendance(instructor.empId,selectedMonth)
      ]);
      if(token!==loadToken)return;
      reports=historicalExpenses(history.rows,independent);
      form.hidden=historicalView;
      monthStatus.textContent=historicalView?monthStatusLabel(history.approval):'';
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
  monthSelect.addEventListener('change',()=>{
    selectedMonth=monthSelect.value;
    resetForm();
    void refresh();
  });
  date.input.addEventListener('change',()=>{resetForm();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(historicalView)return;
    const chosen=Array.from(fileInput.files||[]);
    const invalid=chosen.find(file=>file.size<=0 || file.size>10*1024*1024
      || !['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type));
    if(invalid){status.textContent='ניתן לצרף PDF או תמונה עד 10MB';return;}
    save.disabled=true;
    status.textContent='שומר הוצאה…';
    try{
      const saved=await saveExpenseReport({
        date:date.input.value,amount:amount.input.value,
        details:details.input.value,id:editing
      });
      const failed=[];
      for(const file of chosen){
        try{
          await attachExpenseReceipt({file,expenseId:saved.id,
            employeeId:instructor.empId,email:instructor.email||''});
        }catch{failed.push(file.name);}
      }
      resetForm();
      status.textContent=failed.length
        ? 'ההוצאה נשמרה, אך לא ניתן היה לצרף: '+failed.join(', ')
        : 'ההוצאה נשמרה';
      await refresh();
    }catch(error){status.textContent=error.message||'שמירת ההוצאה נכשלה';}
    finally{save.disabled=false;}
  });
  return {panel,load:refresh};
}
